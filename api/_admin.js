// ════════════════════════════════════════════════════════════════════════
// api/_admin.js — panel de administración (rol `admin`). NO es un endpoint:
// el plan Hobby ya está en su tope de funciones, así que lo despacha
// `api/profile.js` cuando llega `?admin=1` (rewrite `/api/admin` en vercel.json).
//
//   GET    /api/admin?op=usuarios[&q=&rol=&lim=&off=] → listado (RPC admin_listado_usuarios)
//   GET    /api/admin?op=usuario&id=                  → detalle: perfil, cuarteles, vínculos, alertas 14 d
//   PATCH  /api/admin?op=usuario&id=   { ... }        → editar perfil (incluido el rol)
//   POST   /api/admin?op=suspender&id=                → ban en Supabase Auth
//   POST   /api/admin?op=reactivar&id=                → quita el ban
//   DELETE /api/admin?op=usuario&id=   { confirm_email } → borra la cuenta (cascada a todo)
//   GET    /api/admin?op=vinculos                     → todos los vínculos asesor↔productor
//   POST   /api/admin?op=vinculos      { advisor_id, producer_id, estado?, notificar_asesor? }
//   PATCH  /api/admin?op=vinculos&id=  { estado?, notificar_asesor? }
//   GET    /api/admin?op=auditoria[&id=]              → últimas 200 acciones de admin (de una cuenta con id)
//   POST   /api/admin?op=actuar&id=                   → solo registra el "Entrar como"
//   POST   /api/admin?op=bienvenida&id=               → manda la plantilla de bienvenida por WhatsApp
//   POST   /api/admin?op=invitar      { nombre, email, rol?, lead_id? } → invitación por correo (Supabase Auth)
//   GET    /api/admin?op=leads[&estado=]              → interesados del formulario de /registro
//   PATCH  /api/admin?op=lead&id=     { estado }      → marcar un interesado (nuevo|invitado|descartado)
//
// Desde el lanzamiento (2026-10-21) las cuentas son SOLO por invitación: el
// registro abierto está apagado en Supabase Auth (`disable_signup`) y la única
// vía de alta es `invitar`, que llama al endpoint de admin `/auth/v1/invite`
// (con la service key no le afecta `disable_signup`). El trigger
// `handle_new_user` crea el perfil con el `nombre` y el `rol` de la metadata.
//
// El rol `admin` se asigna solo por SQL (migración v13). Toda mutación deja
// huella en `admin_audit`. Todo el backend usa la service key (salta RLS): la
// autorización real es `requireAdmin`, al inicio de cada request.
//
// Las dependencias se llaman a través del objeto del módulo (`sb.sbSelect`,
// `authz.requireAdmin`) y no desestructuradas: así el arnés
// scripts/probar-admin.js las puede reemplazar sin red.
// ════════════════════════════════════════════════════════════════════════

const sb = require('./_supabase');
const authz = require('./_authz');
const { normalizarTelefono, esBorrado } = require('./_telefono');
const { REGION_POR_ISO } = require('./_geocoding');
const bienvenida = require('./_bienvenida');

const ROLES = ['productor', 'extensionista', 'admin'];
const ESTADOS_VINCULO = ['pendiente', 'activo', 'rechazado', 'revocado'];
// `region` va en formato CORTO ("Metropolitana"): check-alerts la compara con
// `eq.` exacto contra alert_rules.zona. Otro formato rompe las alertas en silencio.
const REGIONES = Object.values(REGION_POR_ISO);
const EDITABLE = ['nombre', 'rol', 'region', 'whatsapp_phone', 'onboarding_done', 'cultivo_base'];
// Ban "indefinido": Supabase Auth no tiene un valor para "para siempre".
const BAN_INDEFINIDO = '876000h';  // ~100 años
const ROLES_INVITABLES = ['productor', 'extensionista'];   // admin, solo por SQL
const ESTADOS_LEAD = ['nuevo', 'invitado', 'descartado'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Adónde lleva el link del correo: crea la clave y sigue a /registro (datos del campo).
const REDIRECT_INVITACION = 'https://smartfieldinia.cl/nueva-clave?invitado=1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function authAdminHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

// Admin API de Supabase Auth (/auth/v1/admin/users/{id}).
async function authAdmin(method, id, body) {
  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method,
    headers: authAdminHeaders(),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Auth admin ${method} → ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : {};
}

// `auditar` vive en _authz.js (lo usan también fields.js y profile.js).
const { auditar } = authz;

function leerBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

async function perfilesPorId(ids) {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return {};
  const rows = await sb.sbSelect('users_profile', {
    select: 'id,nombre,rol,region,whatsapp_phone', id: `in.(${unicos.join(',')})`,
  });
  return Object.fromEntries(rows.map(r => [r.id, r]));
}

// ── Handlers ────────────────────────────────────────────────────────────

async function listarUsuarios(req, res, url) {
  const lim = Math.min(parseInt(url.searchParams.get('lim') || '200', 10) || 200, 500);
  const off = Math.max(parseInt(url.searchParams.get('off') || '0', 10) || 0, 0);
  const rows = await sb.sbRpc('admin_listado_usuarios', {
    q: url.searchParams.get('q') || null,
    rol_filtro: url.searchParams.get('rol') || null,
    lim, off,
  });
  const ahora = Date.now();
  const usuarios = rows.map(({ total: _total, ...r }) => ({
    ...r,
    suspendido: !!(r.banned_until && new Date(r.banned_until).getTime() > ahora),
  }));
  return res.status(200).json({ usuarios, total: rows.length ? Number(rows[0].total) : 0, lim, off });
}

async function detalleUsuario(req, res, id) {
  const perfiles = await sb.sbSelect('users_profile', { id: `eq.${id}`, limit: 1 });
  if (!perfiles.length) return res.status(404).json({ error: 'Usuario no encontrado.' });

  const desde = new Date(Date.now() - 14 * 86400000).toISOString();
  const [auth, campos, links, alertas] = await Promise.all([
    authAdmin('GET', id).catch(e => { console.error('admin detalle auth:', e); return null; }),
    sb.sbSelect('user_fields', {
      // polygon_coords: el mini-mapa de solo lectura de la ficha.
      select: 'id,nombre,cultivo,variedad,anio_plantacion,sistema_riego,area_ha,predio_id,predio_nombre,comuna,region,polygon_coords,created_at',
      user_id: `eq.${id}`, order: 'predio_nombre.asc.nullslast,nombre.asc',
    }),
    sb.sbSelect('advisor_links', {
      select: 'id,advisor_id,producer_id,estado,notificar_asesor,created_at',
      or: `(advisor_id.eq.${id},producer_id.eq.${id})`,
    }),
    sb.sbSelect('alerts', {
      select: 'id', user_id: `eq.${id}`, created_at: `gte.${desde}`, limit: 1000,
    }),
  ]);

  const nombres = await perfilesPorId(links.flatMap(l => [l.advisor_id, l.producer_id]));
  const u = auth && (auth.user || auth);
  return res.status(200).json({
    perfil: perfiles[0],
    cuenta: u ? {
      email: u.email || null,
      last_sign_in_at: u.last_sign_in_at || null,
      banned_until: u.banned_until || null,
      suspendido: !!(u.banned_until && new Date(u.banned_until).getTime() > Date.now()),
      proveedores: (u.app_metadata && u.app_metadata.providers) || [],
    } : null,
    campos,
    vinculos: links.map(l => ({
      ...l,
      asesor: nombres[l.advisor_id]?.nombre || null,
      productor: nombres[l.producer_id]?.nombre || null,
    })),
    alertas_14d: alertas.length,
  });
}

async function editarUsuario(req, res, caller, id) {
  const body = leerBody(req);
  const patch = {};
  for (const k of EDITABLE) if (k in body) patch[k] = body[k];
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nada que actualizar.' });

  if ('rol' in patch) {
    if (!ROLES.includes(patch.rol)) return res.status(400).json({ error: 'Rol no válido.' });
    // Nunca queda cero admins: el admin no se quita el rol a sí mismo.
    if (id === caller.id && patch.rol !== 'admin') {
      return res.status(400).json({ error: 'No puedes quitarte tu propio rol de administrador.' });
    }
  }
  if ('region' in patch && patch.region !== null && !REGIONES.includes(patch.region)) {
    return res.status(400).json({ error: 'Región no válida.' });
  }
  if ('nombre' in patch && !String(patch.nombre || '').trim()) {
    return res.status(400).json({ error: 'El nombre no puede quedar vacío.' });
  }
  if ('onboarding_done' in patch) patch.onboarding_done = !!patch.onboarding_done;
  if ('whatsapp_phone' in patch) {
    if (esBorrado(patch.whatsapp_phone)) {
      patch.whatsapp_phone = null;
    } else {
      const n = normalizarTelefono(patch.whatsapp_phone);
      if (!n) return res.status(400).json({ error: 'El número de WhatsApp no es válido. Usa el formato +56912345678.' });
      patch.whatsapp_phone = n;
    }
  }

  const antes = (await sb.sbSelect('users_profile', {
    select: EDITABLE.join(','), id: `eq.${id}`, limit: 1,
  }))[0];
  if (!antes) return res.status(404).json({ error: 'Usuario no encontrado.' });

  const rows = await sb.sbUpdate('users_profile', { id: `eq.${id}` }, patch);
  const cambios = {};
  for (const k of Object.keys(patch)) {
    if (antes[k] !== patch[k]) cambios[k] = { antes: antes[k], despues: patch[k] };
  }
  await auditar(caller.id, 'editar_usuario', id, cambios);
  return res.status(200).json(rows[0] || {});
}

async function suspender(req, res, caller, id, activar) {
  if (id === caller.id) return res.status(400).json({ error: 'No puedes suspender tu propia cuenta.' });
  await authAdmin('PUT', id, { ban_duration: activar ? BAN_INDEFINIDO : 'none' });
  await auditar(caller.id, activar ? 'suspender' : 'reactivar', id);
  return res.status(200).json({ ok: true, suspendido: activar });
}

// Para cuentas que ya terminaron el alta sin escribirle nunca al bot: la
// bienvenida automática sale solo al cerrar el registro (ver profile.js).
async function enviarBienvenidaA(req, res, caller, id) {
  const perfil = (await sb.sbSelect('users_profile', { select: 'id,nombre,whatsapp_phone', id: `eq.${id}`, limit: 1 }))[0];
  if (!perfil) return res.status(404).json({ error: 'Perfil no encontrado.' });
  if (!perfil.whatsapp_phone) return res.status(400).json({ error: 'La cuenta no tiene número de WhatsApp.' });
  const r = await bienvenida.enviarBienvenida(perfil);
  await auditar(caller.id, 'bienvenida_enviar', id, { ok: !!r.ok, via: r.via || 'plantilla', error: r.ok ? null : String(r.error || '').slice(0, 300) });
  if (!r.ok) {
    // #132001: Meta no encuentra la plantilla aprobada en ese idioma (mientras
    // está PENDING responde eso). Es lo único accionable que ve el admin.
    const pendiente = /132001|does not exist/i.test(String(r.error || '') + String(r.code || ''));
    return res.status(502).json({ error: pendiente
      ? 'La plantilla de bienvenida todavía está en revisión en Meta, así que WhatsApp no deja escribirle primero a esta persona. Cuando Meta la apruebe, vuelve a intentarlo (o pídele que le escriba "hola" al bot y reintenta: ahí sale de inmediato).'
      : 'WhatsApp no aceptó el mensaje. Revisa que la plantilla esté aprobada.' });
  }
  return res.status(200).json({ ok: true, via: r.via || 'plantilla' });
}

async function borrarUsuario(req, res, caller, id) {
  if (id === caller.id) return res.status(400).json({ error: 'No puedes borrar tu propia cuenta.' });
  const body = leerBody(req);
  const auth = await authAdmin('GET', id);
  const u = auth.user || auth;
  // Confirmación explícita: el borrado es físico y en cascada (cuarteles,
  // historial NDVI, alertas, conversaciones, vínculos). No hay papelera.
  const confirm = String(body.confirm_email || '').trim().toLowerCase();
  if (!u.email || confirm !== u.email.toLowerCase()) {
    return res.status(400).json({ error: 'Escribe el correo exacto de la cuenta para confirmar el borrado.' });
  }
  const perfil = (await sb.sbSelect('users_profile', { select: 'nombre,rol', id: `eq.${id}`, limit: 1 }))[0] || {};
  await authAdmin('DELETE', id);
  await auditar(caller.id, 'borrar_usuario', id, { email: u.email, nombre: perfil.nombre || null, rol: perfil.rol || null });
  return res.status(200).json({ ok: true });
}

async function listarVinculos(req, res) {
  const links = await sb.sbSelect('advisor_links', {
    select: 'id,advisor_id,producer_id,estado,notificar_asesor,invited_by,created_at,updated_at',
    order: 'created_at.desc', limit: 1000,
  });
  const nombres = await perfilesPorId(links.flatMap(l => [l.advisor_id, l.producer_id]));
  return res.status(200).json(links.map(l => ({
    ...l,
    asesor: nombres[l.advisor_id]?.nombre || null,
    productor: nombres[l.producer_id]?.nombre || null,
  })));
}

async function crearVinculo(req, res, caller) {
  const b = leerBody(req);
  const estado = b.estado || 'activo';
  if (!UUID_RE.test(b.advisor_id || '') || !UUID_RE.test(b.producer_id || '')) {
    return res.status(400).json({ error: 'Faltan el asesor y el productor.' });
  }
  if (b.advisor_id === b.producer_id) return res.status(400).json({ error: 'El asesor y el productor deben ser distintos.' });
  if (!ESTADOS_VINCULO.includes(estado)) return res.status(400).json({ error: 'Estado no válido.' });

  const p = await perfilesPorId([b.advisor_id, b.producer_id]);
  if (!p[b.advisor_id] || !p[b.producer_id]) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (p[b.advisor_id].rol !== 'extensionista') {
    return res.status(400).json({ error: 'Solo una cuenta de asesor (extensionista) puede tener cartera.' });
  }

  const existentes = await sb.sbSelect('advisor_links', {
    select: 'id', advisor_id: `eq.${b.advisor_id}`, producer_id: `eq.${b.producer_id}`, limit: 1,
  });
  const campos = { estado, notificar_asesor: !!b.notificar_asesor, updated_at: new Date().toISOString() };
  // unique(advisor_id, producer_id): si ya existe (p. ej. revocado), se reactiva
  // el mismo vínculo en vez de fallar con 23505.
  const rows = existentes.length
    ? await sb.sbUpdate('advisor_links', { id: `eq.${existentes[0].id}` }, campos)
    : await sb.sbInsert('advisor_links', [{ advisor_id: b.advisor_id, producer_id: b.producer_id, invited_by: caller.id, ...campos }]);
  await auditar(caller.id, 'crear_vinculo', b.producer_id, { advisor_id: b.advisor_id, estado });
  return res.status(200).json(rows[0] || {});
}

async function editarVinculo(req, res, caller, id) {
  const b = leerBody(req);
  const patch = {};
  if ('estado' in b) {
    if (!ESTADOS_VINCULO.includes(b.estado)) return res.status(400).json({ error: 'Estado no válido.' });
    patch.estado = b.estado;
  }
  if ('notificar_asesor' in b) patch.notificar_asesor = !!b.notificar_asesor;
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nada que actualizar.' });
  patch.updated_at = new Date().toISOString();
  const rows = await sb.sbUpdate('advisor_links', { id: `eq.${id}` }, patch);
  if (!rows.length) return res.status(404).json({ error: 'Vínculo no encontrado.' });
  await auditar(caller.id, 'editar_vinculo', rows[0].producer_id, { vinculo_id: id, advisor_id: rows[0].advisor_id, ...patch });
  return res.status(200).json(rows[0]);
}

async function listarAuditoria(req, res, id) {
  // Con `id`, solo lo que se le hizo a esa cuenta (la ficha del usuario).
  const filtro = id ? { target_id: `eq.${id}` } : {};
  const rows = await sb.sbSelect('admin_audit', { ...filtro, order: 'created_at.desc', limit: 200 });
  const nombres = await perfilesPorId(rows.flatMap(r => [r.actor_id, r.target_id]));
  return res.status(200).json(rows.map(r => ({
    ...r,
    actor: nombres[r.actor_id]?.nombre || null,
    // Un usuario borrado ya no tiene perfil: se rescata el nombre del detalle.
    target: nombres[r.target_id]?.nombre || r.detalle?.nombre || r.detalle?.email || null,
  })));
}

// ── Invitaciones e interesados ──────────────────────────────────────────

async function invitar(req, res, caller) {
  const b = leerBody(req);
  const nombre = String(b.nombre || '').trim().slice(0, 120);
  const email = String(b.email || '').trim().toLowerCase();
  const rol = b.rol || 'productor';
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'El correo no es válido.' });
  if (!ROLES_INVITABLES.includes(rol)) return res.status(400).json({ error: 'Rol no válido.' });
  if (b.lead_id && !UUID_RE.test(b.lead_id)) return res.status(400).json({ error: 'lead_id no válido.' });

  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/invite?redirect_to=${encodeURIComponent(REDIRECT_INVITACION)}`, {
    method: 'POST',
    headers: authAdminHeaders(),
    body: JSON.stringify({ email, data: { nombre, rol } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    const txt = await r.text();
    // GoTrue responde 422 "email_exists" / "already been registered" si la cuenta ya existe.
    if (r.status === 422 || /already|exists|registered/i.test(txt)) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
    }
    if (r.status === 429) {
      return res.status(429).json({ error: 'Se alcanzó el límite de correos por hora de Supabase. Intenta más tarde.' });
    }
    throw new Error(`Auth invite → ${r.status}: ${txt}`);
  }
  const u = await r.json().catch(() => ({}));

  if (b.lead_id) {
    await sb.sbUpdate('leads', { id: `eq.${b.lead_id}` }, {
      estado: 'invitado', invitado_at: new Date().toISOString(), invitado_por: caller.id, user_id: u.id || null,
    }).catch(e => console.error('[admin] no se pudo marcar el lead como invitado:', e.message));
  }
  await auditar(caller.id, 'invitar_usuario', u.id || null, { email, nombre, rol, lead_id: b.lead_id || null });
  return res.status(200).json({ ok: true, id: u.id || null });
}

async function listarLeads(req, res, url) {
  const estado = url.searchParams.get('estado');
  const filtro = ESTADOS_LEAD.includes(estado) ? { estado: `eq.${estado}` } : {};
  const rows = await sb.sbSelect('leads', { ...filtro, order: 'created_at.desc', limit: 500 });
  return res.status(200).json(rows);
}

async function editarLead(req, res, caller, id) {
  const { estado } = leerBody(req);
  if (!ESTADOS_LEAD.includes(estado)) return res.status(400).json({ error: 'Estado no válido.' });
  const rows = await sb.sbUpdate('leads', { id: `eq.${id}` }, { estado });
  if (!rows.length) return res.status(404).json({ error: 'Interesado no encontrado.' });
  await auditar(caller.id, 'editar_lead', null, { lead_id: id, email: rows[0].email, estado });
  return res.status(200).json(rows[0]);
}

// ── Despacho ────────────────────────────────────────────────────────────

async function handleAdmin(req, res) {
  const caller = await authz.requireAdmin(req, res);
  if (!caller) return;

  const url = new URL(req.url, 'http://x');
  const op = url.searchParams.get('op');
  const id = url.searchParams.get('id');
  const m = req.method;
  if (id && !UUID_RE.test(id)) return res.status(400).json({ error: 'id no válido.' });
  const conId = (fn) => (id ? fn() : res.status(400).json({ error: 'Falta el id.' }));

  try {
    if (op === 'usuarios' && m === 'GET') return await listarUsuarios(req, res, url);
    if (op === 'usuario' && m === 'GET') return await conId(() => detalleUsuario(req, res, id));
    if (op === 'usuario' && (m === 'PATCH' || m === 'PUT')) return await conId(() => editarUsuario(req, res, caller, id));
    if (op === 'usuario' && m === 'DELETE') return await conId(() => borrarUsuario(req, res, caller, id));
    if (op === 'suspender' && m === 'POST') return await conId(() => suspender(req, res, caller, id, true));
    if (op === 'reactivar' && m === 'POST') return await conId(() => suspender(req, res, caller, id, false));
    if (op === 'vinculos' && m === 'GET') return await listarVinculos(req, res);
    if (op === 'vinculos' && m === 'POST') return await crearVinculo(req, res, caller);
    if (op === 'vinculos' && m === 'PATCH') return await conId(() => editarVinculo(req, res, caller, id));
    if (op === 'auditoria' && m === 'GET') return await listarAuditoria(req, res, id);
    if (op === 'bienvenida' && m === 'POST') return await conId(() => enviarBienvenidaA(req, res, caller, id));
    if (op === 'invitar' && m === 'POST') return await invitar(req, res, caller);
    if (op === 'leads' && m === 'GET') return await listarLeads(req, res, url);
    if (op === 'lead' && m === 'PATCH') return await conId(() => editarLead(req, res, caller, id));
    if (op === 'actuar' && m === 'POST') {
      return await conId(async () => {
        await auditar(caller.id, 'actuar_como', id);
        return res.status(200).json({ ok: true });
      });
    }
    return res.status(404).json({ error: 'Operación no encontrada.' });
  } catch (e) {
    // El detalle de PostgREST / Auth se queda en el log, no sale al cliente.
    console.error('admin error:', op, e);
    if (/23505|duplicate key/i.test(String(e.message || ''))) {
      return res.status(409).json({ error: 'Ese número de WhatsApp ya está registrado en otra cuenta.' });
    }
    return res.status(500).json({ error: 'Error al procesar la solicitud de administración.' });
  }
}

module.exports = { handleAdmin, REGIONES, ROLES, BAN_INDEFINIDO, REDIRECT_INVITACION };

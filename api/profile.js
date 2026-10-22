// ════════════════════════════════════════════════════════════════════════
// api/profile.js (M2) — perfil del usuario autenticado (o de un productor
// vinculado, vía ?as=<producer_id> — ver _authz.js).
//   GET  /api/profile[?as=]          → devuelve el perfil (preferencias normalizadas)
//   PUT  /api/profile[?as=]  { ... } → actualiza campos editables + onboarding
//   *    /api/admin?op=…              → panel de administración (rewrite a
//        /api/profile?admin=1; ver _admin.js — vive acá por el tope de funciones)
// ════════════════════════════════════════════════════════════════════════

const { requireAuth } = require('./_auth');
const { resolveActingContext, auditarSiAdmin } = require('./_authz');
const { sbSelect, sbUpdate } = require('./_supabase');
const { normalizePrefs } = require('./_prefs');
const { normalizarTelefono, esBorrado } = require('./_telefono');
const { handleAdmin } = require('./_admin');
const { enviarBienvenida } = require('./_bienvenida');

// Campos que el usuario (o su asesor, actuando en su nombre) puede modificar.
// `rol` deliberadamente fuera de la whitelist: un asesor vinculado no puede
// cambiar el rol de un productor, ni un usuario puede auto-ascenderse después.
const EDITABLE = ['nombre', 'cultivo_base', 'region', 'whatsapp_phone', 'preferencias', 'onboarding_done'];

// Única excepción para `rol`: al terminar de crear la cuenta. Quien entra con
// Google/Microsoft no pasa por el formulario de registro (que mandaba el rol en
// los metadatos del signUp), así que lo elige después, en el paso "Completa tus
// datos". Se permite solo si se cumplen las tres condiciones:
//   1. el usuario actúa sobre su propio perfil (sin `?as=`),
//   2. ese perfil sigue con `onboarding_done = false`,
//   3. el valor es uno de los roles conocidos.
// Es decir: una sola vez, sobre uno mismo, y nunca desde la cartera de un asesor.
const ROLES_VALIDOS = ['productor', 'extensionista'];

function puedeFijarRol(perfil, callerId, targetId) {
  return callerId === targetId && perfil && perfil.onboarding_done === false;
}

// La bienvenida por WhatsApp sale una vez al terminar el alta (último paso del
// registro) y de nuevo si, con el alta hecha, la persona cambia su número: es
// la única forma de que el bot escriba primero (ver _bienvenida.js).
function tocaBienvenida(previo, actual) {
  if (!actual.whatsapp_phone) return false;
  if (previo.onboarding_done === false && actual.onboarding_done === true) return true;
  return previo.onboarding_done === true && actual.whatsapp_phone !== previo.whatsapp_phone;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (new URL(req.url, 'http://x').searchParams.get('admin') === '1') return handleAdmin(req, res);

  const caller = await requireAuth(req, res);
  if (!caller) return;
  const ctx = await resolveActingContext(req, res, caller.id);
  if (!ctx) return;
  const { targetId } = ctx;

  try {
    if (req.method === 'GET') {
      const rows = await sbSelect('users_profile', { id: `eq.${targetId}`, limit: 1 });
      if (!rows.length) return res.status(404).json({ error: 'Perfil no encontrado.' });
      const perfil = rows[0];
      perfil.preferencias = normalizePrefs(perfil.preferencias);
      // El conteo de alertas no leídas (`alertas_no_leidas`) ya no viaja acá:
      // el KPI del dashboard cuenta las de los últimos 14 días de la selección
      // y lo trae `/api/fields?analytics=1` (`alertas_14d`).
      return res.status(200).json(perfil);
    }

    if (req.method === 'PUT' || req.method === 'PATCH') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const patch = {};
      for (const k of EDITABLE) if (k in body) patch[k] = body[k];

      // El teléfono se guarda SIEMPRE en E.164. Es la clave con la que
      // whatsapp-webhook.js reconoce al agricultor que escribe: un número
      // guardado con espacios, sin "+" o sin código de país simplemente no se
      // encuentra, y esa persona conversa con el bot como anónima —sin sus
      // cuarteles y sin memoria— sin que nada falle a la vista.
      if ('whatsapp_phone' in patch) {
        if (esBorrado(patch.whatsapp_phone)) {
          patch.whatsapp_phone = null;
        } else {
          const normalizado = normalizarTelefono(patch.whatsapp_phone);
          if (!normalizado) {
            return res.status(400).json({ error: 'El número de WhatsApp no es válido. Usa el formato +56912345678.' });
          }
          patch.whatsapp_phone = normalizado;
        }
      }

      // `rol` solo al completar el alta — ver comentario de puedeFijarRol.
      if ('rol' in body) {
        if (!ROLES_VALIDOS.includes(body.rol)) {
          return res.status(400).json({ error: 'Rol no válido.' });
        }
        const actual = (await sbSelect('users_profile', {
          select: 'rol,onboarding_done', id: `eq.${targetId}`, limit: 1,
        }))[0];

        if (actual && actual.rol === body.rol) {
          // Mandó el rol que ya tiene: no es un cambio. Se ignora en vez de
          // fallar, porque el frontend reenvía el perfil completo al guardar.
        } else if (puedeFijarRol(actual, caller.id, targetId)) {
          patch.rol = body.rol;
        } else if (caller.id !== targetId) {
          // Un asesor intentando cambiar el rol de su productor: eso sí es un
          // intento no autorizado y se corta entero.
          return res.status(403).json({ error: 'El rol no se puede cambiar desde aquí.' });
        }
        // Usuario sobre su propio perfil pero con el alta ya terminada: el rol
        // simplemente no se toca, y el resto del guardado sigue. Fallar acá
        // dejaría trabado, por ejemplo, a alguien completando su WhatsApp.
      }

      if (!Object.keys(patch).length) {
        return res.status(400).json({ error: 'Nada que actualizar.' });
      }
      // Un admin editando otra cuenta (panel o "Entrar como") deja el antes/después.
      const antes = ctx.motivo === 'admin'
        ? (await sbSelect('users_profile', { select: Object.keys(patch).join(','), id: `eq.${targetId}`, limit: 1 }))[0]
        : null;
      // Para decidir la bienvenida por WhatsApp hace falta el estado previo. Solo
      // sobre uno mismo: admin y asesor la mandan desde el panel, a propósito.
      const previo = ctx.motivo === 'propio' && ('onboarding_done' in patch || 'whatsapp_phone' in patch)
        ? (await sbSelect('users_profile', { select: 'onboarding_done,whatsapp_phone', id: `eq.${targetId}`, limit: 1 }))[0]
        : null;
      const rows = await sbUpdate('users_profile', { id: `eq.${targetId}` }, patch);
      if (previo && rows[0] && tocaBienvenida(previo, rows[0])) await enviarBienvenida(rows[0]);
      if (antes && rows[0]) {
        const cambios = {};
        for (const k of Object.keys(patch)) {
          if (JSON.stringify(antes[k] ?? null) !== JSON.stringify(rows[0][k] ?? null)) {
            cambios[k] = { antes: antes[k] ?? null, despues: rows[0][k] ?? null };
          }
        }
        if (Object.keys(cambios).length) await auditarSiAdmin(ctx, 'perfil_editar', { cambios });
      }
      return res.status(200).json(rows[0] || {});
    }

    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (e) {
    // El texto crudo de PostgREST (tabla, constraint, detalle) se queda en el log.
    console.error('profile error:', e);
    // 23505 = unique_violation. Con el índice de la migración v11, el único que
    // puede saltar acá es el de `whatsapp_phone`: dos perfiles con el mismo
    // número hacen ambiguo a quién le contesta el bot.
    if (/23505|duplicate key/i.test(String(e.message || ''))) {
      return res.status(409).json({ error: 'Ese número de WhatsApp ya está registrado en otra cuenta.' });
    }
    return res.status(500).json({ error: 'Error al procesar el perfil.' });
  }
};

module.exports.config = { maxDuration: 15 };

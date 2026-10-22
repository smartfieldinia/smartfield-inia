// ════════════════════════════════════════════════════════════════════════
// Autorización "actuar en nombre de" — para que un asesor (rol=extensionista)
// opere sobre los datos de un productor vinculado, sin que cada endpoint
// reimplemente la validación. Todo el proyecto usa SUPABASE_SERVICE_KEY
// (omite RLS), así que esta es la capa real de autorización — RLS solo
// cubre defensa en profundidad ante un eventual acceso directo con anon key.
//
// Uso en cualquier handler autenticado:
//   const { requireAuth } = require('./_auth');
//   const { resolveActingUser } = require('./_authz');
//   const caller = await requireAuth(req, res);
//   if (!caller) return;
//   const targetId = await resolveActingUser(req, res, caller.id);
//   if (!targetId) return;              // resolveActingUser ya respondió 403
// ════════════════════════════════════════════════════════════════════════

const sb = require('./_supabase');
const { sbSelect } = sb;
const { requireAuth } = require('./_auth');

// ¿El usuario tiene rol `admin`? El rol solo se asigna por SQL (migración v13:
// el trigger de alta no acepta `admin`), así que leerlo de la base es confiable.
// Ante un error de lectura responde false: sin certeza, no hay privilegio.
async function esAdmin(userId) {
  try {
    const rows = await sbSelect('users_profile', { select: 'rol', id: `eq.${userId}`, limit: 1 });
    return !!rows.length && rows[0].rol === 'admin';
  } catch (e) {
    console.error('esAdmin error:', e);
    return false;
  }
}

// Exige sesión Y rol admin. Responde 401/403 y devuelve null si no se cumple.
async function requireAdmin(req, res) {
  const caller = await requireAuth(req, res);
  if (!caller) return null;
  if (!(await esAdmin(caller.id))) {
    res.status(403).json({ error: 'Solo un administrador puede hacer esto.' });
    return null;
  }
  return caller;
}

function actingParam(req) {
  const url = new URL(req.url, 'http://x');
  return url.searchParams.get('as');
}

// Resuelve sobre quién actúa el caller y POR QUÉ: `propio` (sin `?as=` o con su
// propio id), `vinculo` (asesor con vínculo activo) o `admin` (cualquier cuenta,
// sin vínculo). El motivo es lo que decide si una escritura se audita: solo la
// del admin sobre otra cuenta (`auditarSiAdmin`). Si `?as=` viene pero no hay
// vínculo ni rol admin, responde 403 y devuelve null.
async function resolveActingContext(req, res, callerId) {
  const targetId = actingParam(req);
  if (!targetId || targetId === callerId) return { targetId: callerId, motivo: 'propio', callerId };

  try {
    const links = await sbSelect('advisor_links', {
      select: 'id',
      advisor_id: `eq.${callerId}`,
      producer_id: `eq.${targetId}`,
      estado: 'eq.activo',
      limit: 1,
    });
    if (links.length) return { targetId, motivo: 'vinculo', callerId };
    // El admin va después del vínculo: el caso común (asesor) no paga la
    // lectura extra del perfil.
    if (await esAdmin(callerId)) return { targetId, motivo: 'admin', callerId };
  } catch (e) {
    console.error('resolveActingUser error:', e);
  }

  res.status(403).json({ error: 'No tienes un vínculo activo con este productor.' });
  return null;
}

// Devuelve el id del usuario "objetivo" (ver `resolveActingContext`) o null
// si ya respondió 403. Para los endpoints que no necesitan el motivo.
async function resolveActingUser(req, res, callerId) {
  const ctx = await resolveActingContext(req, res, callerId);
  return ctx ? ctx.targetId : null;
}

async function auditar(actorId, accion, targetId, detalle = {}) {
  // La auditoría nunca tumba la acción que registra: si falla, queda en el log.
  // `sb.sbInsert` (no desestructurado) para que el arnés pueda reemplazarlo.
  try {
    await sb.sbInsert('admin_audit', [{ actor_id: actorId, accion, target_id: targetId || null, detalle }]);
  } catch (e) {
    console.error('admin_audit error:', e);
  }
}

// Registra la escritura solo si la hizo un admin sobre OTRA cuenta (desde el
// panel o con "Entrar como"). Ni el dueño ni el asesor vinculado dejan huella.
async function auditarSiAdmin(ctx, accion, detalle) {
  if (!ctx || ctx.motivo !== 'admin') return;
  await auditar(ctx.callerId, accion, ctx.targetId, detalle);
}

module.exports = { resolveActingUser, resolveActingContext, esAdmin, requireAdmin, auditar, auditarSiAdmin };

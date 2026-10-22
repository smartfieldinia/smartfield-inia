// ════════════════════════════════════════════════════════════════════════
// api/advisor-links.js — gestión de cartera Asesor ↔ Productor.
//   GET   /api/advisor-links?role=advisor   → cartera del asesor autenticado
//   GET   /api/advisor-links?role=producer  → asesores vinculados al productor
//   POST  /api/advisor-links { producer_email } → invita (solo rol=extensionista)
//   PATCH /api/advisor-links?id=<id> { estado, notificar_asesor } → aceptar/
//         rechazar/revocar (solo las partes del vínculo pueden modificarlo)
// ════════════════════════════════════════════════════════════════════════

const { requireAuth } = require('./_auth');
const { sbSelect, sbInsert, sbUpdate } = require('./_supabase');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

// Busca un usuario de auth.users por email vía Admin API (requiere service key).
async function findAuthUserByEmail(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Admin API ${res.status}`);
  const data = await res.json();
  const users = data.users || data || [];
  return Array.isArray(users) ? users.find(u => u.email === email) : null;
}

async function profilesById(ids) {
  if (!ids.length) return {};
  const rows = await sbSelect('users_profile', {
    select: 'id,nombre,region,cultivo_base,whatsapp_phone,rol',
    id: `in.(${ids.join(',')})`,
  });
  return Object.fromEntries(rows.map(r => [r.id, r]));
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(204).end();

  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    if (req.method === 'GET') return handleGet(req, res, user);
    if (req.method === 'POST') return handlePost(req, res, user);
    if (req.method === 'PATCH') return handlePatch(req, res, user);
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error('advisor-links error:', e);
    return res.status(500).json({ error: 'Error al procesar la solicitud.' });
  }
};

async function handleGet(req, res, user) {
  const url = new URL(req.url, 'http://x');
  const role = url.searchParams.get('role') === 'producer' ? 'producer' : 'advisor';

  const filterKey = role === 'advisor' ? 'advisor_id' : 'producer_id';
  const links = await sbSelect('advisor_links', {
    select: '*',
    [filterKey]: `eq.${user.id}`,
    order: 'created_at.desc',
  });

  const otherIds = links.map(l => (role === 'advisor' ? l.producer_id : l.advisor_id));
  const profiles = await profilesById([...new Set(otherIds)]);

  const out = links.map(l => ({
    ...l,
    contraparte: profiles[role === 'advisor' ? l.producer_id : l.advisor_id] || null,
  }));

  return res.status(200).json(out);
}

async function handlePost(req, res, user) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { producer_email } = body;
  if (!producer_email) return res.status(400).json({ error: 'Falta producer_email' });

  const rows = await sbSelect('users_profile', { select: 'id,rol', id: `eq.${user.id}`, limit: 1 });
  const caller = rows[0];
  if (!caller || caller.rol !== 'extensionista') {
    return res.status(403).json({ error: 'Solo un asesor puede invitar productores.' });
  }

  const authUser = await findAuthUserByEmail(producer_email);
  // Respuesta idéntica exista o no la cuenta: distinguirlas convertía este
  // endpoint en un oráculo de "¿este email está registrado en SmartField?" para
  // cualquier asesor. El asesor ve la invitación en su cartera solo si se creó.
  if (!authUser) return res.status(200).json({ ok: true, link: null, mensaje: 'Invitación enviada.' });
  if (authUser.id === user.id) return res.status(400).json({ error: 'No puedes vincularte a ti mismo.' });

  // Reactivar si ya existe un vínculo previo (revocado/rechazado), o crear uno nuevo.
  const existentes = await sbSelect('advisor_links', {
    select: 'id,estado', advisor_id: `eq.${user.id}`, producer_id: `eq.${authUser.id}`, limit: 1,
  });

  let row;
  if (existentes.length) {
    if (existentes[0].estado === 'activo') {
      return res.status(409).json({ error: 'Ya existe un vínculo activo con este productor.' });
    }
    const updated = await sbUpdate('advisor_links', { id: `eq.${existentes[0].id}` }, {
      estado: 'pendiente', invited_by: user.id, updated_at: new Date().toISOString(),
    });
    row = updated[0];
  } else {
    const created = await sbInsert('advisor_links', {
      advisor_id: user.id, producer_id: authUser.id, estado: 'pendiente', invited_by: user.id,
    });
    row = created[0];
  }

  return res.status(200).json({ ok: true, link: row });
}

async function handlePatch(req, res, user) {
  const url = new URL(req.url, 'http://x');
  const id = url.searchParams.get('id');
  if (!id) return res.status(400).json({ error: 'Falta id' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { estado, notificar_asesor } = body;

  const rows = await sbSelect('advisor_links', { select: '*', id: `eq.${id}`, limit: 1 });
  const link = rows[0];
  if (!link) return res.status(404).json({ error: 'Vínculo no encontrado' });
  if (link.advisor_id !== user.id && link.producer_id !== user.id) {
    return res.status(403).json({ error: 'No eres parte de este vínculo.' });
  }

  const patch = { updated_at: new Date().toISOString() };
  const ESTADOS_VALIDOS = ['activo', 'rechazado', 'revocado', 'pendiente'];
  if (estado && ESTADOS_VALIDOS.includes(estado)) patch.estado = estado;
  if (typeof notificar_asesor === 'boolean' && user.id === link.producer_id) {
    patch.notificar_asesor = notificar_asesor;
  }
  if (Object.keys(patch).length === 1) return res.status(400).json({ error: 'Nada que actualizar.' });

  const updated = await sbUpdate('advisor_links', { id: `eq.${id}` }, patch);
  return res.status(200).json({ ok: true, link: updated[0] });
}

module.exports.config = { maxDuration: 10 };

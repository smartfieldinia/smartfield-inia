// ════════════════════════════════════════════════════════════════════════
// api/conversations.js — CRUD del historial de chat web (tabla `conversations`,
// compartida con la memoria del bot de WhatsApp que usa `carpeta='whatsapp'`
// — ver whatsapp-webhook.js). Este endpoint excluye siempre esa fila: es
// exclusivamente para el chat de /app.
//   GET    /api/conversations[?as=]           → lista (sin mensajes, liviana)
//   GET    /api/conversations?id=<id>[&as=]   → una conversación completa
//   POST   /api/conversations[?as=]  { titulo, carpeta, mensajes }
//   PATCH  /api/conversations?id=<id>[&as=]   { titulo, carpeta, mensajes }
//   DELETE /api/conversations?id=<id>[&as=]
//
// `carpeta` en esta tabla dobla como id de carpeta del sidebar (o null si la
// conversación no está en ninguna) — la metadata de la carpeta (nombre,
// color) vive solo en localStorage, no hace falta tabla nueva.
// ════════════════════════════════════════════════════════════════════════

const { requireAuth } = require('./_auth');
const { resolveActingUser } = require('./_authz');
const { sbSelect, sbInsert, sbUpdate, sbDelete } = require('./_supabase');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const caller = await requireAuth(req, res);
  if (!caller) return;
  const targetId = await resolveActingUser(req, res, caller.id);
  if (!targetId) return;

  if (req.method === 'GET')    return handleGet(req, res, targetId);
  if (req.method === 'POST')   return handlePost(req, res, targetId);
  if (req.method === 'PATCH')  return handlePatch(req, res, targetId);
  if (req.method === 'DELETE') return handleDelete(req, res, targetId);
  return res.status(405).json({ error: 'Método no permitido' });
};

async function handleGet(req, res, userId) {
  const url = new URL(req.url, 'http://x');
  const id = url.searchParams.get('id');

  try {
    if (id) {
      const rows = await sbSelect('conversations', {
        id: `eq.${id}`, user_id: `eq.${userId}`, limit: 1,
      });
      if (!rows.length) return res.status(404).json({ error: 'Conversación no encontrada.' });
      return res.json(rows[0]);
    }

    const rows = await sbSelect('conversations', {
      select: 'id,titulo,carpeta,created_at,updated_at',
      user_id: `eq.${userId}`,
      carpeta: 'neq.whatsapp',
      order: 'updated_at.desc',
    });
    res.json(rows);
  } catch (err) {
    console.error('conversations GET error:', err);
    res.status(500).json({ error: 'Error al obtener conversaciones' });
  }
}

// `whatsapp` no es una carpeta cualquiera: es la marca con la que
// whatsapp-webhook.js encuentra la memoria del bot, y el GET de acá la excluye a
// propósito. Dejarla escribible desde el chat web permitía inyectar mensajes en
// el hilo que después lee el agente por WhatsApp.
const CARPETA_RESERVADA = 'whatsapp';

function carpetaInvalida(carpeta) {
  return carpeta === CARPETA_RESERVADA;
}

async function handlePost(req, res, userId) {
  const { titulo, carpeta, mensajes } = req.body || {};
  if (carpetaInvalida(carpeta)) {
    return res.status(400).json({ error: 'Esa carpeta está reservada.' });
  }

  try {
    const rows = await sbInsert('conversations', {
      user_id: userId,
      titulo: titulo || 'Nueva conversación',
      carpeta: carpeta || null,
      mensajes: mensajes || [],
    });
    res.json(rows[0]);
  } catch (err) {
    console.error('conversations POST error:', err);
    res.status(500).json({ error: 'Error al crear la conversación.' });
  }
}

async function handlePatch(req, res, userId) {
  const url = new URL(req.url, 'http://x');
  const id = url.searchParams.get('id');
  if (!id) return res.status(400).json({ error: 'Falta id' });

  const { titulo, carpeta, mensajes } = req.body || {};
  if (carpetaInvalida(carpeta)) {
    return res.status(400).json({ error: 'Esa carpeta está reservada.' });
  }
  const updates = { updated_at: new Date().toISOString() };
  if (titulo !== undefined)   updates.titulo   = titulo;
  if (carpeta !== undefined)  updates.carpeta  = carpeta;
  if (mensajes !== undefined) updates.mensajes = mensajes;

  try {
    // user_id como guardia de propiedad (service key, sin RLS real en este camino).
    const rows = await sbUpdate('conversations', { id: `eq.${id}`, user_id: `eq.${userId}` }, updates);
    if (!rows.length) return res.status(404).json({ error: 'Conversación no encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('conversations PATCH error:', err);
    res.status(500).json({ error: 'Error al actualizar la conversación.' });
  }
}

async function handleDelete(req, res, userId) {
  const url = new URL(req.url, 'http://x');
  const id = url.searchParams.get('id');
  if (!id) return res.status(400).json({ error: 'Falta id' });

  try {
    const rows = await sbDelete('conversations', { id: `eq.${id}`, user_id: `eq.${userId}` });
    if (!rows.length) return res.status(404).json({ error: 'Conversación no encontrada.' });
    res.json({ ok: true, deleted: rows[0].id });
  } catch (err) {
    console.error('conversations DELETE error:', err);
    res.status(500).json({ error: 'Error al eliminar la conversación.' });
  }
}

module.exports.config = { maxDuration: 15 };

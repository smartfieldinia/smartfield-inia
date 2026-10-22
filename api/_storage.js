// ════════════════════════════════════════════════════════════════════════
// Helper Supabase Storage — bucket privado 'field-media' con las imágenes
// satelitales históricas por campo ({field_id}/{YYYY-MM}/{indice}.png).
// Acceso REST directo con la SERVICE KEY, mismo patrón cero-dependencias que
// _supabase.js. El bucket lo crea migration_v6_field_media.sql; el tracking de
// qué archivos existen vive en la tabla field_media (no se lista el bucket).
// ════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const BUCKET = 'field-media';

function assertConfig() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Supabase no configurado (falta SUPABASE_URL o SUPABASE_SERVICE_KEY).');
  }
}

function authHeaders(extra = {}) {
  return { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, ...extra };
}

// Path canónico de una imagen: {field_id}/{YYYY-MM}/{indice}.png
function mediaPath(fieldId, mes, indice) {
  return `${fieldId}/${mes}/${indice.toLowerCase()}.png`;
}

// ── UPLOAD: sube (o reemplaza, x-upsert) un PNG. → { ok } | { ok:false, error }
async function stUpload(path, buffer, contentType = 'image/png') {
  assertConfig();
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': contentType, 'x-upsert': 'true' }),
      body: buffer,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { ok: false, error: `Storage upload ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── DOWNLOAD: → { buffer, contentType } | { error } (404 = no existe, no lanza)
async function stDownload(path) {
  assertConfig();
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { error: `Storage download ${res.status}` };
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, contentType: res.headers.get('content-type') || 'image/png' };
  } catch (e) {
    return { error: e.message };
  }
}

// ── LIST: solo para debugging/verificación (el flujo normal usa field_media)
async function stList(prefix) {
  assertConfig();
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefix, limit: 1000 }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Storage list ${res.status}: ${await res.text()}`);
  return res.json();
}

module.exports = { stUpload, stDownload, stList, mediaPath, BUCKET };

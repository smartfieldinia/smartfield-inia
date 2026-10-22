// ════════════════════════════════════════════════════════════════════════
// Helper Supabase (M1) — acceso REST por HTTP directo, sin SDK.
// Usa la SERVICE KEY (omite RLS) para uso server-side: crons, motor de
// alertas y endpoints que actúan en nombre del sistema.
// Mantiene el patrón del proyecto (fetch nativo, cero dependencias).
// ════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL;
// SERVICE_KEY para operaciones admin; cae a la anon key si no está definida.
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

function assertConfig() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Supabase no configurado (falta SUPABASE_URL o SUPABASE_SERVICE_KEY).');
  }
}

// Headers base para la REST API (PostgREST)
function headers(extra = {}) {
  return {
    'Content-Type':  'application/json',
    'apikey':        SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    ...extra,
  };
}

// ── SELECT: sbSelect('alerts', { user_id: 'eq.<id>', order: 'created_at.desc', limit: 5 })
async function sbSelect(table, params = {}) {
  assertConfig();
  const qs = new URLSearchParams({ select: params.select || '*', ...stripSelect(params) });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    headers: headers(),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Supabase SELECT ${table} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── INSERT: devuelve las filas creadas
async function sbInsert(table, rows) {
  assertConfig();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Supabase INSERT ${table} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── UPDATE: sbUpdate('alerts', { id: 'eq.<id>' }, { leido: true })
async function sbUpdate(table, match, patch) {
  assertConfig();
  const qs = new URLSearchParams(match);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Supabase UPDATE ${table} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── DELETE: sbDelete('user_fields', { id: 'eq.<id>' })
async function sbDelete(table, match) {
  assertConfig();
  const qs = new URLSearchParams(match);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'DELETE',
    headers: headers({ Prefer: 'return=representation' }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Supabase DELETE ${table} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── UPSERT: sbUpsert('ndvi_history', [{...}], 'field_id,fecha') — inserta o
// actualiza si ya existe una fila con esas columnas (requiere un constraint
// UNIQUE/PK sobre esas columnas en la tabla). `rows` siempre un array.
async function sbUpsert(table, rows, onConflict) {
  assertConfig();
  const qs = new URLSearchParams({ on_conflict: onConflict });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Supabase UPSERT ${table} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── RPC: sbRpc('match_inia_chunks', { query_embedding, match_count })
async function sbRpc(fn, args = {}) {
  assertConfig();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Supabase RPC ${fn} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// Separa `select` del resto de filtros para no duplicarlo en el querystring
function stripSelect(params) {
  const { select, ...rest } = params;
  return rest;
}

module.exports = { sbSelect, sbInsert, sbUpdate, sbDelete, sbUpsert, sbRpc, SUPABASE_URL };

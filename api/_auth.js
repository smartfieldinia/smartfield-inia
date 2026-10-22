// ════════════════════════════════════════════════════════════════════════
// Middleware de autenticación (M1) — verifica el JWT de Supabase Auth.
// Sin SDK: valida el token contra el endpoint /auth/v1/user de Supabase.
// Uso en cualquier handler:
//
//   const { requireAuth } = require('./_auth');
//   const user = await requireAuth(req, res);
//   if (!user) return;                  // requireAuth ya respondió 401
//   // ... user.id, user.email disponibles
// ════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_KEY;  // anon key para el endpoint de auth

// Extrae el Bearer token del header Authorization
function getToken(req) {
  const h = req.headers['authorization'] || req.headers['Authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

// Devuelve el usuario autenticado o null (no responde)
async function getUser(req) {
  if (!SUPABASE_URL || !ANON_KEY) return null;
  const token = getToken(req);
  if (!token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user && user.id ? user : null;
  } catch {
    return null;
  }
}

// Exige sesión: si no hay usuario válido responde 401 y devuelve null
async function requireAuth(req, res) {
  const user = await getUser(req);
  if (!user) {
    res.status(401).json({ error: 'No autenticado. Inicia sesión.' });
    return null;
  }
  return user;
}

module.exports = { getUser, requireAuth, getToken };

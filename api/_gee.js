const crypto = require('crypto');

// El token de servicio dura una hora, pero se pedía uno nuevo en CADA llamada a
// GEE: con las herramientas del agente corriendo en paralelo eso son seis
// intercambios OAuth simultáneos para un mismo turno. Se reusa mientras le
// queden más de cinco minutos de vida, y la promesa en vuelo se comparte para
// que llamadas concurrentes no disparen un intercambio cada una.
let tokenCacheado = null;   // { token, expira }
let tokenEnVuelo  = null;
const MARGEN_RENOVACION_MS = 5 * 60 * 1000;

async function getGEEToken() {
  if (tokenCacheado && tokenCacheado.expira - Date.now() > MARGEN_RENOVACION_MS) {
    return tokenCacheado.token;
  }
  if (tokenEnVuelo) return tokenEnVuelo;

  tokenEnVuelo = pedirTokenNuevo()
    .then(({ token, expiraEnSeg }) => {
      tokenCacheado = { token, expira: Date.now() + expiraEnSeg * 1000 };
      return token;
    })
    .finally(() => { tokenEnVuelo = null; });

  return tokenEnVuelo;
}

async function pedirTokenNuevo() {
  const email  = process.env.GEE_CLIENT_EMAIL;
  const b64key = process.env.GEE_PRIVATE_KEY_B64;
  const rawkey = process.env.GEE_PRIVATE_KEY;
  if (!email || (!b64key && !rawkey)) throw new Error('Missing GEE env vars');

  const privateKey = b64key
    ? Buffer.from(b64key, 'base64').toString('utf-8')
    : rawkey.replace(/\\n/g, '\n');

  const now     = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: email, scope: 'https://www.googleapis.com/auth/earthengine',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })).toString('base64url');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(privateKey, 'base64url');

  const res  = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${header}.${payload}.${sig}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('GEE token failed: ' + JSON.stringify(data));
  return { token: data.access_token, expiraEnSeg: data.expires_in || 3600 };
}

module.exports = { getGEEToken };

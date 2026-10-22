// ════════════════════════════════════════════════════════════════════════
// Cuota por IP para los endpoints que se pueden usar sin sesión.
//
// Hoy solo lo usa `chat-stream.js`: el chat responde a anónimos a propósito (es
// el demo de la landing), pero el freno de 4 mensajes vivía en el localStorage
// del navegador, así que no frenaba nada. Cada mensaje anónimo cuesta una
// llamada a Groq/Cerebras y, si el agente usa el RAG, un embedding de OpenAI.
//
// Requiere la migración v12 (`rate_limits` + `consumir_rate_limit`). Si la RPC
// no existe o Supabase no responde, esto FALLA ABIERTO: prefiere dejar pasar
// un mensaje de más antes que tirar abajo el chat de producción por un
// problema de infraestructura. Cada fallo queda en el log.
// ════════════════════════════════════════════════════════════════════════

const { sbRpc } = require('./_supabase');

// IP real detrás del proxy de Vercel. `x-forwarded-for` puede traer la cadena
// entera ("cliente, proxy1, proxy2"): la primera es la del cliente.
function ipDe(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'desconocida';
}

// Una IP sola no alcanza como identidad —una oficina entera sale por la misma—,
// pero es lo único que hay antes del login y sirve para lo que importa acá:
// que un script no vacíe la cuota de los proveedores.
async function consumir(clave, { tope, ventanaSeg }) {
  try {
    const filas = await sbRpc('consumir_rate_limit', {
      p_clave: clave, p_ventana_seg: ventanaSeg, p_tope: tope,
    });
    const fila = Array.isArray(filas) ? filas[0] : filas;
    if (!fila || typeof fila.permitido !== 'boolean') return { permitido: true, conteo: null };
    return { permitido: fila.permitido, conteo: fila.conteo };
  } catch (e) {
    console.error('[ratelimit] no se pudo consumir la cuota (se deja pasar):', e.message);
    return { permitido: true, conteo: null, error: true };
  }
}

// Limpieza oportunista: ~1 de cada 200 pedidos borra las claves vencidas. Sin
// esto la tabla acumula una fila por IP para siempre; con pg_cron sería más
// prolijo, pero la extensión no está habilitada en este proyecto.
function limpiezaOportunista() {
  if (Math.random() > 0.005) return;
  sbRpc('limpiar_rate_limits', { p_horas: 24 })
    .then(n => console.log(`[ratelimit] limpieza: ${n} claves vencidas`))
    .catch(() => {});
}

// Cuota del chat anónimo. Dos topes a la vez:
//   - por IP: lo que frena a una persona o un script suelto.
//   - global diario: el techo de gasto del día si alguien reparte el abuso
//     entre muchas IPs (una botnet, o simplemente Tor).
const CUOTA_IP     = { tope: 10,  ventanaSeg: 15 * 60 };
const CUOTA_GLOBAL = { tope: 500, ventanaSeg: 24 * 60 * 60 };

async function permitirChatAnonimo(req) {
  limpiezaOportunista();
  const ip = ipDe(req);

  const porIp = await consumir(`chat:ip:${ip}`, CUOTA_IP);
  if (!porIp.permitido) {
    return { permitido: false, motivo: 'ip', reintentarEn: CUOTA_IP.ventanaSeg };
  }

  const global = await consumir('chat:global', CUOTA_GLOBAL);
  if (!global.permitido) {
    console.warn(`[ratelimit] tope global diario del chat anónimo alcanzado (${global.conteo})`);
    return { permitido: false, motivo: 'global', reintentarEn: CUOTA_GLOBAL.ventanaSeg };
  }

  return { permitido: true };
}

// ── Mensajes gratis sin cuenta (lanzamiento, 2026-10-21) ─────────────────
// Desde que las cuentas son solo por invitación, quien no tiene cuenta puede
// hacer CUPO_ANONIMO preguntas en total: por número en WhatsApp (`wa:+569…`) y
// por navegador en el demo web (`web:<uuid>` que genera el navegador). Es de
// por vida, por eso vive en `cupo_anonimo` (migración v14) y no en
// `rate_limits`, que se limpia cada 24 h.
//
// Falla ABIERTO igual que `consumir`: si la RPC no responde se deja pasar el
// mensaje (y queda en el log). Un problema de infraestructura no puede dejar
// mudo al bot el día del lanzamiento.
const CUPO_ANONIMO = 5;

async function consumirCupoAnonimo(clave, tope = CUPO_ANONIMO) {
  try {
    const filas = await sbRpc('consumir_cupo_anonimo', { p_clave: clave, p_tope: tope });
    const fila = Array.isArray(filas) ? filas[0] : filas;
    if (!fila || typeof fila.permitido !== 'boolean') return { permitido: true, usados: null, restantes: null };
    return { permitido: fila.permitido, usados: fila.usados, restantes: Math.max(0, tope - fila.usados) };
  } catch (e) {
    console.error('[cupo] no se pudo consumir el cupo anónimo (se deja pasar):', e.message);
    return { permitido: true, usados: null, restantes: null, error: true };
  }
}

module.exports = { permitirChatAnonimo, consumir, consumirCupoAnonimo, ipDe, CUOTA_IP, CUOTA_GLOBAL, CUPO_ANONIMO };

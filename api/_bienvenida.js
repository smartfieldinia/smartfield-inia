// ════════════════════════════════════════════════════════════════════════
// Bienvenida por WhatsApp a una cuenta nueva.
//
// El bot no puede escribir primero con texto libre (fuera de la ventana de
// 24 h Meta solo acepta plantillas aprobadas), así que el saludo es la
// plantilla `bienvenida_cuenta_avisa` (marca Avisa, 2026-10; creada con
// scripts/crear-plantillas-avisa.js). Mientras Meta la revisa sale la original
// `bienvenida_cuenta` (scripts/crear-plantilla-bienvenida.js), aprobada.
// El cuerpo de abajo es copia de lo que se mandó a Meta: el texto real vive
// allá y cambiarlo acá no cambia el mensaje (habría que crear una _v2).
//
// Si Meta rechaza la plantilla (p. ej. todavía PENDING: responde #132001) y
// la persona le escribió al bot en las últimas 24 h, el mismo texto sale como
// mensaje libre. Fuera de la ventana no se intenta: Meta acepta el texto y lo
// descarta después en silencio (131047), y el panel diría "enviado" en falso.
//
// Best-effort: nunca lanza. Un WhatsApp que no sale no puede tumbar el
// guardado del perfil ni la acción del admin que lo pidió.
// ════════════════════════════════════════════════════════════════════════

const kapso = require('./_kapso');
const sb = require('./_supabase');

const PLANTILLA = 'bienvenida_cuenta_avisa';
const PLANTILLA_ANTERIOR = 'bienvenida_cuenta';
const IDIOMA = 'es';
const CUERPO = [
  'Hola {{1}}, tu cuenta de Avisa INIA quedó activa con este número de WhatsApp.',
  '',
  'Por aquí recibirás los avisos de helada, calor y vigor satelital de tus campos y el boletín de cada lunes. '
    + 'También puedes escribirle o mandarle una nota de voz a Avisa con tus preguntas de manejo.',
  '',
  'Guarda este número como contacto «Avisa INIA» y respóndenos con un «hola» para empezar.',
].join('\n');

function primerNombre(nombre) {
  return String(nombre || '').trim().split(/\s+/)[0] || 'productor';
}

// Margen bajo las 24 h de Meta: el reloj de ellos manda, no el nuestro.
const VENTANA_MS = 23.5 * 3600 * 1000;

// ¿Escribió la persona al bot dentro de la ventana? Mira el último mensaje
// `user` del hilo de WhatsApp que guarda whatsapp-webhook.js.
async function ventanaAbierta(userId) {
  if (!userId) return false;
  try {
    const hilos = await sb.sbSelect('conversations', {
      select: 'mensajes', user_id: `eq.${userId}`, carpeta: 'eq.whatsapp', order: 'updated_at.desc', limit: 1,
    });
    const msgs = Array.isArray(hilos[0]?.mensajes) ? hilos[0].mensajes : [];
    const ultimo = msgs.filter(m => m.role === 'user' && m.ts).map(m => Date.parse(m.ts)).filter(Number.isFinite).pop();
    return !!ultimo && Date.now() - ultimo < VENTANA_MS;
  } catch (_) {
    return false;
  }
}

async function enviarBienvenida(perfil) {
  if (!perfil || !perfil.whatsapp_phone) return { ok: false, error: 'La cuenta no tiene WhatsApp' };
  try {
    const nombre = primerNombre(perfil.nombre);
    let r = await kapso.sendTemplate(perfil.whatsapp_phone, PLANTILLA, IDIOMA, [nombre]);
    if (!r.ok && /template|132001/i.test(String(r.error || '') + String(r.code || ''))) {
      const nueva = r;
      r = await kapso.sendTemplate(perfil.whatsapp_phone, PLANTILLA_ANTERIOR, IDIOMA, [nombre]);
      if (!r.ok) r = { ...r, code: r.code || nueva.code };
    }
    if (!r.ok && await ventanaAbierta(perfil.id)) {
      const plantilla = r;
      r = await kapso.sendWhatsApp(perfil.whatsapp_phone, CUERPO.replace('{{1}}', nombre));
      r = r.ok ? { ...r, via: 'texto' } : { ...r, plantilla_error: plantilla.error };
    }
    console.log(`[bienvenida] ${r.ok ? 'ok' : 'FALLO'}${r.via ? ` via=${r.via}` : ''} user=${perfil.id || '?'}${r.ok ? '' : ` error=${r.error}`}`);
    return r;
  } catch (e) {
    console.log(`[bienvenida] FALLO user=${perfil.id || '?'} error=${e.message}`);
    return { ok: false, error: e.message };
  }
}

module.exports = { enviarBienvenida, ventanaAbierta, primerNombre, PLANTILLA, PLANTILLA_ANTERIOR, IDIOMA, CUERPO };

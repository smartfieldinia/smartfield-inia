// ════════════════════════════════════════════════════════════════════════
// Normalización de teléfonos a E.164 — un solo formato en toda la base.
//
// Por qué importa más de lo que parece: `whatsapp-webhook.js` identifica al
// agricultor buscando `users_profile.whatsapp_phone = '+<dígitos del remitente>'`.
// Si el número quedó guardado como "9 1234 5678", "56912345678" o
// "+56 9 1234 5678", esa búsqueda no lo encuentra y el productor conversa con el
// bot como si fuera un anónimo: sin sus cuarteles y sin memoria. Y las alertas
// del cron salen contra ese mismo campo.
//
// En BD el número va SIEMPRE con "+" (lo pone registro.html); `_kapso.js` es el
// único que lo pasa a dígitos pelados, porque así lo pide la API de Meta.
// ════════════════════════════════════════════════════════════════════════

// Chile: móviles de 9 dígitos que empiezan en 9. Es el caso real de todos los
// usuarios del piloto, y lo que escribe el wizard de registro.
const CL = '56';

// E.164: "+" + código de país (nunca 0) + hasta 15 dígitos en total.
const E164 = /^\+[1-9]\d{7,14}$/;

// Devuelve el número en E.164, o null si no hay forma de interpretarlo.
// No adivina países: solo completa el +56 de Chile, que es el que el registro
// antepone a mano hoy.
function normalizarTelefono(valor) {
  if (valor == null) return null;
  const crudo = String(valor).trim();
  if (!crudo) return null;

  // Espacios, guiones, puntos y paréntesis son cosméticos.
  const limpio = crudo.replace(/[\s().-]/g, '');

  let candidato;
  if (limpio.startsWith('+')) {
    candidato = limpio;
  } else if (/^\d+$/.test(limpio)) {
    if (limpio.startsWith(CL)) candidato = `+${limpio}`;
    else if (/^9\d{8}$/.test(limpio)) candidato = `+${CL}${limpio}`;   // móvil chileno sin país
    else if (/^0\d+$/.test(limpio)) candidato = `+${CL}${limpio.slice(1)}`; // "0" de larga distancia
    else candidato = `+${limpio}`;
  } else {
    return null;  // trae letras u otros símbolos: no es un teléfono
  }

  return E164.test(candidato) ? candidato : null;
}

// Vacío explícito (borrar el número) vs. valor inválido. El primero es legítimo:
// un usuario puede querer dejar de recibir WhatsApp.
function esBorrado(valor) {
  return valor === null || (typeof valor === 'string' && valor.trim() === '');
}

module.exports = { normalizarTelefono, esBorrado };

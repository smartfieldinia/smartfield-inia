// ════════════════════════════════════════════════════════════════════════
// api/_informe-fuente.js — medir texto en Helvetica sin cargar una fuente.
//
// El informe se dibuja con las fuentes base-14 del PDF (`/Helvetica` y
// `/Helvetica-Bold`), que todo lector trae de fábrica: no hay que embeber un
// TTF, ni parsearlo, ni subsetearlo. Pero para maquetar hay que SABER cuánto
// mide cada línea, y eso lo dan estas tablas: los anchos oficiales de Adobe, en
// milésimas de em (un carácter de 556 a 10 pt ocupa 5,56 pt).
//
// El texto va codificado en WinAnsi (CP1252), que es lo que cubre el español
// completo: á é í ó ú ñ ü ¿ ¡ « » ° · —. Lo que NO cubre son los símbolos que
// el proyecto usa en los mensajes de WhatsApp (▲ ▼ ❄ ☀ 🛰 📋): las flechas se
// dibujan como triángulos y los emoji se limpian antes de entrar al PDF, o
// saldrían como basura.
//
// Helper con `_`: no consume ninguno de los 12 cupos de funciones del plan Hobby.
// ════════════════════════════════════════════════════════════════════════

// Anchos de los caracteres imprimibles ASCII (32..126), en milésimas de em.
const ASCII_REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const ASCII_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

// Los acentuados de WinAnsi miden lo mismo que su letra base — el acento no
// agrega avance. Se listan los que aparecen en español y en los rótulos del
// informe; el resto cae al ancho de la 'n', que es el promedio de la fuente.
const BASE_ACENTUADA = {
  'á':'a','é':'e','í':'i','ó':'o','ú':'u','ü':'u','ñ':'n','Á':'A','É':'E','Í':'I',
  'Ó':'O','Ú':'U','Ü':'U','Ñ':'N','à':'a','è':'e','ì':'i','ò':'o','ù':'u','ç':'c','Ç':'C',
};
// Símbolos de WinAnsi con ancho propio.
const ANCHO_SIMBOLO = { '°': 400, '·': 278, '–': 556, '—': 1000, '«': 556, '»': 556, '¿': 611, '¡': 333, '€': 556 };

function anchoDeCaracter(ch, bold) {
  const tabla = bold ? ASCII_BOLD : ASCII_REGULAR;
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return tabla[c - 32];
  if (ANCHO_SIMBOLO[ch] != null) return ANCHO_SIMBOLO[ch];
  const base = BASE_ACENTUADA[ch];
  if (base) return tabla[base.charCodeAt(0) - 32];
  return tabla['n'.charCodeAt(0) - 32];
}

// Ancho de un texto en puntos, para un cuerpo dado.
function medir(txt, pt, bold = false) {
  let mil = 0;
  for (const ch of String(txt ?? '')) mil += anchoDeCaracter(ch, bold);
  return (mil * pt) / 1000;
}

// Corta un texto en líneas que entren en `maxPt`. Determinista y sin DOM: el
// PDF y el SVG tienen que partir en los mismos lugares o dejan de ser el mismo
// documento. Una palabra más larga que el ancho disponible se parte por letra en
// vez de desbordar.
function partirEnLineas(txt, maxPt, pt, bold = false) {
  const palabras = String(txt ?? '').split(/\s+/).filter(Boolean);
  const lineas = [];
  let actual = '';
  const cabe = s => medir(s, pt, bold) <= maxPt;

  for (const p of palabras) {
    const tentativa = actual ? actual + ' ' + p : p;
    if (cabe(tentativa)) { actual = tentativa; continue; }
    if (actual) { lineas.push(actual); actual = ''; }
    if (cabe(p)) { actual = p; continue; }
    let resto = p;
    while (resto && !cabe(resto)) {
      let i = resto.length;
      while (i > 1 && !cabe(resto.slice(0, i))) i--;
      lineas.push(resto.slice(0, i));
      resto = resto.slice(i);
    }
    actual = resto;
  }
  if (actual) lineas.push(actual);
  return lineas.length ? lineas : [''];
}

// Recorta con puntos suspensivos cuando no hay lugar para envolver (celdas de
// tabla). Devuelve el texto tal cual si ya entra.
function recortar(txt, maxPt, pt, bold = false) {
  const s = String(txt ?? '');
  if (medir(s, pt, bold) <= maxPt) return s;
  const puntos = medir('…', pt, bold);
  let i = s.length;
  while (i > 0 && medir(s.slice(0, i), pt, bold) + puntos > maxPt) i--;
  return s.slice(0, i).trimEnd() + '…';
}

// ── Codificación ────────────────────────────────────────────────────────

// Unicode → WinAnsi (CP1252). Solo se mapea lo que se sale del Latin-1 directo;
// el resto de Latin-1 coincide byte a byte con CP1252.
const A_WINANSI = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91,
  '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98,
  '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

function aWinAnsi(str) {
  const bytes = [];
  for (const ch of String(str ?? '')) {
    const c = ch.codePointAt(0);
    if (A_WINANSI[ch] != null) bytes.push(A_WINANSI[ch]);
    else if (c <= 0xff) bytes.push(c);
    else bytes.push(0x3f);   // '?' — no debería llegar nada acá: ver `limpiar`
  }
  return Buffer.from(bytes);
}

// Quita lo que WinAnsi no puede representar y normaliza lo que sí tiene
// equivalente. El texto de las alertas viene con emoji (`❄️ Alerta de helada`,
// `📋 Resumen semanal`) porque está pensado para WhatsApp: metido tal cual en el
// PDF saldría como una hilera de interrogantes.
function limpiar(str) {
  return String(str ?? '')
    // Emoji, dingbats, flechas, formas geométricas (▲ ▼ ■ ●) y selectores de
    // variación. Las flechas de tendencia del informe NO son caracteres: se
    // dibujan como triángulos vectoriales (`op {t:'tri'}`), justo porque acá no
    // sobrevivirían.
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{2190}-\u{21FF}\u{25A0}-\u{25FF}\u{2B00}-\u{2BFF}]/gu, '')
    .replace(/ /g, ' ')
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

module.exports = { medir, partirEnLineas, recortar, aWinAnsi, limpiar };

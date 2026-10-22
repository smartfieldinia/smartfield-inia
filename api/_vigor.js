// ════════════════════════════════════════════════════════════════════════
// api/_vigor.js — "este cuartel viene cayendo", en UN solo lugar.
//
// Esta regla existía solo en el cliente (`renderRecentTable` de
// `public/app.html`, la tabla "Cuarteles en baja"). El informe semanal necesita
// exactamente la misma respuesta, y copiarla habría dejado dos implementaciones
// del mismo criterio en dos lenguajes distintos: el PDF y la pantalla podrían
// discrepar sobre el mismo cuartel el mismo día. Es el problema que documenta
// `_umbrales.js:8-18`, así que la regla se mueve acá y el front pasa a ser un
// consumidor más.
//
// Qué mide: la variación de la última lectura contra 1, 2, 3 y 4 capturas
// atrás — no contra la anterior sola. Un cuartel puede tropezar una vez por
// nubosidad; lo que interesa es si viene cayendo sostenido (pedido del usuario,
// 2026-08-14).
//
// Helper con `_`: no consume cupo de funciones serverless.
// ════════════════════════════════════════════════════════════════════════

// Cuántas capturas hacia atrás se comparan. Mismo valor que `RECENT_HORIZONTES`
// en `public/app.html`.
const HORIZONTES = 4;

// Colapsa lecturas repetidas: el backfill guarda un punto por mes y el cron uno
// por día, así que la misma mediana de 90 días aparece muchas veces seguidas.
// Sin colapsar, "4 capturas atrás" podían ser 4 copias del mismo número y la
// variación daba 0 % siempre.
function capturasDistintas(serie, clave = 'ndvi') {
  const out = [];
  for (const r of (serie || [])) {
    const v = r[clave];
    if (v == null) continue;
    const ultima = out[out.length - 1];
    if (ultima && ultima.v === v) continue;
    out.push({ fecha: r.fecha, v });
  }
  return out;
}

// Variación porcentual de la última lectura contra cada horizonte.
// `deltas[i]` = contra `i+1` capturas atrás, o `null` si no hay tantas.
function deltasDeCuartel(serie, clave = 'ndvi') {
  const caps = capturasDistintas(serie, clave);
  if (!caps.length) return null;
  const ultima = caps[caps.length - 1];
  const deltas = [];
  for (let n = 1; n <= HORIZONTES; n++) {
    const ref = caps[caps.length - 1 - n];
    // Sin base —o con base 0— el porcentaje no significa nada: se deja vacío en
    // vez de inventar un número o dividir por cero.
    deltas.push(ref && ref.v !== 0
      ? { pct: Math.round(((ultima.v - ref.v) / Math.abs(ref.v)) * 1000) / 10, fecha: ref.fecha, valor: ref.v }
      : null);
  }
  return { ultima, deltas, capturas: caps.length };
}

// Está en baja si cayó en CUALQUIERA de los horizontes.
function enBaja(fila) {
  return !!(fila && fila.deltas.some(d => d && d.pct < 0));
}

// La peor caída de los cuatro horizontes (número negativo), o `null` si no cayó
// en ninguno. Es el criterio de orden de la tabla y del informe.
function peorDelta(fila) {
  if (!fila) return null;
  const bajas = fila.deltas.filter(d => d && d.pct < 0).map(d => d.pct);
  return bajas.length ? Math.min(...bajas) : null;
}

// Un salto enorme hacia arriba en una lectura previa casi nunca es crecimiento
// real: suele ser una captura anterior arruinada por nubes o sombra, que además
// hunde artificialmente la comparación. Se marca para que el informe lo diga
// ("validar en terreno") en vez de reportarlo como una caída limpia.
const SALTO_SOSPECHOSO_PCT = 100;

function saltoSospechoso(fila) {
  return !!(fila && fila.deltas.some(d => d && d.pct > SALTO_SOSPECHOSO_PCT));
}

// Lectura de la serie más cercana a una fecha objetivo. Comparar contra "la
// misma fecha del año pasado" exige esto: Sentinel-2 revisita cada ~5 días y la
// nubosidad se come pasadas, así que casi nunca hay una captura ese día exacto.
// Vive acá, con el resto de la aritmética de series, porque la usan tanto el bot
// (`_agent.js`) como el boletín semanal del cron.
function lecturaMasCercana(serie, objetivoISO, clave = 'ndvi') {
  let mejor = null, mejorDist = Infinity;
  for (const r of (serie || [])) {
    if (r[clave] == null) continue;
    const dist = Math.abs(Date.parse(r.fecha) - Date.parse(objetivoISO));
    if (dist < mejorDist) { mejor = r; mejorDist = dist; }
  }
  return mejor ? { fecha: mejor.fecha, valor: mejor[clave] } : null;
}

module.exports = {
  HORIZONTES, SALTO_SOSPECHOSO_PCT,
  capturasDistintas, deltasDeCuartel, enBaja, peorDelta, saltoSospechoso,
  lecturaMasCercana,
};

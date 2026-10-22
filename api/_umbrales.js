// ════════════════════════════════════════════════════════════════════════
// api/_umbrales.js — los umbrales de riesgo, en UN solo lugar.
//
// Por qué existe (2026-08-14): el cron de alertas leía `alert_rules` por cultivo
// y zona, y la tarjeta de pronóstico del dashboard tenía los suyos escritos a
// mano en `public/app.html` (`FC_UMBRAL_HELADA = 2`, `FC_UMBRAL_CALOR = 35`).
// Mientras `alert_rules` estuviera vacía los dos coincidían por casualidad —
// verificado barriendo de −10 a +50 °C en pasos de 0,1: cero divergencias.
//
// Pero esa tabla es exactamente lo que se le está pidiendo a INIA cerrar (§18.1
// del PRD: umbrales por cultivo y etapa fenológica). El día que la pueblen, el
// cron pasaría a usarlos y la web no: con `temp_min = 4` para un frutal en
// floración y una mínima prevista de 3,5 °C, el productor recibiría "riesgo
// medio" por WhatsApp y leería "sin riesgo de helada" en la pantalla, el mismo
// día y sobre el mismo cuartel. Se midieron 60 pasos de temperatura divergentes.
//
// Los `_` del prefijo no son endpoints, así que este archivo no consume ninguno
// de los 12 cupos de funciones serverless del plan Hobby.
// ════════════════════════════════════════════════════════════════════════

const { sbSelect } = require('./_supabase');

// Defaults si `alert_rules` está vacía o no tiene fila para ese cultivo. NO
// bloquear en que INIA la pueble: la plataforma tiene que funcionar igual.
const UMBRAL_DEFECTO = {
  helada: 2,    // °C: mínima pronosticada por debajo de esto
  calor:  35,   // °C: máxima pronosticada por encima de esto
  sequia: 5,    // mm: lluvia acumulada en 7 días por debajo de esto
  ndvi:   0.15, // caída relativa de NDVI (15 %) entre dos pasadas
  // Fracción del ÁREA observada del cuartel que perdió vigor entre las dos
  // pasadas del Δ. Desde el 2026-09-14 es EL criterio de la alerta satelital
  // (Stanley: "más de un 20% de área roja en el cuartel") y `ndvi` quedó solo
  // para redactar el mensaje. Vive acá y no en el cron para que el día que
  // `alert_rules` se pueble se pueda ajustar por cultivo, igual que los otros.
  area_delta: 0.20,
};

async function getUmbrales(cultivo, zona) {
  const umbral = { ...UMBRAL_DEFECTO, origen: 'defecto' };
  if (!cultivo) return umbral;
  try {
    let rows = await sbSelect('alert_rules', { cultivo: `eq.${cultivo}`, ...(zona ? { zona: `eq.${zona}` } : {}) });
    if (!rows.length && zona) rows = await sbSelect('alert_rules', { cultivo: `eq.${cultivo}` });
    for (const r of rows) {
      if (r.variable === 'temp_min'  && r.umbral_min != null) { umbral.helada = r.umbral_min; umbral.origen = 'alert_rules'; }
      if (r.variable === 'temp_max'  && r.umbral_max != null) { umbral.calor  = r.umbral_max; umbral.origen = 'alert_rules'; }
      if (r.variable === 'precip_7d' && r.umbral_min != null) { umbral.sequia = r.umbral_min; umbral.origen = 'alert_rules'; }
    }
  } catch (_) { /* tabla vacía o error puntual: usar defaults */ }
  return umbral;
}

module.exports = { getUmbrales, UMBRAL_DEFECTO };

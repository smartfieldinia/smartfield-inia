// ════════════════════════════════════════════════════════════════════════
// api/_respaldo-clima.js — balance hídrico de respaldo cuando la API de
// Riesgo Climático del INIA no responde (2026-08-13).
//
// Por qué existe: el host del contrato v1.0 es un devtunnel TEMPORAL y su
// relay lleva días devolviendo 429 con la cuota en cero. Cuando eso pasa y
// además no hay snapshot guardado de esa estación, la tarjeta de balance
// hídrico no tenía nada que mostrar salvo un error — y el dato de fondo
// (cuánta agua llovió y cuánta demandó la atmósfera sobre ESE cuartel) no
// depende de que el túnel de INIA esté arriba.
//
// Fuente del respaldo: Open-Meteo — reanálisis ERA5 interpolado al punto,
// gratis y sin key, con las MISMAS dos variables que usa el cálculo de INIA
// (precipitación diaria y ETo FAO-56). No es la estación INIA y no se hace
// pasar por ella: devuelve `fuente` y `es_respaldo` propios, y la tarjeta lo
// rotula. Es un piso de servicio, no un reemplazo — la estación real mide el
// predio; el reanálisis lo modela en una grilla de ~11 km.
//
// Mismo patrón que el resto de `api/`: fetch nativo, cero dependencias.
// ════════════════════════════════════════════════════════════════════════

const { sumarDias } = require('./_riesgo');

// ── Hoy, en Chile (2026-08-14) ──────────────────────────────────────────
//
// `new Date().toISOString()` da la fecha UTC. Chile es UTC−4 (invierno) y
// UTC−3 (verano), así que entre las 20:00 y las 24:00 hora local el UTC ya está
// en el día siguiente y "ayer" pasaba a ser HOY. Verificado: a las 21:00 CLT el
// balance tomaba la fila del día en curso, que la API de pronóstico entrega con
// `precip` y `eto` no nulos — o sea, `diaCompleto()` la aceptaba y el balance
// metía un PRONÓSTICO dentro de una tarjeta rotulada "días cerrados".
// `api/_sensors.js` ya lo resolvía así; ahora es el criterio de todo el backend.
function hoyEnChile(ahora = new Date()) {
  return ahora.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });   // YYYY-MM-DD
}

// Open-Meteo publica el día en curso incompleto: se corta en ayer, igual que
// `ultimoDiaCerrado()` hace con el último día de INIA.
function ultimoDiaCerradoRespaldo(ahora = new Date()) {
  return sumarDias(hoyEnChile(ahora), -1);
}

// Medido el 2026-08-14: 4 de 19 llamadas al archivo tardaron entre 5,71 y 5,83 s
// contra un corte de 6,0 s. Estaban a menos de 200 ms de perderse, y cuando se
// perdían la serie del año anterior desaparecía en silencio (ver el `catch` de
// `seriesParaPerfil`). El costo real de estas llamadas es handshake TLS y cola
// del proveedor, no volumen de datos, así que dar más margen no cuesta nada.
const TIMEOUT_MS = 9000;

// ── Qué API sirve cada tramo ────────────────────────────────────────────
//
// Son dos servicios con coberturas distintas y PARCIALMENTE SOLAPADAS:
//
//   archive-api  → reanálisis ERA5. Definitivo, pero llega con ~5 días de
//                  retraso: no tiene los días más recientes.
//   forecast     → modelo best-match. Cubre el pasado reciente y el futuro,
//                  pero su ventana de pasado es corta.
//
// El código anterior elegía UNA sola API para todo el rango, y la elegía por
// `hasta`. Eso rompía dos veces:
//
//   1. Un perfil de 90 días termina "ayer" ⇒ iba entero a `forecast`, que
//      ACEPTA `start_date` hasta 92 días atrás pero solo tiene datos reales
//      ~60 días atrás: devolvía 30 filas con todo en `null`. La ventana del
//      año anterior sí iba al archivo y traía los 90 días completos, así que
//      el perfil comparaba 60 días contra 90. Medido: el desfase salía
//      −15,7 °C·día cuando lo correcto era −6,6 (138 % de error, y siempre
//      exagerado en la misma dirección, porque al previo nunca le faltan días).
//   2. Con `dias` entre 94 y 120 (`VENTANA_PERFIL_MAX` es 120) el rango se
//      pasaba de la ventana de `forecast` y devolvía HTTP 400 → el `Promise.all`
//      rechazaba → 502 en pantalla. Medido: 93 OK, 94 rompe.
//
// La solución es partir el rango por la frontera, no elegir una API para todo.
// El corte va en hoy−10: deja margen sobre la latencia del archivo (~5 días) y
// se queda muy dentro de la cobertura real de `forecast` (~60 días).
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const DIAS_FRONTERA = 10;

// Tramos [{ base, desde, hasta }] que cubren el rango sin solaparse.
function tramosDeRango(desde, hasta, ahora = new Date()) {
  const corte = sumarDias(hoyEnChile(ahora), -DIAS_FRONTERA);
  if (hasta < corte)  return [{ base: ARCHIVE,  desde, hasta }];
  if (desde >= corte) return [{ base: FORECAST, desde, hasta }];
  return [
    { base: ARCHIVE,  desde, hasta: sumarDias(corte, -1) },
    { base: FORECAST, desde: corte, hasta },
  ];
}

// ── Caché de instancia (2026-08-14) ─────────────────────────────────────
//
// Este módulo hacía `fetch` crudo en CADA request, mientras que su gemela
// `fetchClimateDaily` de `api/fields.js` sí cacheaba las mismas coordenadas y
// las mismas variables. Y el dato no cambia: un rango que termina "ayer" es
// idéntico durante todo el día. Medido: el perfil de riesgo gastaba entre 1,0 y
// 5,8 s en estas llamadas, con mediana de 2,3 s, en cada carga del dashboard y
// en cada cambio del selector 15/30/60.
//
// Mismo criterio que `fields.js`: coordenadas a 3 decimales (~100 m), porque
// Open-Meteo interpola sobre una grilla de ~11 km y más precisión solo
// fragmentaría la caché sin cambiar un número.
const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRADAS = 60;
const cache = new Map();

function claveCache({ lat, lon, desde, hasta }) {
  return `${lat.toFixed(3)},${lon.toFixed(3)},${desde},${hasta}`;
}

function guardar(clave, datos) {
  cache.set(clave, { datos, expira: Date.now() + TTL_MS });
  if (cache.size > MAX_ENTRADAS) cache.delete(cache.keys().next().value);
}

async function pedirTramo({ base, lat, lon, desde, hasta, signal }) {
  const url = `${base}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
    + `&daily=precipitation_sum,et0_fao_evapotranspiration,temperature_2m_max,temperature_2m_min`
    + `&start_date=${desde}&end_date=${hasta}&timezone=America%2FSantiago`;

  const res = await fetch(url, { signal: signal || AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status} (${base.includes('archive') ? 'archive' : 'forecast'} ${desde}→${hasta})`);
  const cuerpo = await res.json();

  const fechas = cuerpo?.daily?.time || [];
  const lluvia = cuerpo?.daily?.precipitation_sum || [];
  const eto    = cuerpo?.daily?.et0_fao_evapotranspiration || [];
  const tmax   = cuerpo?.daily?.temperature_2m_max || [];
  const tmin   = cuerpo?.daily?.temperature_2m_min || [];

  const num = v => (v == null ? null : Number(v));

  return fechas.map((date, i) => {
    const min = num(tmin[i]);
    return {
      date,
      // null y no 0 si falta: `diaCompleto()` descarta el día en vez de imputar
      // un cero que se leería como "no llovió" o "no hubo demanda".
      precip: num(lluvia[i]),
      eto:    num(eto[i]),
      tmax:   num(tmax[i]),
      tmin:   min,
      // Bandera de helada derivada, no inventada: es literalmente la definición
      // que declara INIA ("helada = temperatura mínima ≤ 0 °C") aplicada a la
      // mínima del día. `heat_wave` NO se deriva a propósito — depende del
      // percentil 90 climatológico de la estación, que este respaldo no tiene,
      // y marcarla en cero diría "no hubo olas de calor" cuando lo cierto es
      // que no se pudieron evaluar.
      frost:  min == null ? null : (min <= 0 ? 1 : 0),
    };
  });
}

// Serie diaria con el mismo shape que /stations/{id}/series de INIA
// ([{ date, precip, eto, tmin, tmax, frost }]), para poder reusar
// `balanceHidrico()` y los perfiles de `_riesgo.js` sin adaptadores.
async function serieDiaria({ lat, lon, desde, hasta, signal }) {
  if (desde > hasta) return [];   // rango invertido (1-jul de GDD, 1-may de frío)

  const clave = claveCache({ lat, lon, desde, hasta });
  const enCache = cache.get(clave);
  if (enCache && enCache.expira > Date.now()) return enCache.datos;

  const tramos = tramosDeRango(desde, hasta);
  const partes = await Promise.all(
    tramos.map(t => pedirTramo({ ...t, lat, lon, signal })));

  // Una fila por fecha, en orden. Los tramos no se solapan por construcción,
  // pero se indexa igual: si alguna vez lo hicieran, gana el archivo (es el
  // reanálisis definitivo; el pronóstico es el que se corrige después).
  const porFecha = new Map();
  partes.flat().forEach(fila => { if (!porFecha.has(fila.date)) porFecha.set(fila.date, fila); });
  const filas = [...porFecha.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

  guardar(clave, filas);
  return filas;
}

// La serie del año anterior es opcional: sin ella se pierde la comparación
// interanual, pero el resto de la tarjeta sigue siendo válido. Lo que NO puede
// pasar es que se pierda en silencio, que es lo que hacía el `.catch(() => [])`
// pelado: con el corte en 6 s se caía 1 de cada 5 veces y nadie se enteraba —
// ni el usuario, que veía "sin historial", ni el log.
function previaOpcional(promesa, etiqueta) {
  return promesa.catch(err => {
    console.warn(`[respaldo-clima] sin serie del año anterior (${etiqueta}): ${err.message}`);
    return [];
  });
}

// Las dos ventanas que necesita el balance: la actual y la misma del año
// anterior. En paralelo — son servicios distintos y ninguno depende del otro.
async function seriesParaBalance({ lat, lon, ultimoDia, margen, signal }) {
  const desde = sumarDias(ultimoDia, -(margen - 1));
  const [actual, previa] = await Promise.all([
    serieDiaria({ lat, lon, desde, hasta: ultimoDia, signal }),
    previaOpcional(
      serieDiaria({ lat, lon, desde: sumarDias(desde, -365), hasta: sumarDias(ultimoDia, -365), signal }),
      'balance'),
  ]);
  return { actual, previa };
}

// Las dos ventanas del perfil de riesgo: la actual y el mismo tramo de la
// temporada anterior, que es contra lo que se mide el desfase térmico.
async function seriesParaPerfil({ lat, lon, ultimoDia, dias, signal }) {
  const desde = sumarDias(ultimoDia, -(dias - 1));
  const [actual, previa] = await Promise.all([
    serieDiaria({ lat, lon, desde, hasta: ultimoDia, signal }),
    previaOpcional(
      serieDiaria({ lat, lon, desde: sumarDias(desde, -365), hasta: sumarDias(ultimoDia, -365), signal }),
      'perfil'),
  ]);
  return { actual, previa };
}

module.exports = {
  serieDiaria, seriesParaBalance, seriesParaPerfil, ultimoDiaCerradoRespaldo,
  hoyEnChile, tramosDeRango,
  FUENTE_RESPALDO: 'Open-Meteo · reanálisis ERA5',
};

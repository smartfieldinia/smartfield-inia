// ════════════════════════════════════════════════════════════════════════
// Helper de sensores por COORDENADAS — para el motor de alertas (crons).
// Reutiliza la misma lógica de clima (Open-Meteo) y satélite (GEE) que el
// chat, pero parametrizada por lat/lon y polígono del campo del usuario.
// ════════════════════════════════════════════════════════════════════════

const { getGEEToken } = require('./_gee');

// ── CLIMA: pronóstico próximo (helada/calor) + lluvia de los últimos 7 días.
// getForecast({ lat, lon }) → { tminProx, tmaxProx, precip7d } (null si falla)
async function getForecast({ lat, lon }) {
  const url = `https://api.open-meteo.com/v1/forecast`
    + `?latitude=${lat}&longitude=${lon}`
    + `&daily=temperature_2m_min,temperature_2m_max,precipitation_sum`
    + `&forecast_days=2&past_days=7&timezone=America%2FSantiago`;
  try {
    const res  = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const data = await res.json();
    const d    = data.daily;
    if (!d || !d.time) return { tminProx: null, tmaxProx: null, precip7d: null };

    // "Hoy" en horario de Chile (YYYY-MM-DD) para separar pasado / futuro
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

    let tminProx = null, tmaxProx = null, precip7d = 0, diasLluvia = 0;
    for (let i = 0; i < d.time.length; i++) {
      const fecha = d.time[i];
      if (fecha < todayStr) {
        // Solo días MEDIDOS. `|| 0` sumaba un cero por cada día sin lectura, y
        // este número es el que dispara la alerta de sequía (<5 mm en 7 días):
        // dos días nulos podían convertir 8 mm reales en 3 mm y mandar un aviso
        // de "falta de agua" que no correspondía.
        const mm = d.precipitation_sum[i];
        if (mm != null) { precip7d += mm; diasLluvia++; }
      } else {
        const tmin = d.temperature_2m_min[i];
        const tmax = d.temperature_2m_max[i];
        if (tmin != null) tminProx = tminProx == null ? tmin : Math.min(tminProx, tmin);
        if (tmax != null) tmaxProx = tmaxProx == null ? tmax : Math.max(tmaxProx, tmax);
      }
    }
    return {
      tminProx,
      tmaxProx,
      // Sin ningún día medido no se puede afirmar que no llovió: `null` para que
      // el motor de alertas no lea "0 mm" y avise de sequía a ciegas.
      precip7d: diasLluvia ? Math.round(precip7d * 10) / 10 : null,
      precip7d_dias: diasLluvia,
    };
  } catch (e) {
    return { tminProx: null, tmaxProx: null, precip7d: null, error: e.message };
  }
}

// ── CLIMA: riesgo de helada y golpe de calor DÍA A DÍA, a 5 días ────────
//
// Pedido de Stanley (reunión INIA Digital, 2026-08-05): que las predicciones de
// helada y calor lleguen a 5 días y que se publique un NIVEL de riesgo, no solo
// un sí/no (referencia: el pronóstico de heladas de Aprilis, en Auravant).
//
// El horizonte de 5 días no es arbitrario: es el tramo en el que un pronóstico
// diario de temperatura todavía sirve para decidir (regar de madrugada, prender
// calefactores, adelantar una cosecha). Más allá se degrada rápido, y Open-Meteo
// entrega hasta 16 pero con incertidumbre que no se puede comunicar en un aviso.
//
// Los CORTES son provisionales, como los del perfil de riesgo: se derivan del
// umbral que ya usa el motor de alertas (helada < 2 °C, calor > 35 °C, ambos
// configurables por usuario en `alert_rules`) abriendo una banda alrededor. No
// consideran etapa fenológica — una helada de −1 °C es crítica en floración e
// inocua en dormancia — y eso hay que decirlo donde se muestren.
const HORIZONTE_RIESGO_DIAS = 5;

function nivelHelada(tmin, heladaC) {
  if (tmin == null) return 'sin_dato';
  if (tmin <= heladaC - 2) return 'alto';     // helada declarada (≤ 0 °C con el umbral por defecto)
  if (tmin <= heladaC)     return 'medio';    // riesgo real de helada
  if (tmin <= heladaC + 2) return 'bajo';     // para vigilar
  return 'nulo';
}

function nivelCalor(tmax, calorC) {
  if (tmax == null) return 'sin_dato';
  if (tmax >= calorC)     return 'alto';
  if (tmax >= calorC - 3) return 'medio';
  if (tmax >= calorC - 5) return 'bajo';
  return 'nulo';
}

const ORDEN_NIVEL = { sin_dato: -1, nulo: 0, bajo: 1, medio: 2, alto: 3 };
const peor = (a, b) => (ORDEN_NIVEL[b] > ORDEN_NIVEL[a] ? b : a);

// getRiesgoProximosDias({ lat, lon, dias, heladaC, calorC }) →
//   { horizonte_dias, dias: [{ fecha, tmin, tmax, helada, calor }],
//     helada: { nivel, fecha, tmin }, calor: { nivel, fecha, tmax } }
// `fecha` de cada resumen es el PRIMER día que alcanza el peor nivel: es el dato
// accionable ("¿cuándo?"), no el más extremo del tramo.
async function getRiesgoProximosDias({ lat, lon, dias = HORIZONTE_RIESGO_DIAS, heladaC = 2, calorC = 35 }) {
  const horizonte = Math.min(Math.max(Math.round(+dias) || HORIZONTE_RIESGO_DIAS, 1), 16);
  const vacio = {
    horizonte_dias: horizonte, dias: [],
    helada: { nivel: 'sin_dato', fecha: null, tmin: null },
    calor:  { nivel: 'sin_dato', fecha: null, tmax: null },
  };
  const url = `https://api.open-meteo.com/v1/forecast`
    + `?latitude=${lat}&longitude=${lon}`
    + `&daily=temperature_2m_min,temperature_2m_max`
    + `&forecast_days=${horizonte}&timezone=America%2FSantiago`;
  try {
    const res  = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const data = await res.json();
    const d    = data.daily;
    if (!d || !d.time || !d.time.length) return vacio;

    const filas = d.time.map((fecha, i) => {
      const tmin = d.temperature_2m_min[i] ?? null;
      const tmax = d.temperature_2m_max[i] ?? null;
      return { fecha, tmin, tmax, helada: nivelHelada(tmin, heladaC), calor: nivelCalor(tmax, calorC) };
    });

    const resumen = (clave, campo) => {
      const nivel = filas.reduce((acc, f) => peor(acc, f[clave]), 'sin_dato');
      const primero = filas.find(f => f[clave] === nivel && nivel !== 'sin_dato');
      return { nivel, fecha: primero?.fecha ?? null, [campo]: primero?.[campo] ?? null };
    };

    return {
      horizonte_dias: horizonte,
      dias: filas,
      helada: resumen('helada', 'tmin'),
      calor:  resumen('calor', 'tmax'),
    };
  } catch (e) {
    return { ...vacio, error: e.message };
  }
}

// ── CLIMA: pronóstico extendido real (hasta 16 días, tope del tier gratuito de
// Open-Meteo) para el chat conversacional — distinto de getForecast() de arriba
// (2 días, solo para el cron de alertas: no se toca para no afectarlo).
// getForecastExtended({ lat, lon, days }) → { horizonte_dias, periodo,
// precipitacion_total_mm, tmin_prevista_C, tmax_prevista_C } (null si falla)
async function getForecastExtended({ lat, lon, days = 16 }) {
  const horizonte = Math.min(Math.max(Math.round(+days) || 16, 1), 16);
  const url = `https://api.open-meteo.com/v1/forecast`
    + `?latitude=${lat}&longitude=${lon}`
    + `&daily=precipitation_sum,temperature_2m_max,temperature_2m_min`
    + `&forecast_days=${horizonte}&timezone=America%2FSantiago`;
  try {
    const res  = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const data = await res.json();
    const d    = data.daily;
    if (!d || !d.time || !d.time.length) {
      return { horizonte_dias: horizonte, periodo: null, precipitacion_total_mm: null, tmin_prevista_C: null, tmax_prevista_C: null };
    }
    let totalPrecip = 0, tmin = null, tmax = null;
    for (let i = 0; i < d.time.length; i++) {
      totalPrecip += (d.precipitation_sum[i] || 0);
      const dtmin = d.temperature_2m_min[i], dtmax = d.temperature_2m_max[i];
      if (dtmin != null) tmin = tmin == null ? dtmin : Math.min(tmin, dtmin);
      if (dtmax != null) tmax = tmax == null ? dtmax : Math.max(tmax, dtmax);
    }
    return {
      horizonte_dias: horizonte,
      periodo: `${d.time[0]} a ${d.time[d.time.length - 1]}`,
      precipitacion_total_mm: Math.round(totalPrecip * 10) / 10,
      tmin_prevista_C: tmin,
      tmax_prevista_C: tmax,
    };
  } catch (e) {
    return { horizonte_dias: horizonte, periodo: null, precipitacion_total_mm: null, tmin_prevista_C: null, tmax_prevista_C: null, error: e.message };
  }
}

// ── CLIMA: promedio histórico de lluvia de un mes calendario en años anteriores
// (referencia, NO pronóstico) — para responder "¿cuánto llueve normalmente este
// mes?" cuando el horizonte real (16 días) no alcanza a cubrir todo el mes.
// getPrecipMensualHistorico({ lat, lon, mes, anios }) → { mes, anios_considerados,
// promedio_mm } (null si falla)
async function getPrecipMensualHistorico({ lat, lon, mes, anios = 3 }) {
  const hoy       = new Date();
  const anioActual = hoy.getUTCFullYear();
  const mesNum    = Math.min(Math.max(Math.round(+mes) || (hoy.getUTCMonth() + 1), 1), 12);
  const nAnios    = Math.min(Math.max(Math.round(+anios) || 3, 1), 5);
  const mm        = String(mesNum).padStart(2, '0');

  try {
    const totales = [];
    for (let i = 1; i <= nAnios; i++) {
      const anio = anioActual - i;
      // El último día se calcula PARA CADA AÑO. Estaba calculado con el año en
      // curso y aplicado a todos: en un año no bisiesto se pedía febrero hasta
      // el 28 y se perdía el 29 de los bisiestos (subestimaba), y estando en un
      // año bisiesto se pedía `2027-02-29`, que no existe → HTTP 400 → los tres
      // años se saltaban y "¿cuánto llueve en febrero?" quedaba sin respuesta.
      const ultimoDia = new Date(Date.UTC(anio, mesNum, 0)).getUTCDate();
      const start = `${anio}-${mm}-01`;
      const end   = `${anio}-${mm}-${String(ultimoDia).padStart(2, '0')}`;
      const url = `https://archive-api.open-meteo.com/v1/archive`
        + `?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}`
        + `&daily=precipitation_sum&timezone=America%2FSantiago`;
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      const d   = (await res.json()).daily;
      if (!d || !d.precipitation_sum) continue;
      // Un año entero sin lecturas no es "un mes de 0 mm": entraba al promedio
      // como si hubiera sido un febrero seco y lo tiraba hacia abajo.
      const medidos = d.precipitation_sum.filter(v => v != null);
      if (!medidos.length) continue;
      totales.push(medidos.reduce((s, v) => s + v, 0));
    }
    if (!totales.length) return { mes: mesNum, anios_considerados: 0, promedio_mm: null };
    const promedio = totales.reduce((s, v) => s + v, 0) / totales.length;
    return { mes: mesNum, anios_considerados: totales.length, promedio_mm: Math.round(promedio * 10) / 10 };
  } catch (e) {
    return { mes: mesNum, anios_considerados: 0, promedio_mm: null, error: e.message };
  }
}

// ── SATÉLITE: bandas medianas Sentinel-2 (B2/B3/B4/B5/B8/B11, nubosidad <30%)
// sobre el polígono, en UNA sola llamada a GEE — base de getIndices()/getNdvi().
// getBands({ polygon, days, endDate }) → { B2,B3,B4,B5,B8,B11 } crudas (0-10000,
// sin dividir) o { error } si falla. polygon = [[lon,lat],...]. endDate (opcional,
// 'YYYY-MM-DD'): ancla la ventana de `days` a esa fecha en vez de hoy — usado por
// el backfill histórico (cron/backfill-field.js) para pedir la misma época del año
// anterior.
// Árbol de expresión compartido: geometría del campo + Image mediana Sentinel-2
// (bounds→fecha→nube encadenados, ImageCollection.reduce+Reducer.median) — base
// tanto de getBands() (values:compute, un escalar por banda) como de
// getNdviThumbnail() (image:computePixels, un PNG). Bandas del resultado quedan
// prefijadas '_median' (Reducer.median): 'B4' -> 'B4_median'.
const MASK_BODY_KEY = 'mask_scl';

// `endMs` (número, ms epoch) tiene prioridad sobre `endDateInput`: lo usa
// getDeltaThumbnail(), que ancla ventanas a instantes exactos (el fin de la
// ventana anterior es el inicio de la actual) y no a medianoche UTC.
function buildMedianImageExpr({ polygon, days, endDateInput, endMs: endMsInput }) {
  const anchor  = endDateInput ? new Date(`${endDateInput}T00:00:00Z`) : new Date();
  const endMs   = Number.isFinite(endMsInput) ? endMsInput : anchor.getTime();
  const startMs = endMs - days * 86400000;

  // Los polígonos subidos por KML traen altitud como 3er valor ([lon,lat,alt],
  // típicamente 0) — GeometryConstructors.Polygon de GEE solo acepta [lon,lat] y
  // responde 400 con coordenadas 3D. Se descarta cualquier valor extra por par.
  const polygon2D = polygon.map(c => [c[0], c[1]]);

  const geometry = {
    functionInvocationValue: {
      functionName: 'GeometryConstructors.Polygon',
      arguments: { coordinates: { constantValue: [polygon2D] } },
    },
  };
  const collection = {
    functionInvocationValue: {
      functionName: 'ImageCollection.load',
      arguments: { id: { constantValue: 'COPERNICUS/S2_SR_HARMONIZED' } },
    },
  };
  // Filtros ENCADENADOS (Collection.filter uno tras otro), no combinados en un solo
  // Filter.and: así GEE aplica el índice espacial de bounds antes de escanear por
  // fecha/nube (combinados, el filtro de bounds no usa el índice y hace timeout).
  const filterStep = (coll, filter) => ({
    functionInvocationValue: { functionName: 'Collection.filter', arguments: { collection: coll, filter } },
  });
  const boundsFilter = { functionInvocationValue: { functionName: 'Filter.intersects', arguments: { leftField: { constantValue: '.geo' }, rightValue: geometry } } };
  const dateFilter   = { functionInvocationValue: { functionName: 'Filter.rangeContains', arguments: { field: { constantValue: 'system:time_start' }, minValue: { constantValue: startMs }, maxValue: { constantValue: endMs } } } };
  const cloudFilter  = { functionInvocationValue: { functionName: 'Filter.lte', arguments: { leftField: { constantValue: 'CLOUDY_PIXEL_PERCENTAGE' }, rightValue: { constantValue: 30 } } } };

  let s2Filtered = filterStep(collection, boundsFilter);
  s2Filtered = filterStep(s2Filtered, dateFilter);
  s2Filtered = filterStep(s2Filtered, cloudFilter);

  // ── Máscara de nubes POR PÍXEL (banda SCL) ──────────────────────────
  //
  // CLOUDY_PIXEL_PERCENTAGE de arriba filtra la ESCENA entera: una escena que
  // pasa con 30% de nubes puede tener justo este cuartel debajo de una, y esa
  // lectura entra en la mediana como si fuera vegetación. SCL descarta píxel
  // por píxel: 3 sombra de nube, 8 nube probable, 9 nube muy probable, 10 cirrus.
  // `Image.remap` los manda a 0 y deja el resto en 1 (defaultValue).
  //
  // Medido el 2026-08-27 sobre 6 cuarteles reales, ventana de 90 días: el NDVI
  // sube entre 0% y 18% al enmascarar — una nube siempre lo deprime, así que
  // subir es la dirección correcta. Con ventanas cortas y cielo cubierto la
  // colección puede quedarse sin píxeles válidos y el resultado es null: eso es
  // lo que se quiere. Sin dato limpio no hay lectura que mostrar ni alerta que
  // disparar; antes se devolvía el NDVI de la nube (0,017 en un pivote regado) y
  // el motor lo leía como una caída de vigor.
  const SCL_NUBE = [3, 8, 9, 10];
  const maskBody = {
    functionInvocationValue: {
      functionName: 'Image.updateMask',
      arguments: {
        image: { argumentReference: 'img' },
        mask: {
          functionInvocationValue: {
            functionName: 'Image.remap',
            arguments: {
              image: { functionInvocationValue: { functionName: 'Image.select', arguments: {
                input: { argumentReference: 'img' }, bandSelectors: { constantValue: ['SCL'] } } } },
              from: { constantValue: SCL_NUBE },
              to:   { constantValue: SCL_NUBE.map(() => 0) },
              defaultValue: { constantValue: 1 },
            },
          },
        },
      },
    },
  };
  // El cuerpo de una función del árbol de expresiones se referencia por nombre,
  // así que vive en `values` junto al nodo raíz: por eso `extraValues`.
  const s2Enmascarada = {
    functionInvocationValue: {
      functionName: 'Collection.map',
      arguments: {
        collection: s2Filtered,
        baseAlgorithm: { functionDefinitionValue: { argumentNames: ['img'], body: MASK_BODY_KEY } },
      },
    },
  };

  // 'ImageCollection.median' NO existe como algoritmo de la REST API de GEE: la
  // reducción se hace con ImageCollection.reduce + Reducer.median.
  const reduced = {
    functionInvocationValue: {
      functionName: 'ImageCollection.reduce',
      arguments: { collection: s2Enmascarada, reducer: { functionInvocationValue: { functionName: 'Reducer.median', arguments: {} } } },
    },
  };

  // `coleccion` es la colección filtrada y enmascarada ANTES del reduce: sirve
  // para contar escenas (Collection.size) sin tocar bandas — ver getDeltaThumbnail.
  return { geometry, reduced, coleccion: s2Enmascarada, polygon2D, startMs, endMs, extraValues: { [MASK_BODY_KEY]: maskBody } };
}

async function getBands({ polygon, days = 90, endDate: endDateInput = null }) {
  if (!polygon || !Array.isArray(polygon) || polygon.length < 3) return {};
  try {
    const token   = await getGEEToken();
    const project = process.env.GEE_PROJECT_ID || 'agragent-491300';
    const { geometry, reduced, extraValues } = buildMedianImageExpr({ polygon, days, endDateInput });

    const expression = {
      result: '0',
      values: {
        ...extraValues,
        '0': {
          functionInvocationValue: {
            functionName: 'Image.reduceRegion',
            arguments: {
              image: reduced,
              reducer:   { functionInvocationValue: { functionName: 'Reducer.mean', arguments: {} } },
              geometry,
              scale:     { constantValue: 10 },
              maxPixels: { constantValue: 1000000000 },
            },
          },
        },
      },
    };

    const geeRes = await fetch(
      `https://earthengine.googleapis.com/v1/projects/${project}/value:compute`,
      {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ expression }),
        signal:  AbortSignal.timeout(30000),
      }
    );
    if (!geeRes.ok) return { error: `GEE ${geeRes.status}` };

    // value:compute responde el valor ya "desenvuelto" a JSON plano, no en el formato
    // ValueNode anidado (dictionaryValue.values[n].floatValue) que se usa en la request.
    const result = await geeRes.json();
    const vals   = result?.result || {};
    return {
      B2: vals['B2_median'], B3: vals['B3_median'], B4: vals['B4_median'],
      B5: vals['B5_median'], B8: vals['B8_median'], B11: vals['B11_median'],
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ── SATÉLITE: visualización por índice — paletas/rangos copiados LITERAL de
// public/app.html (INDEX_CFG) para que la imagen de WhatsApp se vea idéntica a
// la capa del dashboard. TCARI usa RdYlGn invertida (más = más estrés) y NDMI
// BrBG (marrón seco → azul húmedo).
const INDEX_VIZ = {
  NDVI:  { min: -0.2, max: 0.8, palette: ['d73027','f46d43','fdae61','fee08b','ffffbf','d9ef8b','a6d96a','66bd63','1a9850'] },
  NDRE:  { min: -0.5, max: 0.5, palette: ['d73027','f46d43','fdae61','fee08b','ffffbf','d9ef8b','a6d96a','66bd63','1a9850'] },
  EVI:   { min: -0.2, max: 0.8, palette: ['d73027','f46d43','fdae61','fee08b','ffffbf','d9ef8b','a6d96a','66bd63','1a9850'] },
  MSAVI: { min: -0.2, max: 0.8, palette: ['d73027','f46d43','fdae61','fee08b','ffffbf','d9ef8b','a6d96a','66bd63','1a9850'] },
  TCARI: { min:  0,   max: 0.5, palette: ['1a9850','66bd63','d9ef8b','ffffbf','fee08b','fdae61','f46d43','d73027'] },
  NDMI:  { min: -0.5, max: 0.5, palette: ['8c510a','d8b365','f6e8c3','f5f5f5','c7eae5','5ab4ac','01665e'] },
};

// Combinadores del árbol de expresión REST de GEE — nombres y argumentos
// verificados contra GET .../v1/projects/{p}/algorithms (2026-07-18): Image.add/
// subtract/multiply/divide/max usan {image1, image2}; Image.sqrt usa {value};
// Image.constant usa {value}; Image.select usa {input, bandSelectors}.
// 'Image.expression' NO existe en la REST API — por eso EVI/MSAVI/TCARI se arman
// con estos operadores, réplica 1:1 de las fórmulas cliente de app.html.
const geeFn    = (functionName, args) => ({ functionInvocationValue: { functionName, arguments: args } });
const geeConst = v => geeFn('Image.constant', { value: { constantValue: v } });
const geeOp2   = name => (a, b) => geeFn(`Image.${name}`, { image1: a, image2: b });
const gAdd = geeOp2('add'), gSub = geeOp2('subtract'), gMul = geeOp2('multiply'),
      gDiv = geeOp2('divide'), gMax = geeOp2('max'), gGte = geeOp2('gte'), gLt = geeOp2('lt');
const gSqrt = a => geeFn('Image.sqrt', { value: a });
// Banda mediana escalada a reflectancia [0,1] — dividir por 10000 es obligatorio
// para EVI y TCARI (no son invariantes a escala, tienen constantes aditivas).
const geeBand = (reduced, name) =>
  gDiv(geeFn('Image.select', { input: reduced, bandSelectors: { constantValue: [`${name}_median`] } }), geeConst(10000));

// buildIndexImage(reduced, indice) → nodo de expresión con la banda del índice.
// NDVI/NDRE/NDMI van por Image.normalizedDifference (invariante a escala, camino
// ya probado en producción); EVI/MSAVI/TCARI por operadores (MSAVI: el cuadrado
// se hace con multiply(x,x); TCARI: max(b4, 0.0001) evita división por cero).
function buildIndexImage(reduced, indice) {
  const nd = (a, b) => geeFn('Image.normalizedDifference', { input: reduced, bandNames: { constantValue: [`${a}_median`, `${b}_median`] } });
  if (indice === 'NDVI') return nd('B8', 'B4');
  if (indice === 'NDRE') return nd('B8', 'B5');
  if (indice === 'NDMI') return nd('B8', 'B11');

  const b2 = geeBand(reduced, 'B2'), b3 = geeBand(reduced, 'B3'), b4 = geeBand(reduced, 'B4'),
        b5 = geeBand(reduced, 'B5'), b8 = geeBand(reduced, 'B8');
  if (indice === 'EVI') {
    return gDiv(
      gMul(gSub(b8, b4), geeConst(2.5)),
      gAdd(gSub(gAdd(b8, gMul(b4, geeConst(6))), gMul(b2, geeConst(7.5))), geeConst(1))
    );
  }
  if (indice === 'MSAVI') {
    const t = gAdd(gMul(b8, geeConst(2)), geeConst(1)); // 2*B8+1
    return gDiv(gSub(t, gSqrt(gSub(gMul(t, t), gMul(gSub(b8, b4), geeConst(8))))), geeConst(2));
  }
  if (indice === 'TCARI') {
    return gMul(
      gSub(gSub(b5, b4), gMul(gMul(gSub(b5, b3), geeConst(0.2)), gDiv(b5, gMax(b4, geeConst(0.0001))))),
      geeConst(3)
    );
  }
  return null;
}

// ── Escala ajustada al cuartel — misma regla que el dashboard ────────────
//
// Con el rango fijo del índice (NDVI −0,2 a 0,8) un cuartel sano sale entero
// del mismo verde: la foto que llega por WhatsApp no muestra NADA de lo que
// pasa adentro, que es justo donde se toman las decisiones. El dashboard ya
// estiraba la paleta a los percentiles 2 y 98 del contenido real del polígono
// (`escalaDelCuartel()` en public/app.html, pedido de Stanley el 2026-08-05);
// esto lo replica del lado servidor para que la imagen de WhatsApp se vea
// igual que la capa de la web.
//
// p2–p98 y no mín–máx: cuatro píxeles de borde, un camino o una nube residual
// definen el extremo y vuelven a aplastar toda la escala.
const RANGO_MINIMO_ESCALA = 0.05;

async function escalaDelCuartel({ token, project, indexImage, geometry, viz }) {
  const expression = {
    result: '0',
    values: {
      '0': {
        functionInvocationValue: {
          functionName: 'Image.reduceRegion',
          arguments: {
            image: indexImage,
            reducer: {
              functionInvocationValue: {
                functionName: 'Reducer.percentile',
                arguments: { percentiles: { constantValue: [2, 98] } },
              },
            },
            geometry,
            scale:      { constantValue: 10 },   // resolución nativa de las bandas
            maxPixels:  { constantValue: 100000000 },
            bestEffort: { constantValue: true }, // baja la escala solo si el cuartel es enorme
          },
        },
      },
    },
  };

  const res = await fetch(
    `https://earthengine.googleapis.com/v1/projects/${project}/value:compute`,
    {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ expression }),
      // Corto a propósito: si medir el rango se demora, sale la imagen con la
      // escala fija, que es peor pero existe. Nunca se pierde la foto por esto.
      signal:  AbortSignal.timeout(12000),
    }
  );
  if (!res.ok) return null;

  const vals = (await res.json())?.result || {};
  // El nombre de la banda depende de cómo se armó el índice (normalizedDifference
  // la llama 'nd', los que van por operadores heredan otro): se buscan las claves
  // por su sufijo en vez de asumir uno.
  const clave = suf => Object.keys(vals).find(k => k.endsWith(suf));
  const p2  = vals[clave('_p2')];
  const p98 = vals[clave('_p98')];
  if (!Number.isFinite(p2) || !Number.isFinite(p98)) return null;

  // Cuartel casi uniforme: estirar una banda de 0,01 convertiría el ruido del
  // sensor en un arcoíris que se lee como variabilidad real.
  if (p98 - p2 < RANGO_MINIMO_ESCALA) return null;

  const r3 = v => Math.round(v * 1000) / 1000;
  return { min: r3(p2), max: r3(p98) };
}

// ── SATÉLITE: PNG del mapa de un índice (NDVI/NDRE/EVI/MSAVI/TCARI/NDMI),
// recortado al polígono del campo — para mandar como imagen (WhatsApp), no un
// valor. Usa image:computePixels (NO 'computeThumbnail': no existe bajo
// projects.image, confirmado contra el discovery doc real de la REST API).
// Devuelve { buffer, contentType } o { error }.
async function getIndexThumbnail({ polygon, indice = 'NDVI', days = 90, endDate: endDateInput = null, width = 640, height = 640 }) {
  if (!polygon || !Array.isArray(polygon) || polygon.length < 3) return { error: 'sin polígono' };
  const viz = INDEX_VIZ[indice];
  if (!viz) return { error: `índice desconocido: ${indice}` };
  try {
    const token   = await getGEEToken();
    const project = process.env.GEE_PROJECT_ID || 'agragent-491300';
    const { geometry, reduced, polygon2D, extraValues } = buildMedianImageExpr({ polygon, days, endDateInput });

    const indexImage = buildIndexImage(reduced, indice);
    const clipped = {
      functionInvocationValue: {
        functionName: 'Image.clip',
        arguments: { input: indexImage, geometry },
      },
    };
    const expression = { result: '0', values: { ...extraValues, '0': clipped } };

    // Rango real del cuartel; si no se puede medir, queda la escala fija del
    // índice (mismo criterio que el dashboard).
    const escala = await escalaDelCuartel({ token, project, indexImage: clipped, geometry, viz })
      .catch(() => null);
    const rango = escala || { min: viz.min, max: viz.max };

    // affineTransform manual desde el bounding box del polígono — computePixels
    // necesita un grid explícito (dimensiones + transform) para saber qué
    // extensión geográfica cubre cada pixel del PNG de salida.
    const lons = polygon2D.map(c => c[0]), lats = polygon2D.map(c => c[1]);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);

    const geeRes = await fetch(
      `https://earthengine.googleapis.com/v1/projects/${project}/image:computePixels`,
      {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          expression,
          fileFormat: 'PNG',
          grid: {
            dimensions: { width, height },
            affineTransform: {
              scaleX: (maxLon - minLon) / width,
              scaleY: -(maxLat - minLat) / height,
              translateX: minLon,
              translateY: maxLat,
            },
            crsCode: 'EPSG:4326',
          },
          visualizationOptions: {
            ranges: [{ min: rango.min, max: rango.max }],
            paletteColors: viz.palette,
          },
        }),
        signal: AbortSignal.timeout(30000),
      }
    );
    if (!geeRes.ok) return { error: `GEE ${geeRes.status}: ${(await geeRes.text().catch(() => '')).slice(0, 300)}` };
    const buffer = Buffer.from(await geeRes.arrayBuffer());
    return { buffer, contentType: 'image/png' };
  } catch (e) {
    return { error: e.message };
  }
}

// Wrapper de compatibilidad — call-sites existentes (_agent.js) piden NDVI.
async function getNdviThumbnail(opts) {
  return getIndexThumbnail({ ...opts, indice: 'NDVI' });
}

// ── SATÉLITE: PNG del mapa de CAMBIO de un índice (Δ NDVI) ────────────────
//
// Rojo donde el índice bajó, verde donde subió o quedó igual, transparente
// donde el satélite no vio (píxel enmascarado por nubes en alguna de las dos
// ventanas). Es la réplica servidor de la capa DNDVI de public/app.html
// (`resolverVentanasDelta` + paleta binaria `img.gte(0)`): última ventana
// limpia contra la anterior, no "últimos N días contra los N previos" a ciegas.
//
// Por qué no basta con dos ventanas fijas: con la máscara SCL por píxel, en
// invierno una ventana de 5 o 10 días se queda SIN UN SOLO PÍXEL. Así que las
// dos ventanas se buscan hacia atrás por una escalera en días ABSOLUTOS
// [N, 2N, 3N, 30, 45, 60] (tope 60: más allá "el cambio desde la última
// pasada" deja de significar algo) y la `nota` dice con cuáles se armó el Δ.
//
// Tres etapas contra GEE antes del render, y el orden NO es negociable:
//   1. Collection.size de TODAS las candidatas (actuales y anteriores para cada
//      dAct posible) en un solo value:compute. `Collection.size` no toca
//      bandas: una colección vacía responde 0. `reduceRegion` sobre la mediana
//      de una colección vacía NO devuelve 0 — falla con
//      "Image.normalizedDifference: No band named 'B8_median'" y tumba todo lo
//      que viaje en el mismo request (trampa documentada el 2026-08-28).
//   2. Píxeles útiles (Reducer.count) solo de las candidatas actuales con
//      escenas → la primera con píxeles > 0 es la ventana actual.
//   3. Ídem para las anteriores, con la referencia en el inicio de la actual.
// Si la etapa 1 falla (red/GEE) se sigue con las ventanas nominales y
// `nominal: true`, igual que la web: un problema de red no es "cielo vacío".
//
// El tope es un DEFAULT, no una constante de la casa: desde el 2026-09-14 la
// alerta automática lo baja a 15 (pedido de Stanley: "un período de máximo 10 a
// 15 días"). El bot a pedido conserva los 60 — si un productor pregunta en pleno
// invierno, contestar "no hay pasada limpia" es peor que contestar con la de
// hace 40 días diciendo que es de hace 40 días. Una alerta es al revés: se
// dispara sola y no puede afirmar "esto cambió en la última pasada" comparando
// contra un mes y medio atrás.
const DELTA_TOPE_BUSQUEDA_DIAS = 60;

// ── Cuánto tiene que bajar un píxel para contar como "rojo" ────────────
//
// **No es cero, y esto se midió.** Con el corte en 0 —cualquier bajada cuenta—
// el ruido del sensor hace que en un cuartel sano la mitad de los píxeles
// "caiga". Medido contra producción el 2026-09-15 sobre seis cuarteles reales,
// el % de área caída fue de **50 a 98 %** en todos, un día sin ninguna anomalía:
// con el umbral del 20 % que pidió Stanley, los seis habrían alertado, y habrían
// seguido alertando todos los días. Un criterio que dispara siempre no es un
// criterio.
//
//   umbral   Fundo Catapilco  pivote 1-a  Santa Rosa  F. Valdivia  C. Pivote 1  Los Peumos 1
//   Δ<0            57 %          82 %        98 %        50 %         81 %         94 %
//   Δ<−0,03        25 %          56 %        58 %        10 %         56 %         60 %
//   Δ<−0,05        10 %          38 %        22 %         2 %         38 %         26 %
//   Δ<−0,10         0 %          17 %         0 %         0 %         16 %          0 %
//
// 0,10 de NDVI es una caída agronómicamente apreciable, y es el único corte que
// deja al 20 % discriminando: ese día no alerta ninguno, y los dos cuarteles más
// golpeados quedan en 16-17 %, o sea cerca pero abajo.
//
// **Lo usan los tres a la vez** —la alerta, el PNG que va por WhatsApp y la capa
// del mapa— para que el número que afirma la alerta y el rojo que se ve en la
// imagen sean lo mismo. Su gemelo en el cliente es `DELTA_UMBRAL_CAIDA` en
// `public/app.html`: si cambia acá, cambia allá.
const DELTA_UMBRAL_CAIDA = 0.10;
const DELTA_VIZ = { ranges: [{ min: 0, max: 1 }], paletteColors: ['d73027', '1a9850'] }; // = INDEX_CFG.DNDVI
const DIA_MS = 86400000;

const fechaISO = ms => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

// value:compute con timeout; devuelve `result` ya desenvuelto o lanza.
async function geeValueCompute({ token, project, expression, timeoutMs }) {
  const res = await fetch(
    `https://earthengine.googleapis.com/v1/projects/${project}/value:compute`,
    {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ expression }),
      signal:  AbortSignal.timeout(timeoutMs),
    }
  );
  if (!res.ok) throw new Error(`GEE ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return (await res.json())?.result;
}

// Conteo de píxeles con dato del NDVI de una ventana, dentro del polígono.
// scale 60 y no 10: solo hace falta saber si hay dato, no medirlo.
function nodoPixelesUtiles({ polygon, days, endMs }) {
  const { geometry, reduced } = buildMedianImageExpr({ polygon, days, endMs });
  const clipped = geeFn('Image.clip', { input: buildIndexImage(reduced, 'NDVI'), geometry });
  return geeFn('Image.reduceRegion', {
    image:      clipped,
    reducer:    geeFn('Reducer.count', {}),
    geometry,
    scale:      { constantValue: 60 },
    maxPixels:  { constantValue: 100000000 },
    bestEffort: { constantValue: true },
  });
}

// El dict de reduceRegion trae una sola clave (la banda del índice, 'nd' para
// normalizedDifference); se toma el primer número sin asumir el nombre.
const primerNumero = dict => (dict && typeof dict === 'object')
  ? Object.values(dict).find(v => Number.isFinite(v)) ?? null
  : null;

// Resuelve las DOS ventanas del Δ contra GEE y devuelve todo lo necesario para
// armarlo, sin dibujar nada. Se extrajo de `getDeltaThumbnail` el 2026-09-14
// porque la alerta automática necesita el NÚMERO (cuánta área cayó) y no la
// imagen: renderizar un PNG de 640×640 por cuartel, todos los días, para mirarle
// un promedio, era pagar el render para tirarlo.
//
// Devuelve `{ sin_pasada, nota }` si el cielo no dejó con qué comparar, o
// `{ token, project, finMs, corteMs, actual, anterior, ventanas, nota, nominal,
//    extraValues, tiempos }`.
async function resolverDelta({ polygon, dias = 10, topeDias = DELTA_TOPE_BUSQUEDA_DIAS, tiempos = {} }) {
  const tope = Math.min(Math.max(Math.round(+topeDias) || DELTA_TOPE_BUSQUEDA_DIAS, 1), DELTA_TOPE_BUSQUEDA_DIAS);
  const N = Math.min(Math.max(Math.round(+dias) || 10, 1), tope);
  const cronometrar = (clave, desde) => { tiempos[clave] = Date.now() - desde; };

  const token   = await getGEEToken();
  const project = process.env.GEE_PROJECT_ID || 'agragent-491300';
  const finMs   = Date.now();

  const escalera = [...new Set([N, N * 2, N * 3, 30, 45, tope])]
    .filter(d => d <= tope)
    .sort((a, b) => a - b);

  // El cuerpo de la máscara SCL es idéntico para todas las colecciones (solo
  // referencia el argumento `img`), así que un único `extraValues` sirve para
  // todos los nodos del mismo request.
  const { extraValues } = buildMedianImageExpr({ polygon, days: N, endMs: finMs });
  const nodoSize = ({ days, endMs }) =>
    geeFn('Collection.size', { collection: buildMedianImageExpr({ polygon, days, endMs }).coleccion });

  // ── Etapa 1: escenas de cada candidata actual y de cada anterior ──────
  // Orden del array: [act(d0..dK-1), prev(dAct=d0: d0..dK-1), prev(dAct=d1: ...), ...]
  let escenas = null;
  {
    const t = Date.now();
    const nodos = escalera.map(d => nodoSize({ days: d, endMs: finMs }));
    for (const dAct of escalera) {
      const corteMs = finMs - dAct * DIA_MS;
      for (const dPrev of escalera) nodos.push(nodoSize({ days: dPrev, endMs: corteMs }));
    }
    try {
      const r = await geeValueCompute({
        token, project, timeoutMs: 12000,
        expression: { result: '0', values: { ...extraValues, '0': { arrayValue: { values: nodos } } } },
      });
      if (Array.isArray(r) && r.length === nodos.length) escenas = r.map(v => +v || 0);
    } catch (_) { escenas = null; }
    cronometrar('escenas_ms', t);
  }

  // Sondeo de píxeles: `candidatas` = [{dias, escenas}] con escenas > 0, en
  // orden de escalera. Devuelve la primera con píxeles > 0; si el conteo
  // falla, la primera con escenas (al menos tiene bandas y el Δ se arma).
  const elegirPorPixeles = async (candidatas, endMs) => {
    if (!candidatas.length) return null;
    try {
      const r = await geeValueCompute({
        token, project, timeoutMs: 12000,
        expression: { result: '0', values: { ...extraValues, '0': { arrayValue: {
          values: candidatas.map(c => nodoPixelesUtiles({ polygon, days: c.dias, endMs })),
        } } } },
      });
      if (!Array.isArray(r) || r.length !== candidatas.length) return candidatas[0];
      const pix = r.map(primerNumero);
      const i = pix.findIndex(p => p > 0);
      return i >= 0 ? { ...candidatas[i], pixeles: pix[i] } : null;
    } catch (_) {
      return candidatas[0];
    }
  };

  let actual, anterior, nominal = false;
  const K = escalera.length;

  if (!escenas) {
    // Sin sondeo no hay forma de saber si hay pasada: se intenta con la
    // ventana nominal y se dice que es nominal.
    nominal  = true;
    actual   = { dias: N, escenas: null };
    anterior = { dias: N, escenas: null };
    tiempos.actual_ms = 0; tiempos.anterior_ms = 0;
  } else {
    // ── Etapa 2: ventana actual ─────────────────────────────────────────
    {
      const t = Date.now();
      const candidatas = escalera.map((d, i) => ({ dias: d, escenas: escenas[i] })).filter(c => c.escenas > 0);
      actual = await elegirPorPixeles(candidatas, finMs);
      cronometrar('actual_ms', t);
    }
    if (!actual) {
      return { sin_pasada: true, tiempos,
        nota: `El satélite no dejó ninguna pasada limpia sobre el cuartel en los últimos ${tope} días.` };
    }
    // ── Etapa 3: ventana anterior, referida al inicio de la actual ───────
    {
      const t = Date.now();
      const iAct   = escalera.indexOf(actual.dias);
      const base   = K + iAct * K;
      const corteMs = finMs - actual.dias * DIA_MS;
      const candidatas = escalera.map((d, j) => ({ dias: d, escenas: escenas[base + j] })).filter(c => c.escenas > 0);
      anterior = await elegirPorPixeles(candidatas, corteMs);
      cronometrar('anterior_ms', t);
    }
    if (!anterior) {
      return { sin_pasada: true, tiempos,
        nota: `Hay una pasada reciente pero ninguna anterior limpia en los ${tope} días previos: no hay con qué comparar.` };
    }
  }

  const corteMs = finMs - actual.dias * DIA_MS;
  const ventanas = {
    actual:   { desde: fechaISO(corteMs), hasta: fechaISO(finMs), dias: actual.dias },
    anterior: { desde: fechaISO(corteMs - anterior.dias * DIA_MS), hasta: fechaISO(corteMs), dias: anterior.dias },
  };
  const nota = (actual.dias === N && anterior.dias === N)
    ? `Comparado con los ${N} días anteriores`
    : `Nubes: última pasada limpia (${actual.dias} días) contra la anterior (${anterior.dias} días)`;

  return { token, project, finMs, corteMs, actual, anterior, ventanas, nota, nominal, extraValues, tiempos };
}

// Las tres piezas del Δ, ya recortadas al cuartel: el Δ continuo, el binario
// (1 = se mantuvo o subió, 0 = cayó) y el NDVI de la ventana actual. Se arman
// juntas porque el thumbnail y la métrica de área tienen que salir EXACTAMENTE
// de la misma resta: si divergen, la alerta diría un número que la imagen que la
// acompaña no muestra.
function piezasDelta({ polygon, actual, anterior, finMs, corteMs, umbralCaida = 0 }) {
  const exprAct  = buildMedianImageExpr({ polygon, days: actual.dias,   endMs: finMs });
  const exprPrev = buildMedianImageExpr({ polygon, days: anterior.dias, endMs: corteMs });
  const ndviAct  = buildIndexImage(exprAct.reduced, 'NDVI');
  const delta    = gSub(ndviAct, buildIndexImage(exprPrev.reduced, 'NDVI'));
  const geometry = exprAct.geometry;
  const clip = img => geeFn('Image.clip', { input: img, geometry });
  // `soloCaida`: el Δ enmascarado a los píxeles que BAJARON. Su media es cuánto
  // bajó donde bajó — que no es lo mismo que la media del cuartel, y es lo único
  // que se puede decir sin mentir cuando el promedio sube y media hectárea cae.
  const soloCaida = geeFn('Image.updateMask', { image: delta, mask: gLt(delta, geeConst(0)) });
  // `umbralCaida`: cuánto tiene que bajar un píxel para contar como caído. En 0
  // —que es como lo pinta el mapa— cuenta cualquier bajada, y el ruido del
  // sensor hace que en un cuartel sano la mitad de los píxeles "baje".
  const caido = clip(gGte(delta, geeConst(-Math.abs(umbralCaida))));
  return {
    exprAct, geometry,
    delta: clip(delta),
    binario: caido,
    ndviActual: clip(ndviAct),
    soloCaida: clip(soloCaida),
  };
}

// Cuánta ÁREA del cuartel perdió vigor desde la pasada anterior, sin renderizar
// el PNG (Stanley, 2026-09-14: "el criterio es cuando exista más de un 20% de
// área roja en el cuartel").
//
// Por qué área y no promedio: hasta hoy la alerta satelital se disparaba con la
// media del cuartel, y una media esconde exactamente el caso que la alerta
// tendría que cazar — un sector con el riego cortado baja mucho en poco área y
// mueve poco el promedio. El área contesta lo que el productor ve en la imagen.
//
// Las cinco medidas salen de UN solo value:compute, de las MISMAS piezas que
// dibuja el thumbnail:
//   · `area_caida`  = 1 − media del binario. El binario es 1 donde el vigor se
//                     mantuvo o subió, así que su media es la fracción que NO
//                     cayó. Sale directo, sin contar píxeles.
//   · `pixeles`     = píxeles del Δ = los que tienen dato en las DOS ventanas.
//   · `pixeles_vistos` = píxeles de la ventana actual.
//   · `delta_medio` y `ndvi_actual`, la media del cuartel entero.
//   · `delta_medio_caida`, la media del Δ SOLO donde bajó — el número que redacta
//     el mensaje. Medido contra producción el 2026-09-14 en el cuartel "carnes":
//     `area_caida` 52,5 % con `delta_medio` **+0,0052**. O sea que media hectárea
//     perdió vigor mientras el promedio del cuartel SUBÍA: es exactamente el caso
//     que motivó cambiar el criterio, y también la prueba de que el promedio no
//     sirve ni para disparar ni para redactar. Con él, la plantilla habría dicho
//     "el vigor bajó un 0%" junto a una imagen medio roja.
//
// ⚠️ **El denominador de `area_caida` es el área OBSERVADA, no el cuartel.** Los
// píxeles sin dato en alguna de las dos medianas quedan enmascarados y no entran
// en el reduceRegion: con media nube encima, "25 % de área caída" puede ser el
// 25 % de un tercio del cuartel. Por eso viaja `cobertura` (pixeles/vistos) y
// por eso el cron exige un mínimo antes de alertar: un porcentaje sobre cuatro
// píxeles no es una anomalía, es ruido.
//
// ⚠️ El `delta_medio` NO es idéntico al `drop` que calculaba `getIndices`: acá el
// NDVI se calcula por píxel y después se promedia, y allá se promedian las
// bandas y después se calcula el índice (la diferencia de orden de reducción ya
// documentada más abajo). Son parecidos, no iguales; el de acá es el que
// corresponde a la imagen que ve el productor.
async function getDeltaArea({ polygon, dias = 10, topeDias = DELTA_TOPE_BUSQUEDA_DIAS,
                              umbralCaida = DELTA_UMBRAL_CAIDA }) {
  if (!polygon || !Array.isArray(polygon) || polygon.length < 3) return { error: 'sin polígono' };
  const tiempos = {};
  const t0 = Date.now();
  try {
    const d = await resolverDelta({ polygon, dias, topeDias, tiempos });
    if (d.sin_pasada) { tiempos.total_ms = Date.now() - t0; return d; }
    const { token, project, finMs, corteMs, actual, anterior, ventanas, nota, nominal, extraValues } = d;
    const { geometry, delta, binario, ndviActual, soloCaida } = piezasDelta({ polygon, actual, anterior, finMs, corteMs, umbralCaida });

    // Misma escala y mismos límites en los cinco: si `bestEffort` degrada la
    // escala lo hace igual para todos, y la razón `pixeles/vistos` se sostiene.
    const medir = (image, reducer) => geeFn('Image.reduceRegion', {
      image, reducer: geeFn(reducer, {}), geometry,
      scale:      { constantValue: 10 },
      maxPixels:  { constantValue: 100000000 },
      bestEffort: { constantValue: true },
    });

    const t = Date.now();
    const r = await geeValueCompute({
      token, project, timeoutMs: 25000,
      expression: { result: '0', values: { ...extraValues, '0': { arrayValue: { values: [
        medir(binario,    'Reducer.mean'),
        medir(binario,    'Reducer.count'),
        medir(ndviActual, 'Reducer.count'),
        medir(delta,      'Reducer.mean'),
        medir(ndviActual, 'Reducer.mean'),
        medir(soloCaida,  'Reducer.mean'),
      ] } } } },
    });
    tiempos.medir_ms = Date.now() - t;
    tiempos.total_ms = Date.now() - t0;
    if (!Array.isArray(r) || r.length !== 6) return { error: 'GEE no devolvió las seis medidas', ventanas, nota, tiempos };

    const [sano, pix, vistos, dMedio, ndvi, dCaida] = r.map(primerNumero);
    if (!Number.isFinite(sano) || !(pix > 0)) {
      return { sin_pasada: true, ventanas, nota, tiempos,
        nota_detalle: 'Las dos ventanas tienen pasada pero no se solapan en ningún píxel con dato.' };
    }
    return {
      area_caida: 1 - sano,
      pixeles: pix,
      pixeles_vistos: vistos,
      cobertura: vistos > 0 ? pix / vistos : null,
      delta_medio: Number.isFinite(dMedio) ? dMedio : null,
      // Cuánto bajó el NDVI en la zona que bajó. Es el número que corresponde a
      // la frase "el vigor bajó un X%" cuando la alerta se dispara por área.
      delta_medio_caida: Number.isFinite(dCaida) ? dCaida : null,
      ndvi_actual: Number.isFinite(ndvi) ? ndvi : null,
      ventanas, nota, nominal, tiempos,
    };
  } catch (e) {
    tiempos.total_ms = Date.now() - t0;
    return { error: e.message, tiempos };
  }
}

async function getDeltaThumbnail({ polygon, indice = 'NDVI', dias = 10, width = 640, height = 640,
                                   topeDias = DELTA_TOPE_BUSQUEDA_DIAS,
                                   umbralCaida = DELTA_UMBRAL_CAIDA }) {
  if (!polygon || !Array.isArray(polygon) || polygon.length < 3) return { error: 'sin polígono' };
  if (indice !== 'NDVI') return { error: `Δ solo implementado para NDVI (pedido: ${indice})` };

  const tiempos = {};
  const t0 = Date.now();
  const cronometrar = (clave, desde) => { tiempos[clave] = Date.now() - desde; };

  try {
    const d = await resolverDelta({ polygon, dias, topeDias, tiempos });
    if (d.sin_pasada) { cronometrar('total_ms', t0); return d; }
    const { token, project, finMs, corteMs, actual, anterior, ventanas, nota, nominal, extraValues } = d;

    // ── Render: Δ = NDVI(actual) − NDVI(anterior); binario = Δ ≥ 0 ─────────
    // Los píxeles sin dato en cualquiera de las dos medianas quedan
    // enmascarados en la resta y salen con alfa 0 en el PNG.
    const t = Date.now();
    const { exprAct, binario } = piezasDelta({ polygon, actual, anterior, finMs, corteMs, umbralCaida });
    const expression = { result: '0', values: { ...extraValues, '0': binario } };

    const lons = exprAct.polygon2D.map(c => c[0]), lats = exprAct.polygon2D.map(c => c[1]);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);

    const geeRes = await fetch(
      `https://earthengine.googleapis.com/v1/projects/${project}/image:computePixels`,
      {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          expression,
          fileFormat: 'PNG',
          grid: {
            dimensions: { width, height },
            affineTransform: {
              scaleX: (maxLon - minLon) / width,
              scaleY: -(maxLat - minLat) / height,
              translateX: minLon,
              translateY: maxLat,
            },
            crsCode: 'EPSG:4326',
          },
          visualizationOptions: DELTA_VIZ,
        }),
        signal: AbortSignal.timeout(30000),
      }
    );
    cronometrar('render_ms', t);
    cronometrar('total_ms', t0);
    if (!geeRes.ok) {
      return { error: `GEE ${geeRes.status}: ${(await geeRes.text().catch(() => '')).slice(0, 300)}`, ventanas, nota, nominal, tiempos };
    }
    const buffer = Buffer.from(await geeRes.arrayBuffer());
    return { buffer, contentType: 'image/png', ventanas, nota, nominal, tiempos };
  } catch (e) {
    cronometrar('total_ms', t0);
    return { error: e.message, tiempos };
  }
}

// Función PURA (sin red): calcula los 6 índices a partir de bandas crudas de
// reflectancia (0-10000). Replica EXACTO las fórmulas usadas en public/app.html
// (fetchSatellite()/renderIndexLayer()) — dividir por 10000 acá (después de la
// mediana temporal + media espacial que ya hizo GEE) es matemáticamente
// equivalente a dividir antes, porque la división conmuta con ambos reducers.
// ⚠️ ORDEN DE REDUCCIÓN — diferencia conocida con el mapa (2026-08-14)
//
// Acá el índice se calcula sobre las bandas YA PROMEDIADAS espacialmente
// (`getBands` hace `reduceRegion` con `Reducer.mean` y después se aplica la
// fórmula). El panel del mapa de `/app` hace lo contrario: calcula el índice por
// píxel y promedia el resultado.
//
// NO son equivalentes. Los índices son cocientes, así que por la desigualdad de
// Jensen `NDVI(media de bandas) ≠ media de NDVI`: en un cuartel heterogéneo
// —calles, suelo desnudo, bordes— la diferencia se ve en la segunda decimal, y
// el bot puede responder 0,52 donde el mapa muestra 0,57.
//
// Se deja así a propósito por ahora: unificarlo obliga a reescribir las seis
// fórmulas como expresiones de la REST API de GEE (no del SDK JS), que es
// justamente donde ya se pagó un bug caro con los nombres de los algoritmos, y
// no se puede verificar sin credenciales de Earth Engine en el arnés. La ventana
// sí se unificó (90 días en los tres consumidores), que era la diferencia grande:
// con 60 vs 90 días podían ser escenas distintas, no un decimal.
//
// Si se unifica: el criterio correcto es el del mapa (índice por píxel, luego
// promedio), porque es el que corresponde al valor que el productor ve pintado.
function computeIndices({ B2, B3, B4, B5, B8, B11 }) {
  const nulos = { ndvi: null, ndre: null, evi: null, msavi: null, tcari: null, ndmi: null };
  if ([B2, B3, B4, B5, B8, B11].some(v => v == null)) return nulos;
  const b2 = B2 / 10000, b3 = B3 / 10000, b4 = B4 / 10000,
        b5 = B5 / 10000, b8 = B8 / 10000, b11 = B11 / 10000;
  const b4safe = Math.max(b4, 0.0001);
  const r3 = v => Math.round(v * 1000) / 1000;
  return {
    ndvi:  r3((b8 - b4) / (b8 + b4)),
    ndre:  r3((b8 - b5) / (b8 + b5)),
    evi:   r3((2.5 * (b8 - b4)) / (b8 + 6 * b4 - 7.5 * b2 + 1)),
    msavi: r3((2 * b8 + 1 - Math.sqrt((2 * b8 + 1) ** 2 - 8 * (b8 - b4))) / 2),
    tcari: r3(3 * ((b5 - b4) - 0.2 * (b5 - b3) * (b5 / b4safe))),
    ndmi:  r3((b8 - b11) / (b8 + b11)),
  };
}

// getIndices({ polygon, days, endDate }) → { ndvi, ndre, evi, msavi, tcari, ndmi, error? }
async function getIndices({ polygon, days = 90, endDate = null }) {
  const bands = await getBands({ polygon, days, endDate });
  if (bands.error) return { ndvi: null, ndre: null, evi: null, msavi: null, tcari: null, ndmi: null, error: bands.error };
  return computeIndices(bands);
}

// getNdvi({ polygon }) → { ndvi } (null si sin dato/falla) — wrapper de getIndices()
// para no romper los call-sites existentes (backfill-field.js, _agent.js) que solo
// necesitan NDVI; el costo en GEE es el mismo (una sola llamada trae las 6 bandas).
async function getNdvi(opts) {
  const { ndvi, error } = await getIndices(opts);
  return error ? { ndvi: null, error } : { ndvi };
}

module.exports = { getForecast, getForecastExtended, getRiesgoProximosDias,
  // Exportadas para el arnés de paridad pantalla ↔ WhatsApp (scripts/probar-calculos.js):
  // son la ÚNICA implementación de estos niveles desde el 2026-08-14.
  nivelHelada, nivelCalor, HORIZONTE_RIESGO_DIAS, getPrecipMensualHistorico, getBands, computeIndices, getIndices, getNdvi, getNdviThumbnail, getIndexThumbnail, getDeltaThumbnail, getDeltaArea, DELTA_TOPE_BUSQUEDA_DIAS, DELTA_UMBRAL_CAIDA, INDEX_VIZ };

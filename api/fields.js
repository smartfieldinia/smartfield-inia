// ════════════════════════════════════════════════════════════════════════
// api/fields.js — campos/cuarteles del usuario (o de un productor vinculado,
// vía ?as=<producer_id> — ver _authz.js).
//   GET    /api/fields[?as=]                → lista de campos
//   GET    /api/fields?analytics=1&field_id=<id1,id2,...>&days=90[&as=]
//            → analítica comparativa (índices satelitales + clima/GDD, siempre
//            temporada actual vs. la misma ventana hace 1 año) para el
//            dashboard de /app. Rama del mismo handler GET, no un endpoint
//            aparte — el plan Hobby de Vercel tope a 12 funciones serverless.
//            Devuelve además `indicesTemporada`/`indicesTemporadaAnterior`
//            (la temporada agronómica 1-ago → 31-may, para comparar ago-2026→
//            may-2027 contra ago-2025→may-2026) y `gdd.requerimiento` (cuántos
//            grados-día necesita ese cultivo según la tabla de INIA).
//   GET    /api/fields?requerimiento=1
//            → tabla de requerimiento térmico por cultivo/variedad (224 filas,
//            constantes). Otra rama del mismo GET, por el mismo tope de 12.
//   POST   /api/fields?geocode=1  { polygon_coords } → { comuna, region, regionLarga }
//            → ubicación del centroide de un polígono, sin tocar la BD. Lo usa el
//            registro apenas el usuario dibuja un cuartel, para mostrarle la ubicación
//            detectada y dejarlo corregirla antes de guardar; el resultado viaja después
//            en el POST de creación, que así no vuelve a geocodificar. El cliente sigue
//            llamando a /api/geocode: vercel.json lo reescribe acá. Era una función
//            aparte hasta el 2026-07-30, cuando el tope de 12 obligó a consolidarla.
//   POST   /api/fields[?as=]  { ... }       → crea un campo/cuartel
//   PATCH  /api/fields?id=<id>[&as=]        → edita un cuartel: acepta polygon_coords,
//            area_ha, preferencias y los datos del cuartel (nombre, cultivo, variedad,
//            anio_plantacion, sistema_riego). nombre/cultivo no se pueden vaciar.
//   DELETE /api/fields?id=<id>[&as=]        → elimina un cuartel (físico, con cascade)
//
// Nota: antes este POST también sobreescribía users_profile (cultivo_base,
// region, whatsapp_phone, preferencias) en cada llamada — rompía al crear
// varios cuarteles del mismo predio (la 2ª llamada pisaba el perfil con los
// datos del último cuartel). Esa responsabilidad se movió a un PUT explícito
// a /api/profile al final del wizard de registro (ver public/registro.html).
// ════════════════════════════════════════════════════════════════════════

const { requireAuth } = require('./_auth');
const { resolveActingContext, auditarSiAdmin } = require('./_authz');
const { sbInsert, sbUpdate, sbSelect, sbDelete } = require('./_supabase');
const { reverseGeocode, centroidOf } = require('./_geocoding');
// Fecha de Chile, no de UTC: ver el comentario largo en _respaldo-clima.js.
const { hoyEnChile } = require('./_respaldo-clima');
// `GDD_BASE` también sale de acá: había una copia local `const GDD_BASE = 10`
// y mantener dos definiciones de la base de grados-día no tiene defensa.
const { sumarDias, desfaseEnDias, TEXTO_SIN_DESFASE, GDD_BASE } = require('./_riesgo');
// El clima del dashboard sale de la API del INIA, con Open-Meteo solo de relleno.
const { resolverEstacion, serieCuartel, aFilaAnalitica } = require('./_clima-cuartel');
// La temporada de grados-día vive en UN solo lugar (`_agroclim.js`): acá había
// una copia idéntica y había que acordarse de cambiar las dos.
const { temporadaGdd, temporadaFrio, serieFrio } = require('./_agroclim');
const { requerimiento, tablaCompleta, catalogo } = require('./_requerimiento-termico');
// Techo de cuarteles comparables a la vez. No es estético: cada cuartel cuesta
// 2 consultas a la BD + 2 series de clima dentro de `PRESUPUESTO_MS`, y el
// respaldo Open-Meteo no mira ese deadline (9 s por tramo). Medido: 2,8 s con 4
// cuarteles y 365 días. Para ir más allá de 12 hay que paginar la analítica, no
// subir este número. Lo agroclimático NO escala con este tope: va por
// `MAX_GRUPOS_AGROCLIM`, abajo.
const MAX_ANALYTICS_FIELDS = 12;

// Cuántos climas DISTINTOS se calculan por respuesta (grados-día + horas frío).
// No es un tope de cuarteles: los cuarteles que comparten estación INIA —o
// predio, si no hay estación— comparten el clima por construcción, así que un
// campo entero cuesta un solo cómputo por más cuarteles que tenga marcados. Lo
// que se acota acá es la selección que cruza VARIOS campos: cada grupo son 4
// series más (2 de temperatura + 2 horarias de frío) dentro de `PRESUPUESTO_MS`.
const MAX_GRUPOS_AGROCLIM = 3;

// Presupuesto de la invocación, igual que en climate.js: se corta antes de
// `maxDuration` para que el error viaje como JSON y no como un 504 mudo.
const PRESUPUESTO_MS = 24000;

// ── Estación por cuartel, resuelta una sola vez ─────────────────────────
//
// Si la red del INIA no responde, `estacion` queda en null y `serieCuartel` cae
// a Open-Meteo rotulándolo: no es un error, es el modo degradado.
async function resolverEstaciones(campos, historialDesde, deadline) {
  const mapa = new Map();
  await Promise.all(campos.map(async campo => {
    try {
      const { estacion } = await resolverEstacion(campo, { historialDesde, deadline });
      if (estacion) mapa.set(campo.id, estacion);
    } catch (err) {
      console.warn(`[fields] sin estación INIA para ${campo.id}: ${err.code || err.message}`);
    }
  }));
  return mapa;
}

// ── Con qué otros cuarteles comparte el clima ───────────────────────────
//
// Dos cuarteles con la misma clave tienen, por construcción, la MISMA serie de
// temperaturas: si comparten estación INIA la serie sale de la misma llamada a
// `/series`, y si no hay estación el respaldo Open-Meteo resuelve a un predio
// entero dentro de una sola celda de su grilla (~11 km). Por eso los
// grados-día y las horas frío se calculan una vez por clave y se reparten:
// antes se declaraban "de a un cuartel por vez" y se apagaban al marcar el
// segundo, cuando el dato ya estaba pagado.
function claveAgroclim(campo, estacion) {
  if (estacion)        return `est:${estacion.id}`;
  if (campo.predio_id) return `predio:${campo.predio_id}`;
  return `campo:${campo.id}`;
}

// Clima de un cuartel que nunca tira abajo la respuesta entera.
//
// `serieCuartel` propaga a propósito los 4xx del contrato INIA (estación
// inexistente, rango inválido): son errores nuestros y taparlos con el respaldo
// los escondería. Pero propagarlos hasta acá reventaba el `Promise.all` de más
// abajo y devolvía un 500 que se llevaba puesto TODO el dashboard —incluidos el
// gráfico de NDVI y los otros siete cuarteles seleccionados— por un solo
// cuartel mal configurado. El error sigue siendo visible (queda en `motivo` y
// la UI lo muestra), pero acotado a su tarjeta.
async function climaSeguro(args) {
  try {
    return await serieCuartel(args);
  } catch (err) {
    const motivo = err.code || err.message || 'error';
    console.warn(`[fields] clima degradado ${args.campo?.id}: ${motivo}`);
    return {
      dias: [], fuente: 'sin_dato', dias_inia: 0, dias_respaldo: 0,
      eto_origen: 'sin_dato', tramos: [], estacion: null, motivo,
    };
  }
}

// Grados-día del día y acumulado corrido, sobre la serie ya fusionada.
//
// Arranca en `null`, no en 0, y solo se vuelve número cuando hay un primer día
// con temperaturas reales. La diferencia importa: el frontend decide con este
// campo si el eje del gráfico de índices va en grados-día o en fechas, y
// mientras acá salía siempre un número, un cuartel SIN temperaturas declaraba
// "tengo acumulación térmica" con una serie de ceros — y el eje colapsaba.
function conGddAcumulado(dias) {
  let acumulado = null;
  return (dias || []).map(d => {
    const gdd = (d.tmax != null && d.tmin != null) ? Math.max(0, (d.tmax + d.tmin) / 2 - GDD_BASE) : null;
    if (gdd != null) acumulado = (acumulado || 0) + gdd;
    return aFilaAnalitica({ ...d, gdd: gdd != null ? Math.round(gdd * 10) / 10 : null },
                          acumulado == null ? null : Math.round(acumulado * 10) / 10);
  });
}

// Serie de grados-día acumulados de la temporada, en el shape que espera el
// gráfico (`{fecha, gdd, acumulado}`).
function serieGddDiaria(dias) {
  let acumulado = 0;
  const out = [];
  for (const d of (dias || [])) {
    if (d.tmax == null || d.tmin == null) continue;
    const gdd = Math.max(0, (d.tmax + d.tmin) / 2 - GDD_BASE);
    acumulado += gdd;
    out.push({ fecha: d.date, gdd: Math.round(gdd * 10) / 10, acumulado: Math.round(acumulado * 10) / 10 });
  }
  return out;
}

// Adelanto/atraso de temporada — medido en HORIZONTAL sobre las curvas
// acumuladas, igual que el segmento de desfase del gráfico de grados-día
// (`desfaseGdd` en public/app.html).
//
// Es el mismo método y a propósito: el gráfico dibuja "6 días atrasada" y el bot
// tiene que decir lo mismo del mismo cuartel el mismo día. Antes el bot usaba
// una división (diferencia ÷ promedio diario) que además degenera con
// acumulados chicos, así que podían contradecirse abiertamente.
//
// Por qué en horizontal: la pregunta del asesor no es "cuántos °C·día de
// diferencia hay" —eso no se traduce a ninguna acción— sino "cuántos días antes
// o después llegué al mismo punto que el año pasado", que es lo que corre el
// calendario de aplicaciones. Y no degenera: si la temporada anterior nunca
// alcanzó el acumulado actual dentro del período, el desfase no está acotado y
// se dice que no se puede estimar, en vez de inventar un número.
function comparacionDeTemporada(actualGdd, previoGdd) {
  const fin = actualGdd[actualGdd.length - 1];
  const gddActual = fin ? fin.acumulado : 0;
  // El acumulado de la previa A LA MISMA ALTURA de temporada, no su total
  // cerrado: contra el total, cualquier temporada en curso parece atrasadísima
  // (1.684 °D contra 24 °D no compara nada).
  const iMismaFecha = Math.min(actualGdd.length, previoGdd.length) - 1;
  const gddPrevio = iMismaFecha >= 0 ? previoGdd[iMismaFecha].acumulado : 0;
  const base = {
    gdd_actual: gddActual, gdd_anio_anterior: gddPrevio,
    diferencia_gdd: Math.round((gddActual - gddPrevio) * 10) / 10,
  };
  if (!fin || !previoGdd.length) return { ...base, dias_diferencia: null, texto: TEXTO_SIN_DESFASE };

  // Primer día de la temporada anterior que alcanzó el acumulado de hoy.
  const iAlcanza = previoGdd.findIndex(p => p.acumulado >= gddActual);
  if (iAlcanza < 0) return { ...base, dias_diferencia: null, texto: TEXTO_SIN_DESFASE };

  // `día en que la previa llegó` − `día en que estamos`. Si la previa llegó
  // ANTES (índice menor), esta temporada va ATRASADA ⇒ negativo. Es la misma
  // convención y el mismo signo que `desfaseGdd` del gráfico: se verificó que
  // coincidieran, porque con el signo invertido el bot decía "adelantada 6 días"
  // mientras el gráfico dibujaba "6 días atrasada" sobre el mismo cuartel.
  const dias = iAlcanza - (actualGdd.length - 1);
  const texto = dias === 0
    ? 'Esta temporada va en fase con la del año pasado.'
    : `Esta temporada va ${dias > 0 ? 'adelantada' : 'atrasada'} ~${Math.abs(dias)} `
      + `día${Math.abs(dias) === 1 ? '' : 's'} respecto al año pasado.`;
  return { ...base, dias_diferencia: dias, texto };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const caller = await requireAuth(req, res);
  if (!caller) return;
  // `ctx.motivo` decide si una escritura se audita (solo la de un admin sobre
  // otra cuenta, ver `auditarSiAdmin`).
  const ctx = await resolveActingContext(req, res, caller.id);
  if (!ctx) return;
  const { targetId } = ctx;

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    if (url.searchParams.get('analytics') === '1') return handleAnalytics(url, res, targetId);
    // Tabla de requerimiento térmico de INIA. Es estática y no depende del
    // usuario, pero va acá y no en un endpoint propio: el plan Hobby topa en 12
    // funciones serverless y quedan 11 usadas (mismo motivo que `geocode`).
    if (url.searchParams.get('requerimiento') === '1') return handleRequerimiento(res);
    return handleGet(req, res, targetId);
  }
  if (req.method === 'POST') {
    const url = new URL(req.url, 'http://x');
    if (url.searchParams.get('geocode') === '1') return handleGeocode(req, res);
    return handlePost(req, res, targetId, ctx);
  }
  if (req.method === 'PATCH') {
    const url = new URL(req.url, 'http://x');
    if (url.searchParams.get('predio_id') && !url.searchParams.get('id')) return handleRenombrarPredio(req, res, targetId, ctx);
    return handlePatch(req, res, targetId, ctx);
  }
  if (req.method === 'DELETE') return handleDelete(req, res, targetId, ctx);
  return res.status(405).json({ error: 'Método no permitido' });
};

// Geocoding del centroide (ex api/geocode.js). Va por el servidor —y no con un fetch
// directo del navegador— para que el mapa ISO→región viva en un solo lugar
// (_geocoding.js) y para mantener el User-Agent identificable que exige Nominatim.
// Requiere sesión (el requireAuth de arriba ya corrió): no es un proxy abierto.
async function handleGeocode(req, res) {
  const { polygon_coords } = req.body || {};
  if (!Array.isArray(polygon_coords) || polygon_coords.length < 3) {
    return res.status(400).json({ error: 'Falta polygon_coords (mínimo 3 puntos)' });
  }
  // best-effort: si Nominatim falla devuelve nulls, no lanza. El cliente los trata
  // como "no pudimos detectarla" y pide la región a mano.
  res.json(await reverseGeocode(polygon_coords));
}

// Tabla de requerimiento térmico por cultivo/variedad (fuente: Red
// Agrometeorológica de INIA). Son 224 filas de constantes que no cambian nunca,
// así que se cachean fuerte: la UI la pide una vez por sesión.
function handleRequerimiento(res) {
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  res.json({ base_c: GDD_BASE, filas: tablaCompleta(), catalogo: catalogo() });
}

async function handleGet(req, res, userId) {
  try {
    const rows = await sbSelect('user_fields', { user_id: `eq.${userId}`, order: 'created_at.asc' });
    res.json(rows);
  } catch (err) {
    console.error('fields GET error:', err);
    res.status(500).json({ error: 'Error al obtener campos' });
  }
}

function isoDate(d) { return d.toISOString().split('T')[0]; }

// La temporada de frío termina el 30 de septiembre, pero si todavía no llegó
// esa fecha no se le pueden pedir datos futuros al archivo histórico.
function minimoISO(a, b) { return a < b ? a : b; }

// (La caché de clima diario y `fetchClimateDaily`/`pedirClimaDiario` se
// eliminaron el 2026-08-14: el clima del dashboard ya no se pide directo a
// Open-Meteo sino a `serieCuartel`, que consulta la API del INIA primero y tiene
// su propia caché en `_respaldo-clima.js` para el relleno.)

// ── Horas frío acumuladas, día a día (2026-08-13, fuente INIA desde 2026-09-24) ──
//
// La ventana es la temporada de frío (1 de mayo → 31 de julio) y no el rango
// del dashboard: las horas frío se acumulan por temporada, y arrancar la cuenta
// donde arranque el selector daría un número distinto según lo que el usuario
// esté mirando.

// La temporada de acumulación de frío (1-may → 31-jul) se define en
// `_agroclim.js` y se importa de ahí, igual que la de grados-día. Acá vivía una
// copia con su propio literal de fechas: cuando la temporada se acortó a julio
// el 2026-08-24, una de las dos habría quedado atrás sin ningún error visible
// —es exactamente lo que ya pasó con el rango de grados-día del año anterior—.
//
// El rango viaja en el payload (`desde`, `hasta`) y la tarjeta lo imprime desde
// ahí, no desde un texto escrito a mano: hasta el 2026-08-14 el subtítulo decía
// "temporada 2026 (1-abr al 30-sep)" sobre un número acumulado entre otras
// fechas, 62 días de diferencia declarada sobre un indicador que se contrasta
// contra las tablas de requerimientos por variedad.

// Desde el 2026-09-24 la serie sale de `serieFrio` (`_agroclim.js`): horas frío
// DIARIAS de la estación INIA (`chill_hours` de `/series`), con Open-Meteo solo
// de relleno. Es la misma serie que usan la tarjeta de riesgo, el bot y el
// cron — ver el comentario largo en `_agroclim.js`.
//
// La caché queda: la temporada previa está cerrada y no cambia, y la actual
// solo suma un día por día. Coordenadas a 3 decimales (~100 m) porque el
// relleno es de una grilla de ~11 km; la estación va en la clave porque manda.
const chillCache = new Map();
const CHILL_TTL_MS = 6 * 60 * 60 * 1000;

function chillClave({ estacion, lat, lon, desde, hasta }) {
  return `${estacion ? estacion.id : '-'},${lat.toFixed(3)},${lon.toFixed(3)},${desde},${hasta}`;
}

async function chillConCache(opts) {
  const clave = chillClave(opts);
  const ahora = Date.now();
  const guardado = chillCache.get(clave);
  if (guardado && guardado.expira > ahora) {
    chillCache.delete(clave); chillCache.set(clave, guardado);
    return guardado.datos;
  }
  const datos = await serieFrio(opts);
  if (datos.daily.length) {
    chillCache.set(clave, { datos, expira: ahora + CHILL_TTL_MS });
    while (chillCache.size > 20) chillCache.delete(chillCache.keys().next().value);
  }
  return datos;
}

// ── Grados-día acumulados por TEMPORADA (2026-08-13, corregida 2026-08-21) ──
//
// El acumulado que se mostraba arrancaba donde arrancara el rango elegido en
// pantalla: con "365 días" partía en agosto del año pasado y con "90 días" en
// mayo, así que el mismo cuartel exhibía un GDD distinto según lo que el
// usuario estuviera mirando y no correspondía a ninguna temporada. Por eso los
// números no le cuadraban a nadie que los contrastara con una fuente seria.
//
// La temporada es fija y el acumulado siempre parte de su primer día, mire lo
// que mire el selector. **Va del 1 de agosto al 31 de mayo**, que es como la
// acumula la Red Agrometeorológica de INIA — el rango y el porqué están en
// `_agroclim.js`, que es de donde se importa: acá había una copia idéntica y
// mantener dos definiciones de la temporada ya se pagó una vez.
//
// Base 10 °C (`GDD_BASE`, importada de `_riesgo.js`): es la de la vid y la
// mayoría de los frutales, y la del índice de Winkler. La tabla de INIA
// (`_requerimiento-termico.js`) también publica todo en base 10; lo que cambia
// por cultivo es el requerimiento acumulado, no la base.

function temporadaConBase(refISO = hoyEnChile()) {
  return { ...temporadaGdd(refISO), base_c: GDD_BASE };
}


// ── Grados-día de la temporada, para UN clima ──────────────────────────
//
// `campo` y `estacion` son los del cuartel REPRESENTANTE del grupo: lo único
// que se usa de él es su geometría y su estación, que son justamente lo que
// comparte con los demás cuarteles del grupo. El requerimiento térmico NO sale
// de acá —depende del cultivo, que es de cada cuartel— y se agrega al repartir.
async function agroclimGdd({ campo, estacion, toISO, deadline }) {
  const temp = temporadaConBase();
  const hastaHoy = minimoISO(temp.hasta, toISO);
  // La temporada anterior se deriva de `temporadaGdd`, NO de fechas escritas a
  // mano: acá decía `-07-01`/`-04-30` (el rango viejo) y quedó sin cambiar
  // cuando la temporada pasó a ago→may el 2026-08-21. El frontend ancla esta
  // curva al 1 de agosto, así que la serie arrancaba 31 días ANTES de su propio
  // origen: el eje del gráfico partía en julio y cortaba en abril, y el "a la
  // misma fecha" comparaba días corridos desalineados.
  const tempPrevia = temporadaGdd(`${temp.anio - 1}-08-01`);
  // También por `serieCuartel`: los grados-día de la temporada tienen que salir
  // de la misma fuente que las temperaturas del gráfico de arriba.
  const [serieGdd, serieGddPrevia] = await Promise.all([
    climaSeguro({ campo, estacion, desde: temp.desde, hasta: hastaHoy, deadline }),
    climaSeguro({ campo, estacion, desde: tempPrevia.desde, hasta: tempPrevia.hasta, deadline }),
  ]);
  const actualGdd = serieGddDiaria(serieGdd.dias);
  const previoGdd = serieGddDiaria(serieGddPrevia.dias);
  // Las mínimas y máximas crudas de la temporada. Ya vinieron en la misma
  // descarga que alimenta los grados-día y hasta ahora se tiraban después de
  // promediarlas; el informe semanal dibuja con ellas su gráfico de
  // temperaturas, sin pagar una segunda serie.
  //
  // Van como hermanas de `gdd` y NO adentro: el handler solo reenvía
  // `agro.gdd`, `agro.chill`, `agro.comparacionTemporada` y `agro.origen` al
  // navegador, así que esto no engorda la respuesta del dashboard, que ya trae
  // su propia serie de temperaturas por el rango de analítica.
  const soloTemps = dias => (dias || [])
    .filter(d => d && (d.tmin != null || d.tmax != null))
    .map(d => ({ fecha: d.date, tmin: d.tmin ?? null, tmax: d.tmax ?? null }));
  const dias = actualGdd.length;
  const gdd = {
    base_c: GDD_BASE,
    temporada: temp.anio, temporada_previa: temp.anio - 1,
    desde: temp.desde, hasta: temp.hasta,
    daily: actualGdd, dailyAnioAnterior: previoGdd,
    dias_corridos: dias,
    total: dias ? actualGdd[dias - 1].acumulado : null,
    // A la misma altura de la temporada, que es lo comparable; y el total
    // cerrado del año pasado como referencia de cuánto llegó a acumular.
    total_anio_anterior_a_la_fecha: previoGdd.length
      ? previoGdd[Math.min(dias, previoGdd.length) - 1]?.acumulado ?? null : null,
    total_anio_anterior_completo: previoGdd.length ? previoGdd[previoGdd.length - 1].acumulado : null,
    fuente: serieGdd.fuente,
  };

  // Mismo criterio que el perfil de riesgo y el bot (`desfaseEnDias` de
  // _riesgo.js), sobre la serie de temporada que se acaba de traer. Antes esto
  // lo calculaba `_agroclim.compararGradosDia` con dos descargas propias a
  // Open-Meteo: era una cuarta fuente para el mismo número, y podía contradecir
  // a la pantalla.
  // La serie previa va COMPLETA: el método horizontal necesita ver hasta dónde
  // llegó para poder decir cuándo alcanzó el acumulado de hoy.
  return {
    gdd,
    temps: {
      desde: temp.desde, hasta: temp.hasta,
      daily: soloTemps(serieGdd.dias),
      dailyAnioAnterior: soloTemps(serieGddPrevia.dias),
      fuente: serieGdd.fuente,
    },
    comparacionTemporada: comparacionDeTemporada(actualGdd, previoGdd),
  };
}

// ── Horas frío de la temporada, para UN clima ──────────────────────────
async function agroclimChill({ estacion, centroid, toISO, deadline }) {
  const temp = temporadaFrio();
  // `temporadaFrio` toma una fecha ISO (no un Date): se le pasa el 1 de junio
  // del año anterior, que cae dentro de esa temporada de frío.
  const previa = temporadaFrio(`${temp.anio - 1}-06-01`);
  const base = { estacion, lat: centroid.lat, lon: centroid.lon, deadline };
  // Las dos series se degradan a vacío si tardan o fallan: con varios climas
  // por respuesta, una sola serie lenta se llevaba puesto el dashboard entero.
  const vacia = { daily: [], fuente: null, umbral_c: null, estacion: null };
  // Pasado el 31 de julio el frío sigue acumulándose, y Stanley lo quiere ver
  // (2026-09-24): "está bien que diga las acumuladas a la fecha, pero cuando
  // compare debe hacerlo al 31 de julio entre ambos años". La comparación y la
  // curva se quedan en la temporada; el acumulado a la fecha va aparte, de la
  // MISMA serie de la estación.
  const [actual, anterior, aLaFecha] = await Promise.all([
    chillConCache({ ...base, desde: temp.desde, hasta: minimoISO(temp.hasta, toISO) }).catch(() => vacia),
    chillConCache({ ...base, desde: previa.desde, hasta: previa.hasta }).catch(() => vacia),
    toISO > temp.hasta
      ? chillConCache({ ...base, desde: temp.desde, hasta: toISO }).catch(() => vacia)
      : Promise.resolve(null),
  ]);
  const ultimoALaFecha = aLaFecha && aLaFecha.daily.length ? aLaFecha.daily[aLaFecha.daily.length - 1] : null;
  const actualChill = actual.daily, previaChill = anterior.daily;
  // La temporada en curso lleva menos días que la anterior completa:
  // compararla contra el TOTAL del año pasado diría "vamos peor" incluso en una
  // temporada más fría de lo normal. Se compara contra el mismo día de
  // temporada — el mismo criterio que usa la curva del gráfico.
  const diasCorridos = actualChill.length;
  const previaMismaFecha = previaChill.length
    ? previaChill[Math.min(diasCorridos, previaChill.length) - 1]?.acumulado ?? null
    : null;
  const total = diasCorridos ? actualChill[diasCorridos - 1].acumulado : null;

  return {
    // null cuando el dato es de la estación: la API no documenta el umbral de
    // `chill_hours` y la pantalla no afirma uno (ver `_agroclim.js`).
    umbral_c: actual.umbral_c,
    temporada: temp.anio, temporada_previa: previa.anio,
    desde: temp.desde, hasta: temp.hasta,
    daily: actualChill, dailyAnioAnterior: previaChill,
    dias_corridos: diasCorridos,
    // ¿Ya cerró la temporada? En ese caso "a la misma fecha" y "cerró con" son
    // el mismo número y la pantalla dice uno solo.
    cerrada: actualChill.length > 0 && actualChill[diasCorridos - 1].fecha >= temp.hasta,
    total,
    // Antes era el total de `/accumulation` (1-may → HOY, temporada anual de la
    // red), que en septiembre ya no tenía nada que ver con esta curva. Ahora es
    // el total de la MISMA serie, cuando viene de la estación.
    total_inia: actual.fuente === 'inia' ? total : null,
    fuente_total: actual.fuente,
    fuente_curva: actual.fuente,
    fuente_previa: anterior.fuente,
    estacion: actual.estacion,
    total_anio_anterior_a_la_fecha: previaMismaFecha,
    total_anio_anterior_completo: previaChill.length ? previaChill[previaChill.length - 1].acumulado : null,
    // Del 1-may hasta ayer, solo con la temporada ya cerrada. Es el número que
    // se compara contra el requerimiento de la variedad (los HF7 de INIA son de
    // la dormancia completa, que sigue después de julio); NO entra en la
    // comparación entre años, que es al 31 de julio.
    acumulado_a_la_fecha: ultimoALaFecha ? ultimoALaFecha.acumulado : null,
    a_la_fecha_hasta: ultimoALaFecha ? ultimoALaFecha.fecha : null,
  };
}

// ── Un cómputo agroclimático por CLIMA, no por cuartel ──────────────────
//
// Hasta el 2026-09-07 los grados-día y las horas frío se calculaban dentro de
// un `if (campos.length === 1)`: marcar un segundo cuartel apagaba los dos
// gráficos para TODA la selección —incluido el cuartel en foco— con el cartel
// "se calculan para un cuartel a la vez". Pero el clima no es del cuartel: los
// 35 cuarteles de un mismo predio comparten estación y comparten serie, cosa
// que el propio código ya sabía para las llamadas a `/series`. Agrupando por
// `claveAgroclim`, un campo entero vale lo mismo que un cuartel suelto.
//
// El tope (`MAX_GRUPOS_AGROCLIM`) acota la selección que cruza varios campos:
// ahí sí cada grupo son cuatro series más contra `PRESUPUESTO_MS`. Los que
// quedan fuera se marcan `omitido` para que la UI diga la razón real en vez de
// culpar al cuartel.
//
// `tope` es un parámetro y no la constante a secas porque el 3 protege al
// DASHBOARD, que tiene 24 s y se los pelea con GEE. El informe semanal corre en
// un cron de 300 s, después del bucle de alertas y sin GEE en paralelo, y desde
// que hay un informe POR PREDIO (2026-09-14) necesita el clima de TODOS los
// predios del usuario: con el tope en 3, el cuarto predio saldría sin sus tres
// gráficos agroclimáticos, que es justo lo que ese cambio vino a arreglar.
async function calcularAgroclim(campos, estaciones, toISO, deadline, { tope = MAX_GRUPOS_AGROCLIM } = {}) {
  const grupos = new Map();
  for (const campo of campos) {
    const estacion = estaciones.get(campo.id) || null;
    const clave = claveAgroclim(campo, estacion);
    let g = grupos.get(clave);
    if (!g) { g = { estacion, representante: null, centroid: null, campos: [] }; grupos.set(clave, g); }
    g.campos.push(campo);
    // El representante es el primer cuartel del grupo con geometría usable: sin
    // centroide no hay ni serie de respaldo ni horas frío.
    if (!g.representante) {
      const c = centroidOf(campo.polygon_coords);
      if (c) { g.representante = campo; g.centroid = c; }
    }
  }

  const lista = [...grupos.values()];
  const elegidos = lista.slice(0, tope);
  const porCampo = new Map();

  // Los grupos que no entran igual devuelven una entrada: `omitido` es lo que
  // deja a la pantalla explicar por qué falta el gráfico.
  for (const g of lista.slice(tope)) {
    for (const campo of g.campos) porCampo.set(campo.id, { omitido: true });
  }

  await Promise.all(elegidos.map(async g => {
    if (!g.representante) return;
    const origen = {
      cuartel: g.representante.nombre,
      cuarteles: g.campos.length,
      predio_nombre: g.representante.predio_nombre || null,
      estacion: g.estacion ? g.estacion.name : null,
      compartido: g.campos.length > 1,
    };
    const [porGdd, chill] = await Promise.all([
      agroclimGdd({ campo: g.representante, estacion: g.estacion, toISO, deadline }),
      agroclimChill({ estacion: g.estacion, centroid: g.centroid, toISO, deadline }),
    ]);
    for (const campo of g.campos) {
      porCampo.set(campo.id, {
        gdd: porGdd.gdd, chill, temps: porGdd.temps,
        comparacionTemporada: porGdd.comparacionTemporada, origen,
      });
    }
  }));

  return { porCampo, grupos: lista.length, calculados: elegidos.length };
}

// Analítica comparativa: por cada field_id pedido, devuelve SIEMPRE la serie
// del período actual y la del mismo período hace 1 año (índices satelitales +
// clima/GDD), para overlay directo en el dashboard.
async function handleAnalytics(url, res, targetId) {
  const idsParam = url.searchParams.get('field_id');
  if (!idsParam) return res.status(400).json({ error: 'Falta field_id' });
  const idsPedidos = idsParam.split(',').map(s => s.trim()).filter(Boolean);
  const ids = idsPedidos.slice(0, MAX_ANALYTICS_FIELDS);
  // Cuántos quedaron fuera del tope. Antes se recortaba en silencio y la
  // pantalla decía "comparando todos" mostrando ocho de treinta y seis.
  const omitidos = idsPedidos.length - ids.length;
  // Tope 1100 días (~3 años): cubre "historial completo desde 2024" del selector
  // de rango en app.html, no solo el uso normal de 90d/365d.
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days'), 10) || 90, 7), 1100);

  try {
    // Guardia de propiedad: solo campos del propio usuario (o del productor bajo
    // ?as=) — los field_id pedidos que no le pertenezcan quedan afuera en silencio.
    const encontrados = await sbSelect('user_fields', {
      // `estacion_id` lo agrega la migración v7: es la estación que el usuario
      // fijó a mano, y `resolverEstacion` la respeta por sobre la proximidad.
      // `variedad` y `predio_id` los pide el bloque de requerimiento térmico y
      // el agrupamiento por campo del dashboard.
      select: 'id,nombre,predio_id,predio_nombre,cultivo,variedad,area_ha,polygon_coords,estacion_id',
      id: `in.(${ids.join(',')})`, user_id: `eq.${targetId}`,
    });

    // Devolver los cuarteles en el orden en que el usuario los pidió. PostgREST
    // con `in.()` no garantiza ninguno, y varias tarjetas del dashboard (las
    // temperaturas, la lluvia, los grados-día) dibujan `fields[0]`: sin este
    // orden, el gráfico mostraba un cuartel al azar y cambiaba solo al agregar
    // o sacar otro de la comparación.
    const porId = new Map(encontrados.map(c => [c.id, c]));
    const campos = ids.map(id => porId.get(id)).filter(Boolean);

    // Alertas de los últimos 14 días sobre los cuarteles pedidos, para el KPI
    // "Alertas · 14 días" del dashboard. Reemplaza al total histórico de no
    // leídas que traía /api/profile (635 en una cuenta real: no decía nada).
    // Corre en paralelo con el resto; si falla, el KPI muestra "—", no un cero.
    const desde14dISO = new Date(Date.now() - 14 * 86400000).toISOString();
    const alertas14dPromesa = campos.length
      ? sbSelect('alerts', {
          select: 'id', user_id: `eq.${targetId}`,
          field_id: `in.(${campos.map(c => c.id).join(',')})`,
          created_at: `gte.${desde14dISO}`,
        }).then(filas => filas.length).catch(() => null)
      : Promise.resolve(0);

    // Todo el calendario se ancla en la fecha de CHILE. Con `new Date()` en UTC,
    // entre las 20:00 y las 24:00 locales "ayer" pasaba a ser hoy y el rango se
    // corría un día completo (ver _respaldo-clima.js).
    const toISO      = sumarDias(hoyEnChile(), -1);
    const fromISO    = sumarDias(toISO, -(days - 1));
    const toAntISO   = sumarDias(toISO, -365);
    const fromAntISO = sumarDias(fromISO, -365);

    const deadline = Date.now() + PRESUPUESTO_MS;

    // Temporada agronómica para las curvas de índices (1 ago → 31 may). Se
    // corta en `toISO` porque la temporada en curso todavía no terminó; la
    // anterior va completa, que es contra lo que se compara.
    const tempIdx      = temporadaConBase();
    const tempIdxHasta = minimoISO(tempIdx.hasta, toISO);
    const tempIdxPrev  = temporadaGdd(`${tempIdx.anio - 1}-08-01`);

    // ── Estación de cada cuartel, resuelta UNA vez ──────────────────────
    //
    // La caché de `_boletin.js` es por path, así que varios cuarteles del mismo
    // predio comparten estación ⇒ comparten también la llamada a `/series`. El
    // costo contra INIA es por ESTACIÓN distinta, no por cuartel: 8 cuarteles de
    // 2 predios en un año son 6 llamadas, no 16.
    const estaciones = await resolverEstaciones(campos, fromAntISO, deadline);

    // ── Grados-día y horas frío: un cómputo por CLIMA ───────────────────
    //
    // Va antes del loop por cuartel a propósito: dentro del loop no hay forma
    // de saber que el cuartel de al lado ya pagó la misma serie. Con un campo
    // seleccionado entero esto es un solo cómputo, sin importar si son 2
    // cuarteles o 35.
    const agroclim = await calcularAgroclim(campos, estaciones, toISO, deadline);
    const agroclimPorCampo = agroclim.porCampo;

    const fields = await Promise.all(campos.map(async campo => {
      const indicesSelect = 'fecha,ndvi,ndre,evi,msavi,tcari,ndmi';
      const estacion = estaciones.get(campo.id) || null;

      const [indices, indicesAnioAnterior, indicesTemporada, indicesTemporadaAnterior,
             climaActual, climaPrevio] = await Promise.all([
        sbSelect('ndvi_history', {
          select: indicesSelect, field_id: `eq.${campo.id}`,
          and: `(fecha.gte.${fromISO},fecha.lte.${toISO})`, order: 'fecha.asc',
        }),
        sbSelect('ndvi_history', {
          select: indicesSelect, field_id: `eq.${campo.id}`,
          and: `(fecha.gte.${fromAntISO},fecha.lte.${toAntISO})`, order: 'fecha.asc',
        }),
        // ── Las mismas lecturas, pero recortadas a la TEMPORADA agronómica ──
        //
        // Pedido de Stanley (2026-08-21): comparar ago-2026→may-2027 contra
        // ago-2025→may-2026. Las dos series de arriba son la ventana móvil del
        // selector y su espejo a −365 días, que sirve para "cómo viene el mes",
        // pero no responde "cómo viene la temporada": con el selector en 365
        // días, la curva punteada arranca en cualquier mes, y con 1100 se
        // solapaba consigo misma y había que apagarla.
        //
        // Dos temporadas nunca se solapan entre sí, así que acá esa restricción
        // no aplica. Van a la misma tabla y a la misma consulta en paralelo: no
        // cuestan una llamada de red extra por cuartel.
        sbSelect('ndvi_history', {
          select: indicesSelect, field_id: `eq.${campo.id}`,
          and: `(fecha.gte.${tempIdx.desde},fecha.lte.${tempIdxHasta})`, order: 'fecha.asc',
        }),
        sbSelect('ndvi_history', {
          select: indicesSelect, field_id: `eq.${campo.id}`,
          and: `(fecha.gte.${tempIdxPrev.desde},fecha.lte.${tempIdxPrev.hasta})`, order: 'fecha.asc',
        }),
        // INIA primero, Open-Meteo solo para los días que INIA no tenga.
        climaSeguro({ campo, estacion, desde: fromISO, hasta: toISO, deadline }),
        climaSeguro({ campo, estacion, desde: fromAntISO, hasta: toAntISO, deadline }),
      ]);

      const daily             = conGddAcumulado(climaActual.dias);
      const dailyAnioAnterior = conGddAcumulado(climaPrevio.dias);

      // Grados-día de la temporada (1-ago a 31-may) y horas frío (1-may a
      // 31-jul). Ya vienen calculados por CLIMA, no por cuartel: los cuarteles
      // que comparten estación —o predio— comparten la serie, así que un campo
      // entero cuesta un solo cómputo (ver `claveAgroclim` y el bloque de
      // grupos más arriba). Acá solo se reparte el resultado.
      const agro = agroclimPorCampo.get(campo.id) || {};
      // El REQUERIMIENTO sí es del cuartel, no del campo: dos cuarteles del
      // mismo predio comparten el clima pero pueden tener cultivos distintos, y
      // la línea de objetivo del gráfico es la de SU cultivo. Por eso se agrega
      // acá y no dentro de `agroclimGdd`.
      //
      // Va a las DOS curvas: `gd10` es la meta del gráfico de grados-día y
      // `hf7` la del de horas frío. Hasta el 2026-09-14 solo se le pegaba a
      // `gdd`, y por eso la línea de objetivo del frío existía en el PDF del
      // informe (que lo pega por su cuenta en `_informe.js`) pero nunca se
      // dibujaba en el dashboard: el dato no llegaba. Un solo `requerimiento()`
      // para los dos, que es una búsqueda en la tabla de INIA por cuartel.
      const req = requerimiento(campo.cultivo, campo.variedad);
      const gdd = agro.gdd ? { ...agro.gdd, requerimiento: req, origen: agro.origen } : null;
      // `chill.estacion` ya está ocupado: es el nombre de la estación INIA del
      // total oficial. La procedencia de la CURVA va en `origen`, aparte.
      const chill = agro.chill ? { ...agro.chill, requerimiento: req, origen: agro.origen } : null;
      const comparacionTemporada = agro.comparacionTemporada || null;

      return {
        field_id: campo.id, nombre: campo.nombre,
        predio_id: campo.predio_id || null, predio_nombre: campo.predio_nombre || null,
        cultivo: campo.cultivo, variedad: campo.variedad || null, area_ha: campo.area_ha,
        indices, indicesAnioAnterior,
        // Curvas por temporada agronómica, para el modo "ago → may" del gráfico
        // de evolución. `desde` viaja porque el eje se dibuja en día corrido de
        // temporada y el cliente necesita el día 0 de cada una.
        indicesTemporada, indicesTemporadaAnterior,
        climate: {
          daily, dailyAnioAnterior, comparacionTemporada,
          // Procedencia del clima, para que la UI pueda decirlo sin adivinar.
          fuente: climaActual.fuente,
          dias_inia: climaActual.dias_inia,
          dias_respaldo: climaActual.dias_respaldo,
          eto_origen: climaActual.eto_origen,
          tramos: climaActual.tramos,
          estacion: climaActual.estacion,
          motivo: climaActual.motivo,
        },
        gdd, chill,
        // El grupo climático de este cuartel quedó fuera del tope: la pantalla
        // dice eso, no "sin datos de temperatura", que culparía al cuartel.
        agroclim_omitido: agro.omitido || false,
      };
    }));

    const alertas_14d = await alertas14dPromesa;

    res.json({
      range: { days, from: fromISO, to: toISO },
      alertas_14d,
      // Fechas de las dos temporadas que acompañan a `indicesTemporada*`, para
      // que el cliente no las vuelva a derivar (y no pueda derivarlas distinto).
      temporada: {
        anio: tempIdx.anio, desde: tempIdx.desde, hasta: tempIdx.hasta, hasta_hoy: tempIdxHasta,
        previa: { anio: tempIdxPrev.anio, desde: tempIdxPrev.desde, hasta: tempIdxPrev.hasta },
      },
      max: MAX_ANALYTICS_FIELDS, omitidos, fields,
      // Cuántos climas DISTINTOS tenía la selección y cuántos se calcularon.
      // La pantalla lo necesita para explicar un gráfico ausente sin inventar
      // el motivo: `grupos > calculados` es "sobran campos", no "falta dato".
      agroclim: { grupos: agroclim.grupos, calculados: agroclim.calculados, tope: MAX_GRUPOS_AGROCLIM },
    });
  } catch (err) {
    console.error('fields analytics error:', err);
    res.status(500).json({ error: 'Error al obtener la analítica.' });
  }
}

async function handlePost(req, res, userId, ctx) {
  const {
    nombre,
    polygon_coords,
    area_ha,
    cultivo,
    variedad,
    anio_plantacion,
    sistema_riego,
    region,
    comuna,
    predio_id,
    predio_nombre,
    es_cuartel,
    preferencias,
  } = req.body || {};

  if (!nombre || !polygon_coords || !cultivo) {
    return res.status(400).json({ error: 'Faltan campos requeridos: nombre, polygon_coords, cultivo' });
  }

  try {
    // Si el predio_id ya existe, reusar el predio_nombre guardado (evita drift
    // si dos cuarteles del mismo predio mandan nombres distintos por error del cliente).
    let predioNombreFinal = predio_nombre || null;
    if (predio_id) {
      // `user_id` no es decorativo: sin él, mandar el predio_id de otro usuario
      // devolvía —y copiaba a este cuartel— el nombre de SU predio.
      const hermanos = await sbSelect('user_fields', {
        select: 'predio_nombre', predio_id: `eq.${predio_id}`, user_id: `eq.${userId}`, limit: 1,
      });
      if (hermanos.length && hermanos[0].predio_nombre) predioNombreFinal = hermanos[0].predio_nombre;
    }

    // Ubicación: la fuente de verdad es el polígono. El registro ya la derivó al
    // dibujar (vía /api/geocode) y la manda, así que acá no volvemos a llamar a
    // Nominatim; si el usuario corrigió la región a mano, gana la suya. Otros
    // clientes (app.html) no mandan ninguna de las dos → se derivan acá.
    let comunaFinal = comuna || null;
    let regionFinal = region || null;
    if (!comunaFinal || !regionFinal) {
      const geo = await reverseGeocode(polygon_coords);
      comunaFinal = comunaFinal || geo.comuna;
      regionFinal = regionFinal || geo.region;
    }

    const rows = await sbInsert('user_fields', {
      user_id: userId,
      nombre,
      polygon_coords,
      area_ha: area_ha || null,
      cultivo,
      variedad: variedad || null,
      anio_plantacion: anio_plantacion ? parseInt(anio_plantacion) : null,
      sistema_riego: sistema_riego || null,
      region: regionFinal,
      comuna: comunaFinal,
      predio_id: predio_id || null,
      predio_nombre: predioNombreFinal,
      es_cuartel: !!es_cuartel,
      preferencias: preferencias || null,
    });

    // Backfill satelital histórico (2024→hoy) del campo recién creado, fire-and-
    // forget: la Vercel Function invocada sigue corriendo aunque abortemos el
    // fetch a los 1.5s. Si se pierde (deploy en frío, env var ausente), el sweep
    // diario de cron/backfill-field lo completa igual.
    const base = process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null;
    if (base && process.env.CRON_SECRET && rows[0]?.id) {
      await fetch(`${base}/api/cron/backfill-field?field_id=${rows[0].id}`, {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
        signal: AbortSignal.timeout(1500),
      }).catch(() => {});
    }

    await auditarSiAdmin(ctx, 'campo_crear', {
      field_id: rows[0]?.id, nombre, predio_nombre: predioNombreFinal, cultivo, area_ha: area_ha || null,
    });
    res.json({ ok: true, field: rows[0] });
  } catch (err) {
    console.error('fields POST error:', err);
    res.status(500).json({ error: 'Error al guardar el campo.' });
  }
}

async function handlePatch(req, res, userId, ctx) {
  const url = new URL(req.url, 'http://x');
  const id = url.searchParams.get('id');
  if (!id) return res.status(400).json({ error: 'Falta id' });

  const { preferencias, polygon_coords, area_ha,
          nombre, cultivo, variedad, anio_plantacion, sistema_riego,
          predio_id, predio_nombre, es_cuartel } = req.body || {};
  const updates = {};
  if (preferencias !== undefined) updates.preferencias = preferencias;

  // Agrupar en un campo/predio desde /app (2026-08-21). Antes solo el wizard de
  // registro mandaba estos tres campos, así que todo cuartel creado desde la app
  // quedaba suelto — y las tres listas, que ya saben agrupar por `predio_nombre`,
  // no tenían con qué. Mandar `null` explícito desagrupa.
  if (predio_id !== undefined)  updates.predio_id  = predio_id || null;
  if (es_cuartel !== undefined) updates.es_cuartel = !!es_cuartel;
  if (predio_nombre !== undefined) {
    let nombreFinal = predio_nombre ? String(predio_nombre).trim() : null;
    // Misma guarda anti-drift que el POST: si el predio ya existe, gana el
    // nombre guardado (dos cuarteles del mismo predio no pueden discrepar).
    if (nombreFinal && predio_id) {
      // Acotado al propio usuario, igual que en el POST.
      const hermanos = await sbSelect('user_fields', {
        select: 'predio_nombre', predio_id: `eq.${predio_id}`, user_id: `eq.${userId}`, limit: 1,
      });
      if (hermanos.length && hermanos[0].predio_nombre) nombreFinal = hermanos[0].predio_nombre;
    }
    updates.predio_nombre = nombreFinal;
  }

  // Datos del cuartel (editables desde la pestaña "Campos" de /app).
  // nombre y cultivo son obligatorios en el POST: no permitir vaciarlos por PATCH.
  if (nombre !== undefined) {
    if (!String(nombre).trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacío.' });
    updates.nombre = String(nombre).trim();
  }
  if (cultivo !== undefined) {
    if (!String(cultivo).trim()) return res.status(400).json({ error: 'El cultivo no puede quedar vacío.' });
    updates.cultivo = String(cultivo).trim();
  }
  // Los opcionales sí se pueden vaciar → null (borrar una variedad mal puesta).
  if (variedad !== undefined)        updates.variedad        = String(variedad).trim() || null;
  if (sistema_riego !== undefined)   updates.sistema_riego   = String(sistema_riego).trim() || null;
  if (anio_plantacion !== undefined) updates.anio_plantacion = anio_plantacion ? parseInt(anio_plantacion) : null;

  if (polygon_coords !== undefined) {
    // Si el polígono se movió, la ubicación vieja ya no aplica: recalcular ambas
    // (antes solo se recalculaba comuna y la región quedaba desincronizada).
    updates.polygon_coords = polygon_coords;
    const geo = await reverseGeocode(polygon_coords);
    updates.comuna = geo.comuna;
    if (geo.region) updates.region = geo.region; // no pisar con null si Nominatim falla
  }
  if (area_ha !== undefined) updates.area_ha = area_ha;
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nada que actualizar.' });

  try {
    // Solo el admin paga el SELECT del "antes": es lo que permite deshacer a mano
    // una edición hecha desde el panel (el polígono anterior queda completo).
    let antes = null;
    if (ctx?.motivo === 'admin') {
      const previas = await sbSelect('user_fields', {
        select: Object.keys(updates).join(','), id: `eq.${id}`, user_id: `eq.${userId}`, limit: 1,
      });
      antes = previas[0] || null;
    }
    // user_id como guardia de propiedad (se usa service key, sin RLS real en este camino).
    const rows = await sbUpdate('user_fields', { id: `eq.${id}`, user_id: `eq.${userId}` }, updates);
    if (!rows.length) return res.status(404).json({ error: 'Campo no encontrado.' });
    if (antes) {
      const cambios = {};
      for (const k of Object.keys(updates)) {
        if (JSON.stringify(antes[k] ?? null) === JSON.stringify(rows[0][k] ?? null)) continue;
        cambios[k] = k === 'polygon_coords'
          ? { antes: antes[k], despues: { n_puntos: Array.isArray(rows[0][k]) ? rows[0][k].length : null } }
          : { antes: antes[k] ?? null, despues: rows[0][k] ?? null };
      }
      if (Object.keys(cambios).length) await auditarSiAdmin(ctx, 'campo_editar', { field_id: id, nombre: rows[0].nombre, cambios });
    }
    res.json({ ok: true, field: rows[0] });
  } catch (err) {
    console.error('fields PATCH error:', err);
    res.status(500).json({ error: 'Error al actualizar el campo.' });
  }
}

// Borrado FÍSICO. `ndvi_history` y `alerts` tienen ON DELETE CASCADE hacia
// `user_fields` (ver db/schema.sql y migration_v3), así que el historial NDVI y las
// alertas del cuartel se van con él — que es lo correcto: no queremos alertas
// huérfanas de un campo que ya no existe. Se descartó el borrado lógico
// (columna `activo`) porque obligaría a filtrar en cada consumidor (chat,
// whatsapp-webhook, check-alerts, GEE) y basta olvidar uno para que un cuartel
// "borrado" siga generando alertas.
//
// Si el cuartel pertenecía a un predio con varios, los que quedan NO se tocan:
// conservan su predio_id/predio_nombre/es_cuartel aunque quede uno solo (un grupo
// de uno se renderiza bien en app.html; auto-"promoverlo" sería magia sorpresiva).
async function handleDelete(req, res, userId, ctx) {
  const url = new URL(req.url, 'http://x');
  const id = url.searchParams.get('id');
  if (!id) return res.status(400).json({ error: 'Falta id' });

  try {
    // user_id como guardia de propiedad (se usa service key, sin RLS real en este camino).
    const rows = await sbDelete('user_fields', { id: `eq.${id}`, user_id: `eq.${userId}` });
    if (!rows.length) return res.status(404).json({ error: 'Campo no encontrado.' });
    // La fila entera, polígono incluido: con eso se puede recrear el cuartel.
    await auditarSiAdmin(ctx, 'campo_borrar', { field_id: rows[0].id, nombre: rows[0].nombre, fila: rows[0] });
    res.json({ ok: true, deleted: rows[0].id });
  } catch (err) {
    console.error('fields DELETE error:', err);
    res.status(500).json({ error: 'Error al eliminar el campo.' });
  }
}

// Renombrar un campo (predio) entero: `PATCH /api/fields?predio_id=` con
// `{ predio_nombre }`. Por cuartel no se puede —la guarda anti-drift de
// `handlePatch` impone el nombre guardado del hermano—, así que va en un solo
// UPDATE sobre todos los cuarteles de ese predio, acotado al usuario.
async function handleRenombrarPredio(req, res, userId, ctx) {
  const url = new URL(req.url, 'http://x');
  const predioId = url.searchParams.get('predio_id');
  const nuevo = String((req.body || {}).predio_nombre || '').trim();
  if (!nuevo) return res.status(400).json({ error: 'El nombre del campo no puede quedar vacío.' });

  try {
    const propios = await sbSelect('user_fields', { select: 'predio_id,predio_nombre', user_id: `eq.${userId}` });
    const delPredio = propios.filter(f => f.predio_id === predioId);
    if (!delPredio.length) return res.status(404).json({ error: 'Campo no encontrado.' });
    // Dos campos con el mismo nombre se confunden en las listas, el informe y el bot.
    const choca = propios.some(f => f.predio_id && f.predio_id !== predioId
      && String(f.predio_nombre || '').trim().toLowerCase() === nuevo.toLowerCase());
    if (choca) return res.status(409).json({ error: `Ya tienes otro campo llamado "${nuevo}".` });

    const rows = await sbUpdate('user_fields', { predio_id: `eq.${predioId}`, user_id: `eq.${userId}` }, { predio_nombre: nuevo });
    await auditarSiAdmin(ctx, 'predio_renombrar', {
      predio_id: predioId, antes: delPredio[0].predio_nombre || null, despues: nuevo, cuarteles: rows.length,
    });
    res.json({ ok: true, predio_id: predioId, predio_nombre: nuevo, cuarteles: rows.length });
  } catch (err) {
    console.error('fields PATCH predio error:', err);
    res.status(500).json({ error: 'Error al renombrar el campo.' });
  }
}

module.exports.config = { maxDuration: 20 };

// Expuestas para el informe semanal (`_informe.js`) y para el arnés. Es el
// mismo patrón que `detalleAgronomico`/`unidadDeInforme` en el cron: el informe
// necesita los MISMOS grados-día y horas frío que muestra el dashboard, y
// recalcularlos por su cuenta sería una cuarta fuente para el mismo número —
// exactamente lo que este repo ya pagó dos veces con los rangos de temporada
// escritos a mano en un segundo lugar.
module.exports.calcularAgroclim = calcularAgroclim;

// Grados-día y horas frío de UN cuartel, exactamente como los dibuja el
// dashboard: misma resolución de estación, mismo corte (ayer en Chile). Es la
// puerta para el bot y el boletín del cron, que hasta el 2026-09-24 calculaban
// los suyos con Open-Meteo y otro criterio de desfase.
async function agroclimDeCampo(campo, { presupuestoMs = 20000 } = {}) {
  if (!campo || !Array.isArray(campo.polygon_coords) || campo.polygon_coords.length < 3) return null;
  const toISO = sumarDias(hoyEnChile(), -1);
  const deadline = Date.now() + presupuestoMs;
  const estaciones = await resolverEstaciones([campo], `${temporadaGdd(toISO).anio - 1}-08-01`, deadline);
  const { porCampo } = await calcularAgroclim([campo], estaciones, toISO, deadline);
  const e = porCampo.get(campo.id);
  return e && !e.omitido ? e : null;
}
module.exports.agroclimDeCampo = agroclimDeCampo;
module.exports.resolverEstaciones = resolverEstaciones;
module.exports.MAX_GRUPOS_AGROCLIM = MAX_GRUPOS_AGROCLIM;

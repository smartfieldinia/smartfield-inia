// ════════════════════════════════════════════════════════════════════════
// api/_clima-cuartel.js — la serie diaria de clima de un cuartel, SIEMPRE
// desde la API de Riesgo Climático del INIA, con Open-Meteo solo de relleno.
//
// Regla del producto (pedido del usuario, 2026-08-14): *el dato oficial es el
// del INIA —viene de estaciones meteorológicas reales, más precisas— y
// Open-Meteo solo se ocupa cuando INIA no lo tiene.*
//
// Antes esa regla se cumplía a medias. Las tarjetas de arriba del dashboard
// (balance hídrico, perfil de riesgo) sí consultaban INIA con respaldo ERA5,
// pero TODA la grilla de gráficos —temperatura máxima y mínima, precipitación,
// grados-día, horas frío—, el KPI de lluvia y el texto de adelanto de temporada
// salían de `api/fields.js`, que jamás tocaba INIA: pegaba directo al archivo de
// Open-Meteo. El resultado era que el mismo dashboard mostraba grados-día,
// precipitación, mínimas y horas frío DOS VECES con fuentes distintas, y en
// horas frío hasta con umbrales distintos.
//
// Este módulo es el único lugar donde se decide de dónde sale un dato de clima.
//
// ── Por qué el merge es POR VARIABLE y no por fila ──────────────────────
//
// Porque la ETo (evapotranspiración) es la variable con peor cobertura de la red
// INIA: solo 309 de 424 estaciones la publican, y Ñuble —donde está el cuartel
// de referencia del piloto— está al 48 %. Con un criterio todo-o-nada, un
// cuartel cuya estación no publica ETo tendría que renunciar TAMBIÉN a las
// temperaturas y la lluvia medidas, que sí están. Se rellena la variable que
// falta, no el día entero.
//
// ── Por qué el relleno del tramo reciente es estructural ────────────────
//
// La API entrega hasta `last_date − 1` y los gráficos piden hasta ayer, así que
// aun con la red del INIA sana y al día siempre faltan ~2 días al final de la
// serie. El relleno no es una concesión a la caída actual del host: es el modo
// normal de operación.
// ════════════════════════════════════════════════════════════════════════

const { centroidOf } = require('./_geocoding');
const {
  getSeries, estacionesCercanas, elegirEstacion,
  BoletinError,
} = require('./_boletin');
const { sumarDias } = require('./_riesgo');
const { serieDiaria, ultimoDiaCerradoRespaldo, hoyEnChile } = require('./_respaldo-clima');

// Fallas por las que vale la pena degradar a Open-Meteo. Un 4xx de cliente
// (`invalid_key`) NO está: eso es config rota y taparlo con el respaldo lo
// escondería para siempre.
const FALLAS_DE_INFRAESTRUCTURA = [
  'rate_limited', 'circuito_abierto', 'unreachable', 'presupuesto_agotado',
  'no_last_date', 'no_data', 'missing_key',
  // Ver `verificarAtraso`: un snapshot congelado responde 200 pero no sirve.
  'datos_atrasados',
  // Estas dos SÍ son 4xx, y aun así se degradan: describen un desajuste entre
  // el cuartel y el catálogo de estaciones (una `estacion_id` fijada a mano que
  // INIA dio de baja, o un rango anterior al `first_date` de la estación), no
  // un error de programación. Para el agricultor la respuesta correcta es el
  // respaldo rotulado, no una tarjeta rota. Queda registrado en `motivo`.
  'invalid_station', 'station_not_found', 'invalid_range',
];

// Tres días de margen: el perfil responde "qué pasó recién", y con más atraso
// que eso el título miente. Por debajo se prefiere igual al INIA, que es la
// fuente buena (estación real, y la única que define ola de calor y horas frío).
const ATRASO_MAX_DIAS = 3;

// Máximo de días por llamada a /series. El contrato no documenta un tope y
// ningún call-site pedía más de ~120 días, así que 366 es una apuesta
// conservadora: si al reconectar con INIA resulta que aguanta más, se sube y se
// ahorran llamadas; si aguanta menos, el troceo ya está y solo cambia el número.
const MAX_DIAS_POR_LLAMADA = 366;

function diasEntre(desdeISO, hastaISO) {
  return Math.round((Date.parse(`${hastaISO}T12:00:00Z`) - Date.parse(`${desdeISO}T12:00:00Z`)) / 86400000);
}

// Un snapshot congelado responde igual que la API viva: lo único que lo delata
// es la fecha. Lanza una falla degradable para que quien llame caiga al respaldo.
function verificarAtraso(ultimoDia) {
  const atraso = diasEntre(ultimoDia, ultimoDiaCerradoRespaldo());
  if (atraso > ATRASO_MAX_DIAS) {
    throw new BoletinError(
      `El último dato de la red INIA es del ${ultimoDia} (${atraso} días de atraso)`,
      { code: 'datos_atrasados' });
  }
}

const esFallaDegradable = err =>
  err instanceof BoletinError && FALLAS_DE_INFRAESTRUCTURA.includes(err.code);

// ── Estación del cuartel ────────────────────────────────────────────────
//
// SIEMPRE la sugerida por proximidad al centroide del cuartel (FR-ST-01),
// prefiriendo entre las cercanas a las que publican ETo y tienen historial para
// comparar contra el año anterior. `historialDesde` es la fecha que la estación
// debe cubrir para que esa comparación sea posible.
//
// **Ya no se puede fijar a mano** (pedido del usuario, 2026-09-13): se quitaron
// el botón "Cambiar estación" de la tarjeta de balance hídrico y el PATCH de
// `/api/climate` que lo respaldaba. La columna `user_fields.estacion_id` queda
// en la base pero este código NO la lee: una sola regla para la pantalla, el
// informe y las alertas, y nadie queda pegado a una estación que eligió una vez.
// Si alguna vez se repone la elección manual, la rama iba justo acá y la columna
// todavía tiene el dato de quien la usó.
//
// Vive acá y no en `climate.js` porque ahora la usan dos endpoints. Se MOVIÓ,
// no se copió: `climate.js` la importa.
async function resolverEstacion(campo, { historialDesde = null, deadline = null } = {}) {
  const centroide = centroidOf(campo.polygon_coords);
  if (!centroide) return { estacion: null, centroide: null, origen: null, cercanas: [] };

  const cercanas = await estacionesCercanas(centroide, { historialDesde, deadline });

  const sugerida = elegirEstacion(cercanas);
  return { estacion: sugerida, centroide, origen: sugerida ? 'proximidad' : null, cercanas };
}

// ════════════════════════════════════════════════════════════════════════
// NÚCLEO PURO — sin red. Es donde vive toda la lógica interesante, así que es
// lo que se puede verificar con fixtures sin depender del host de INIA.
// ════════════════════════════════════════════════════════════════════════

// Parte [desde, hasta] en tramos de a lo sumo `maxDias` días.
function troceaRango(desde, hasta, maxDias = MAX_DIAS_POR_LLAMADA) {
  if (desde > hasta) return [];
  const tramos = [];
  let cursor = desde;
  while (cursor <= hasta) {
    const fin = sumarDias(cursor, maxDias - 1);
    tramos.push({ desde: cursor, hasta: fin < hasta ? fin : hasta });
    cursor = sumarDias(fin, 1);
  }
  return tramos;
}

const VARIABLES = ['tmax', 'tmin', 'tmean', 'precip', 'eto'];

// ¿Esta fila aporta algo? Una fila presente con TODO en null es lo mismo que una
// fila ausente. Hace falta tratarlas igual porque no sabemos cuál de las dos
// formas usa INIA para un día sin dato — el contrato no lo dice.
const filaVacia = f => !f || VARIABLES.every(v => f[v] == null);

// Variables que hay que pedirle al respaldo si INIA no las trae. `tmean` no
// entra porque nunca se rellena (regla 4 de `fusionarSeries`), y `eto` tampoco:
// hay estaciones que publican todo menos ETo, y meterla acá dispararía un fetch
// de relleno para series que ya están completas en lo que importa.
const NUCLEO = ['tmax', 'tmin', 'precip'];

// Un día con lluvia pero SIN temperaturas es un hueco, aunque la fila exista.
// `filaVacia` no alcanzaba: el merge de más abajo es variable por variable, así
// que un día parcial dejaba la temperatura sin rellenar para siempre — y el
// gráfico de tmax/tmin quedaba en blanco mientras el de precipitación se veía
// bien. Este criterio solo gobierna QUÉ se le pide a Open-Meteo.
const filaIncompleta = f => !f || NUCLEO.some(v => f[v] == null);

// Rango ÚNICO que cubre desde el primer hasta el último día sin dato. Un solo
// fetch a Open-Meteo aunque los huecos sean varios: no cobra por día, y evita N
// round-trips que es justamente lo caro (0,75 s de handshake cada uno).
// Por eso ampliar el criterio a `filaIncompleta` no agrega llamadas: solo
// ensancha el rango del fetch que ya se hacía.
function rangoFaltante(porFecha, desde, hasta) {
  let primero = null, ultimo = null;
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
    if (filaIncompleta(porFecha.get(f))) { if (!primero) primero = f; ultimo = f; }
  }
  return primero ? { desde: primero, hasta: ultimo } : null;
}

// Fusiona la serie de INIA con la de relleno, VARIABLE POR VARIABLE.
//
// Reglas, en orden de importancia:
//   1. INIA gana siempre que su valor sea no-nulo. Open-Meteo NUNCA pisa un dato
//      de INIA — es la regla del producto, y es la razón de ser del módulo.
//   2. `frost` en un día rellenado se RECALCULA como `tmin <= 0`: es literalmente
//      la definición que declara INIA, no una invención nuestra.
//   3. `heat_wave` en un día rellenado queda `null`, NUNCA 0. Depende del
//      percentil 90 climatológico de la estación, que el reanálisis no tiene;
//      un 0 diría "no hubo ola de calor" cuando lo cierto es "no se pudo evaluar".
//   4. `tmean` queda `null` si no vino de INIA: el suyo es promedio de lecturas
//      horarias, no `(tmax+tmin)/2`, y mezclarlos daría una serie incomparable.
function fusionarSeries({ inia = [], respaldo = [], desde, hasta }) {
  const deInia = new Map();
  inia.forEach(f => { if (f?.date && !filaVacia(f)) deInia.set(f.date, f); });
  const deRespaldo = new Map();
  respaldo.forEach(f => { if (f?.date) deRespaldo.set(f.date, f); });

  const dias = [];
  let diasInia = 0, diasRespaldo = 0;
  let etoInia = 0, etoRespaldo = 0;

  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
    const a = deInia.get(f);
    const b = deRespaldo.get(f);
    if (!a && !b) continue;                     // ese día no lo tiene nadie

    const fila = { date: f };
    let deA = 0, deB = 0;
    for (const v of VARIABLES) {
      if (a && a[v] != null)      { fila[v] = a[v]; if (v !== 'eto') deA++; else etoInia++; }
      else if (b && b[v] != null && v !== 'tmean') { fila[v] = b[v]; if (v !== 'eto') deB++; else etoRespaldo++; }
      else fila[v] = null;
    }

    fila.frost = (a && a.frost != null) ? a.frost
               : (fila.tmin == null ? null : (fila.tmin <= 0 ? 1 : 0));
    fila.heat_wave = (a && a.heat_wave != null) ? a.heat_wave : null;

    fila.origen = deB === 0 ? 'inia' : (deA === 0 ? 'open-meteo' : 'mixto');
    if (fila.origen === 'inia') diasInia++; else diasRespaldo++;
    dias.push(fila);
  }

  const etoOrigen = (etoInia && etoRespaldo) ? 'mixto'
    : etoInia ? 'inia' : (etoRespaldo ? 'open-meteo' : 'sin_dato');

  return { dias, dias_inia: diasInia, dias_respaldo: diasRespaldo, eto_origen: etoOrigen };
}

// Tramos contiguos del mismo origen, para poder decir "del 07/08 al 13/08 es
// relleno" en vez de un contador suelto.
function tramosDe(dias) {
  const tramos = [];
  for (const d of dias) {
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && ultimo.fuente === d.origen) { ultimo.hasta = d.date; ultimo.dias++; }
    else tramos.push({ desde: d.date, hasta: d.date, fuente: d.origen, dias: 1 });
  }
  return tramos;
}

// Del shape canónico de INIA (`date`, `eto`) al que usa la analítica del
// dashboard (`fecha`, `et0`). La traducción vive en el borde: hacia adentro
// todo habla el idioma de INIA, así que `_riesgo.js` consume estas filas sin
// adaptador.
function aFilaAnalitica(d, gddAcumulado) {
  return {
    fecha: d.date,
    tmax: d.tmax, tmin: d.tmin,
    precip: d.precip, et0: d.eto,
    gdd: d.gdd ?? null,
    gddAcumulado,
    origen: d.origen,
  };
}

// ════════════════════════════════════════════════════════════════════════
// ORQUESTADOR
// ════════════════════════════════════════════════════════════════════════

// La serie diaria de un cuartel entre dos fechas.
//
// NUNCA lanza por falla de infraestructura: siempre devuelve una serie, y lo que
// cambia es el rótulo. Ese contrato es lo que permite que `handleAnalytics` no
// tenga que envolver cada cuartel en su propio try/catch.
async function serieCuartel({ campo, estacion, desde, hasta, deadline = null, signal = null }) {
  const centroide = centroidOf(campo.polygon_coords);
  const base = {
    dias: [], fuente: 'sin_dato', dias_inia: 0, dias_respaldo: 0,
    eto_origen: 'sin_dato', tramos: [], estacion: null, motivo: null,
  };
  if (!centroide || desde > hasta) return base;

  const infoEstacion = estacion ? {
    id: estacion.id, nombre: estacion.name,
    institucion: estacion.institution || null,
    distancia_km: estacion.distancia_km ?? null,
  } : null;

  // 1. INIA primero, hasta donde llegue su último día cerrado.
  let deInia = [];
  let motivo = null;
  if (estacion) {
    try {
      const tramos = troceaRango(desde, hasta);
      const partes = await Promise.all(
        tramos.map(t => getSeries(estacion.id, t.desde, t.hasta, { deadline })));
      deInia = partes.flatMap(p => (Array.isArray(p.data) ? p.data : []));
    } catch (err) {
      if (!esFallaDegradable(err)) throw err;
      motivo = err.code;
      deInia = [];
    }
  } else {
    motivo = 'sin_estacion';
  }

  // 2. Solo los días que INIA no cubrió.
  const porFecha = new Map();
  deInia.forEach(f => { if (f?.date) porFecha.set(f.date, f); });
  const falta = rangoFaltante(porFecha, desde, hasta);

  let deRespaldo = [];
  if (falta) {
    deRespaldo = await serieDiaria({
      lat: centroide.lat, lon: centroide.lon, desde: falta.desde, hasta: falta.hasta, signal,
    }).catch(err => {
      console.warn(`[clima-cuartel] sin relleno Open-Meteo (${falta.desde}→${falta.hasta}): ${err.message}`);
      return [];
    });
  }

  const fusion = fusionarSeries({ inia: deInia, respaldo: deRespaldo, desde, hasta });
  const fuente = fusion.dias_inia && fusion.dias_respaldo ? 'mixto'
    : fusion.dias_inia ? 'inia'
    : (fusion.dias_respaldo ? 'open-meteo' : 'sin_dato');

  return {
    ...fusion,
    fuente,
    tramos: tramosDe(fusion.dias),
    estacion: infoEstacion,
    motivo,
  };
}

// Lluvia de los 7 días cerrados anteriores a hoy (Chile), de la misma serie
// que el dashboard. La usan la alerta de sequía del cron, el boletín y el bot
// (`revisar_cuartel`), que antes la sacaban de Open-Meteo: 50,2 mm contra los
// 37,0 que midió la estación de Santa Rosa la misma semana (2026-09-24).
// → { mm, fuente } ('inia' | 'mixto' | 'open-meteo'), o null si no hay ni un
// día con dato: "sin dato" no es "0 mm", y un 0 dispararía la alerta de sequía.
async function lluvia7dDelCampo(campo) {
  const hasta = sumarDias(hoyEnChile(), -1);
  const desde = sumarDias(hasta, -6);
  const { estacion } = await resolverEstacion(campo, { historialDesde: desde });
  const s = await serieCuartel({ campo, estacion, desde, hasta });
  const conDato = (s.dias || []).filter(d => typeof d.precip === 'number');
  if (!conDato.length) return null;
  return { mm: Math.round(conDato.reduce((t, d) => t + d.precip, 0) * 10) / 10, fuente: s.fuente };
}

// Déficit hídrico de los 7 días cerrados (ETo − lluvia, mínimo 0) contra las
// MISMAS fechas del año pasado, de la serie del dashboard. Es lo que Stanley
// pidió decir en vez de "falta de agua, revisa el riego" (2026-09-24): "no
// sabemos si está regando o no; solo indicar la diferencia y que se requiere
// más que el año pasado en la misma fecha".
// → { deficit_mm, previo_mm, diferencia_mm, diferencia_pct, eto_mm, lluvia_mm,
//     desde, hasta, fuente } o null si alguno de los dos años no tiene los 7
// días con lluvia y ETo: con días faltantes el déficit sale subestimado y la
// comparación no se sostiene.
async function demandaHidrica7dDelCampo(campo) {
  const hasta = sumarDias(hoyEnChile(), -1);
  const desde = sumarDias(hasta, -6);
  const desdePrev = sumarDias(desde, -365), hastaPrev = sumarDias(hasta, -365);
  const { estacion } = await resolverEstacion(campo, { historialDesde: desdePrev });
  const [act, prev] = await Promise.all([
    serieCuartel({ campo, estacion, desde, hasta }),
    serieCuartel({ campo, estacion, desde: desdePrev, hasta: hastaPrev }),
  ]);
  const completos = dias => (dias || []).filter(d => typeof d.precip === 'number' && typeof d.eto === 'number');
  const a = completos(act.dias), p = completos(prev.dias);
  if (a.length < 7 || p.length < 7) return null;
  const sumar = (arr, k) => arr.reduce((t, d) => t + d[k], 0);
  const r1 = x => Math.round(x * 10) / 10;
  const lluvia = sumar(a, 'precip'), eto = sumar(a, 'eto');
  const deficit = Math.max(eto - lluvia, 0);
  const previo = Math.max(sumar(p, 'eto') - sumar(p, 'precip'), 0);
  return {
    deficit_mm: r1(deficit), previo_mm: r1(previo), diferencia_mm: r1(deficit - previo),
    // Con el año pasado casi sin déficit el % es inestable: se omite.
    diferencia_pct: previo >= 1 ? r1(((deficit - previo) / previo) * 100) : null,
    eto_mm: r1(eto), lluvia_mm: r1(lluvia), desde, hasta, fuente: act.fuente,
  };
}

// ¿Hay que decir "se requiere más agua que el año pasado"? Déficit ≥ 25 %
// sobre el del año pasado (el corte "alto" de `hidrico.yoy_alto_pct` en
// _riesgo.js) o, si el año pasado no hubo déficit, 5 mm o más de diferencia.
// Lo usan el aviso del cron y el bot: una sola regla.
const UMBRAL_DEMANDA_PCT = 25;
const UMBRAL_DEMANDA_SIN_BASE_MM = 5;
function superaDemanda(dh) {
  if (!dh || !(dh.diferencia_mm > 0)) return false;
  return dh.diferencia_pct != null
    ? dh.diferencia_pct >= UMBRAL_DEMANDA_PCT
    : dh.diferencia_mm >= UMBRAL_DEMANDA_SIN_BASE_MM;
}

module.exports = {
  resolverEstacion, serieCuartel, lluvia7dDelCampo, demandaHidrica7dDelCampo,
  superaDemanda, UMBRAL_DEMANDA_PCT, UMBRAL_DEMANDA_SIN_BASE_MM,
  // Núcleo puro (verificable sin red)
  fusionarSeries, troceaRango, rangoFaltante, tramosDe, aFilaAnalitica, filaVacia,
  // Compartido con climate.js
  verificarAtraso, esFallaDegradable, diasEntre,
  FALLAS_DE_INFRAESTRUCTURA, ATRASO_MAX_DIAS, MAX_DIAS_POR_LLAMADA,
};

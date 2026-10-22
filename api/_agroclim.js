// ════════════════════════════════════════════════════════════════════════
// Helper agroclimático — comparación de temporada (grados-día vs. año
// anterior) y horas frío acumuladas. Reutiliza el mismo patrón que
// `climaCoords` en _agent.js (Open-Meteo archive API, sin dependencias).
// ════════════════════════════════════════════════════════════════════════

// El criterio de "adelanto/atraso de temporada" vive en _riesgo.js y se importa:
// es el mismo que usa el perfil de riesgo de la web. Tenerlo duplicado hacía que
// el bot dijera "atrasada 15 días" por WhatsApp mientras la web decía otra cosa
// sobre el mismo cuartel y el mismo día (verificado 2026-08-14).
const { desfaseEnDias, TEXTO_SIN_DESFASE, GDD_BASE, sumarDias } = require('./_riesgo.js');
const { hoyEnChile } = require('./_respaldo-clima.js');
const { getSeries, estacionesCercanas, elegirEstacion } = require('./_boletin');

const CHILL_THRESHOLD = 7.2; // °C, modelo Horas Frío tipo Weinberger (horas ≤ este umbral)

function isoDate(d) { return d.toISOString().split('T')[0]; }

// La temporada y el "hasta" se deciden con la fecha de CHILE, no la UTC: entre
// las 20:00 y las 24:00 locales el UTC ya está en el día siguiente y "ayer"
// pasaba a ser hoy. Ver el comentario largo en _respaldo-clima.js.
function ayerEnChile() { return sumarDias(hoyEnChile(), -1); }

// Suma de grados-día (base GDD_BASE) entre start/end (inclusive), vía archive API.
async function gradosDiaAcumulados({ lat, lon, start, end }) {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}`
    + `&start_date=${start}&end_date=${end}`
    + `&daily=temperature_2m_max,temperature_2m_min&timezone=America%2FSantiago`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const d = (await res.json()).daily;
  if (!d || !d.time) return { gdd: null, dias: 0 };
  let gdd = 0, dias = 0;
  for (let i = 0; i < d.time.length; i++) {
    const tmax = d.temperature_2m_max[i], tmin = d.temperature_2m_min[i];
    if (tmax == null || tmin == null) continue;
    dias++;
    gdd += Math.max(0, (tmax + tmin) / 2 - GDD_BASE);
  }
  return { gdd: Math.round(gdd * 10) / 10, dias };
}

// ── Temporada de grados-día: 1 de agosto al 31 de mayo ──────────────────
//
// ESTA es la fuente única de la temporada: `fields.js` la importa de acá. Antes
// había una copia idéntica allá y las dos había que cambiarlas a mano.
//
// El rango salió de la planilla que Stanley exportó de agrometeorologia.cl el
// 13-08-2026: la Red Agrometeorológica de INIA acumula GD10 de agosto a mayo del
// año siguiente (Ago-2025 28,5 °D … May-2026 1.530 °D, y reinicia en Ago-2026
// con 2,8 °D). Su nota al margen es explícita: "si ves los gráficos de GDD
// parten en Ago a mayo próx año, por lo que al comparar se debe poner por
// ejemplo de ago24 a my25 con ago25 a my26". Hasta 2026-08-21 esto acumulaba de
// julio a abril, así que el número de la pantalla no cuadraba con el de la
// planilla que el productor tiene al lado.
//
// Antes de eso comparaba los últimos 30 días y el mensaje al productor igual
// decía "esta temporada": el bot y la web hablaban de cosas distintas con las
// mismas palabras. Junio y julio quedan fuera de temporada: se muestra la última
// cerrada, que es la que arrancó el año anterior.
//
// `refISO` es la fecha de Chile (YYYY-MM-DD), no un Date en UTC: el 31 de julio
// a las 21:00 locales el UTC ya marca 1 de agosto y la temporada cambiaba un día
// antes de tiempo, pidiendo un rango invertido (start > end).
function temporadaGdd(refISO = hoyEnChile()) {
  const [anio, mes] = refISO.split('-').map(Number);
  const base = mes >= 8 ? anio : anio - 1;
  return { anio: base, desde: `${base}-08-01`, hasta: `${base + 1}-05-31` };
}

// Compara los grados-día acumulados de la TEMPORADA en curso contra los que
// llevaba la temporada anterior A LA MISMA FECHA, y expresa la diferencia en
// "días equivalentes" (aproximación: diferencia de GDD / promedio diario del
// período actual — no es fenología real por cultivo, solo una referencia
// rápida de adelanto/atraso para el mensaje al productor).
// compararGradosDia({lat,lon}) → { gdd_actual, gdd_anio_anterior, diferencia_gdd,
//   dias_diferencia, texto } (texto=null si no hay dato suficiente)
async function compararGradosDia({ lat, lon }) {
  try {
    const end   = ayerEnChile();
    const temp  = temporadaGdd();
    const start = temp.desde;
    // Mismo tramo de la temporada anterior: del 1 de agosto del año previo hasta
    // la misma fecha calendario. Comparar contra su total cerrado haría ver
    // atrasada a cualquier temporada en curso.
    const endAnterior   = sumarDias(end, -365);
    const startAnterior = `${temp.anio - 1}-08-01`;

    // El 1 de agosto la temporada arranca hoy y "ayer" todavía es julio: el rango
    // queda invertido y la API devuelve vacío. Se dice que aún no hay temporada
    // en vez de mostrar la tarjeta en blanco los primeros días.
    if (start > end) {
      return { gdd_actual: null, gdd_anio_anterior: null, diferencia_gdd: null, dias_diferencia: null,
               texto: 'La temporada de grados-día recién comienza: todavía no hay días acumulados.' };
    }

    const [actual, anterior] = await Promise.all([
      gradosDiaAcumulados({ lat, lon, start, end }),
      gradosDiaAcumulados({ lat, lon, start: startAnterior, end: endAnterior }),
    ]);

    // Sin serie no hay nada que decir. Ojo: `anterior.gdd === 0` NO entra acá —
    // es un dato válido (invierno sin acumulación) y lo resuelve `desfaseEnDias`
    // devolviendo el texto de "todavía no se puede estimar". El guard viejo
    // (`!anterior.gdd`) lo trataba como ausencia de dato y dejaba al bot sin
    // respuesta, que es cuando se la inventaba.
    if (actual.gdd == null || anterior.gdd == null || !actual.dias) {
      return { gdd_actual: actual.gdd, gdd_anio_anterior: anterior.gdd, diferencia_gdd: null, dias_diferencia: null, texto: null };
    }

    const diferencia_gdd = Math.round((actual.gdd - anterior.gdd) * 10) / 10;
    const { dias: dias_diferencia } = desfaseEnDias({
      totalActual: actual.gdd, diasActual: actual.dias, totalPrevio: anterior.gdd,
    });

    let texto;
    if (dias_diferencia == null) {
      // En invierno esto es lo normal y hay que decirlo, no callarse: el `texto`
      // en null dejaba al agente sin nada que responder y se lo inventaba.
      texto = TEXTO_SIN_DESFASE;
    } else if (dias_diferencia === 0) {
      texto = 'Esta temporada va en fase con la del año pasado.';
    } else {
      const rumbo = dias_diferencia > 0 ? 'adelantada' : 'atrasada';
      texto = `Esta temporada va ${rumbo} ~${Math.abs(dias_diferencia)} día${Math.abs(dias_diferencia) === 1 ? '' : 's'} respecto al año pasado.`;
    }

    return { gdd_actual: actual.gdd, gdd_anio_anterior: anterior.gdd, diferencia_gdd, dias_diferencia, texto };
  } catch (e) {
    return { gdd_actual: null, gdd_anio_anterior: null, diferencia_gdd: null, dias_diferencia: null, texto: null, error: e.message };
  }
}

// ── Temporada de horas frío: 1 de mayo al 31 de julio ───────────────────
//
// ESTA es la fuente única de la temporada de frío: `fields.js` la importa de
// acá. Definida con el usuario el 2026-08-13 como 1-may → 31-ago y acortada a
// 31-jul el 2026-08-24, también a pedido del usuario.
//
// Antes de mayo la temporada vigente es la del año anterior, que ya cerró.
function temporadaFrio(refISO = hoyEnChile()) {
  const [anio, mes] = refISO.split('-').map(Number);
  const base = mes >= 5 ? anio : anio - 1;
  return { anio: base, desde: `${base}-05-01`, hasta: `${base}-07-31` };
}

// ── Horas frío: UNA serie para todo el producto (2026-09-24) ─────────────
//
// Reporte de Stanley: "hay una incongruencia en los datos de horas frío".
// Medido sobre Santa Rosa (INIA-17) ese día, el mismo cuartel mostraba tres
// números: 1.047 h de "total oficial" en el subtítulo, una curva que terminaba
// en 687 h y 687 h en el bot y el boletín. No era un error de cálculo sino de
// VENTANAS: la curva y la comparación iban del 1-may al 31-jul (Open-Meteo), y
// el total oficial salía de `/accumulation`, que acumula del 1-may hasta HOY
// (temporada anual may→abr). En septiembre ya llevaba 53 días de más. La media
// histórica de la tarjeta de riesgo (1.659 h) era de temporadas anuales
// completas, otra ventana más.
//
// La API del INIA SÍ publica las horas frío diarias (`chill_hours` en
// `/series`), cosa que este código daba por inexistente. Así que ahora la
// curva, el total, la comparación con el año pasado, la media histórica, el bot
// y el cron salen de la MISMA serie diaria de la estación, recortada a la
// temporada de `temporadaFrio()`. Open-Meteo queda solo de relleno de los días
// que la estación no tenga, o de todo si no hay estación. Verificado: INIA da
// 674 h en may–jul 2026 y 812 h en may–jul 2025; Open-Meteo, 687 y 810.
//
// ⚠️ El umbral de `chill_hours` no está documentado en la API (sí el de los
// grados-día, "base 10 °C"). Por eso, con dato de la estación, `umbral_c` va en
// null y la pantalla dice "horas frío de la red INIA" sin afirmar un número.
// `CHILL_THRESHOLD` (7,2 °C) es solo el del relleno Open-Meteo.

// Horas frío por día desde el reanálisis horario → Map fecha → horas.
async function chillDiarioOpenMeteo({ lat, lon, desde, hasta, deadline = null }) {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}`
    + `&start_date=${desde}&end_date=${hasta}&hourly=temperature_2m&timezone=America%2FSantiago`;
  // Nunca más de lo que le queda a la invocación: con varios climas en
  // paralelo, dos series horarias lentas se comían el presupuesto del dashboard.
  const restante = deadline ? Math.max(1000, deadline - Date.now()) : 20000;
  const res = await fetch(url, { signal: AbortSignal.timeout(Math.min(20000, restante)) });
  if (!res.ok) return new Map();
  const h = (await res.json()).hourly;
  const porDia = new Map();
  if (!h || !h.time) return porDia;
  for (let i = 0; i < h.time.length; i++) {
    const t = h.temperature_2m[i];
    if (t == null) continue;
    const dia = h.time[i].slice(0, 10);
    porDia.set(dia, (porDia.get(dia) || 0) + (t <= CHILL_THRESHOLD ? 1 : 0));
  }
  return porDia;
}

function fechasEntre(desde, hasta) {
  const out = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) out.push(d);
  return out;
}

// Serie diaria de horas frío entre `desde` y `hasta` (inclusive), acumulada.
// → { daily: [{fecha, horas, acumulado}], fuente: 'inia'|'mixto'|'open-meteo'|null,
//     umbral_c, estacion }
async function serieFrio({ estacion = null, lat, lon, desde, hasta, deadline = null }) {
  const vacia = { daily: [], fuente: null, umbral_c: null, estacion: estacion ? estacion.name : null };
  if (!desde || !hasta || desde > hasta) return vacia;

  const porDia = new Map();
  if (estacion) {
    try {
      const { data } = await getSeries(estacion.id, desde, hasta, { deadline });
      for (const d of data || []) {
        if (d && d.date >= desde && d.date <= hasta && typeof d.chill_hours === 'number') {
          porDia.set(d.date, d.chill_hours);
        }
      }
    } catch (_) { /* sin estación, todo va al relleno */ }
  }
  const deInia = porDia.size;

  // Relleno: solo los días que faltan. Los últimos días suelen faltar en las
  // dos fuentes (las dos publican con atraso); esos quedan fuera sin inventar.
  const faltan = fechasEntre(desde, hasta).filter(f => !porDia.has(f));
  if (faltan.length && lat != null && lon != null) {
    const om = await chillDiarioOpenMeteo({ lat, lon, desde: faltan[0], hasta: faltan[faltan.length - 1], deadline })
      .catch(() => new Map());
    for (const f of faltan) if (om.has(f)) porDia.set(f, om.get(f));
  }
  if (!porDia.size) return vacia;

  let acumulado = 0;
  const daily = [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([fecha, horas]) => { acumulado += horas; return { fecha, horas, acumulado }; });
  const fuente = deInia === porDia.size ? 'inia' : (deInia ? 'mixto' : 'open-meteo');
  return {
    daily, fuente,
    umbral_c: fuente === 'inia' ? null : CHILL_THRESHOLD,
    estacion: deInia ? estacion.name : null,
  };
}

// Estación para un punto, con la misma regla que el dashboard
// (`resolverEstacion`: la más cercana entre las que sirven, prefiriendo las que
// cubren la temporada anterior). Para el bot y el cron, que solo tienen el
// centroide.
async function estacionDelPunto({ lat, lon }, { historialDesde = null, deadline = null } = {}) {
  try {
    return elegirEstacion(await estacionesCercanas({ lat, lon }, { historialDesde, deadline }));
  } catch (_) {
    return null;
  }
}

// Temporadas cerradas anteriores que entran en la media histórica. Las viejas
// no cambian: se memorizan por estación y temporada para toda la vida de la
// instancia.
const TEMPORADAS_REFERENCIA = 15;
const totalesCerrados = new Map();

async function totalTemporadaCerrada(estacion, anio, deadline) {
  const clave = `${estacion.id}|${anio}`;
  if (totalesCerrados.has(clave)) return totalesCerrados.get(clave);
  const t = temporadaFrio(`${anio}-06-01`);
  const { data } = await getSeries(estacion.id, t.desde, t.hasta, { deadline });
  const dias = (data || []).filter(d => typeof d.chill_hours === 'number');
  const esperados = fechasEntre(t.desde, t.hasta).length;
  // Mismo criterio que la API para su `reference`: cobertura ≥ 98 %. Una
  // temporada con huecos tiene el total subestimado y no es comparable.
  const r = dias.length >= Math.ceil(esperados * 0.98)
    ? { anio, total: dias.reduce((s, d) => s + d.chill_hours, 0) }
    : null;
  totalesCerrados.set(clave, r);
  return r;
}

// Resumen de la temporada de frío para la tarjeta de riesgo, con el mismo
// shape que `resumirAcumulado` (la UI no cambia de contrato) pero sobre la
// ventana de `temporadaFrio()`, no sobre la temporada anual de la red.
async function resumenFrio({ estacion, lat, lon, hasta = ayerEnChile(), deadline = null }) {
  const temp = temporadaFrio(hasta);
  const corte = hasta < temp.hasta ? hasta : temp.hasta;
  const serie = await serieFrio({ estacion, lat, lon, desde: temp.desde, hasta: corte, deadline });
  if (!serie.daily.length) return null;
  const total = serie.daily[serie.daily.length - 1].acumulado;
  const enCurso = corte < temp.hasta;
  // Pasado el 31-jul: cuánto lleva desde el 1-may hasta `hasta`. Se informa,
  // pero la comparación con otros años sigue siendo al 31-jul (Stanley).
  let aLaFecha = null;
  if (hasta > temp.hasta) {
    const s2 = await serieFrio({ estacion, lat, lon, desde: temp.desde, hasta, deadline }).catch(() => null);
    if (s2 && s2.daily.length) aLaFecha = s2.daily[s2.daily.length - 1];
  }

  let cerradas = [];
  if (estacion) {
    const anios = [];
    for (let a = temp.anio - 1; a >= temp.anio - TEMPORADAS_REFERENCIA; a--) {
      if (estacion.first_date && `${a}-05-01` < estacion.first_date) break;
      anios.push(a);
    }
    cerradas = (await Promise.all(anios.map(a => totalTemporadaCerrada(estacion, a, deadline).catch(() => null))))
      .filter(Boolean);
  }

  let comparacion = null;
  if (cerradas.length) {
    const totales = cerradas.map(c => c.total);
    const media = totales.reduce((s, x) => s + x, 0) / totales.length;
    const supera = total > media;
    comparacion = {
      media_historica: Math.round(media * 10) / 10,
      min: Math.min(...totales), max: Math.max(...totales),
      temporadas_comparadas: cerradas.length,
      // Mismo cuidado que `resumirAcumulado`: un parcial contra totales
      // completos solo se expresa en % si la temporada cerró o ya los superó.
      delta_pct: (!enCurso || supera) ? Math.round(((total - media) / media) * 1000) / 10 : null,
      comparable: !enCurso,
      supera_media: supera,
    };
  }
  return {
    temporada: temp.anio, desde: temp.desde, hasta: temp.hasta,
    total, dias_con_dato: serie.daily.length, en_curso: enCurso,
    comparacion, sin_referencia: !comparacion,
    umbral_c: serie.umbral_c, fuente: serie.fuente, estacion: serie.estacion,
    acumulado_a_la_fecha: aLaFecha ? aLaFecha.acumulado : null,
    a_la_fecha_hasta: aLaFecha ? aLaFecha.fecha : null,
  };
}

// Horas frío acumuladas en un rango (por defecto, la temporada de frío vigente
// hasta ayer). Mismo número que el dashboard: misma estación, misma serie.
// horasFrioAcumuladas({lat,lon,desde,hasta,estacion}) → { horas, periodo, fuente }
// Sin `estacion` se busca la del punto; con `estacion: null` explícito, solo
// Open-Meteo.
async function horasFrioAcumuladas({ lat, lon, desde, hasta, estacion, deadline = null }) {
  const temp = temporadaFrio();
  const ayer = ayerEnChile();
  // El `${today.getFullYear()}-05-01` de antes daba una fecha FUTURA entre
  // enero y abril, y la consulta volvía vacía justo en esos meses.
  const desdeStr = desde || temp.desde;
  const hastaStr = hasta || (ayer < temp.hasta ? ayer : temp.hasta);
  const periodo = `${desdeStr} a ${hastaStr}`;
  // El 1 de mayo la temporada arranca hoy y "ayer" todavía es abril: sin esto
  // se consulta un rango invertido y la tarjeta queda vacía uno o dos días.
  if (desdeStr > hastaStr) return { horas: null, periodo, aun_no_empieza: true };
  try {
    const est = estacion !== undefined ? estacion
      : await estacionDelPunto({ lat, lon }, { historialDesde: `${temp.anio - 1}-05-01`, deadline });
    const s = await serieFrio({ estacion: est, lat, lon, desde: desdeStr, hasta: hastaStr, deadline });
    if (!s.daily.length) return { horas: null, periodo };
    return {
      horas: s.daily[s.daily.length - 1].acumulado, periodo,
      fuente: s.fuente, estacion: s.estacion, umbral_c: s.umbral_c,
    };
  } catch (e) {
    return { horas: null, periodo, error: e.message };
  }
}

// `temporadaGdd` se exporta para que `fields.js` la consuma en vez de mantener
// su propia copia: es LA definición de la temporada en todo el producto.
module.exports = {
  compararGradosDia, horasFrioAcumuladas, gradosDiaAcumulados, temporadaGdd, temporadaFrio, ayerEnChile,
  CHILL_THRESHOLD, serieFrio, resumenFrio, estacionDelPunto,
};

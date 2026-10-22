// ════════════════════════════════════════════════════════════════════════
// Cálculos derivados del riesgo climático (§10 del PRD). Precipitación y ETo
// son nativas de la API INIA; el déficit hídrico y la comparación interanual
// NO existen en el contrato v1.0 y se calculan acá.
//
// Funciones puras sobre las series que entrega _boletin.js: sin fetch, sin
// estado. Todo lo que sale de acá alimenta el ClimateDashboardSnapshot.
// ════════════════════════════════════════════════════════════════════════

const VENTANA_DEFECTO = 2;
const VENTANA_MIN = 1;
const VENTANA_MAX = 5;

// Bajo este déficit del año anterior, el porcentaje es inestable (dividir por
// ~0 dispara valores absurdos). Se muestra la diferencia absoluta en mm.
const BASE_MINIMA_MM = 1.0;

// Versión de las reglas de cálculo. Viaja en el snapshot y queda registrada en
// cada alerta que se derive de él: si mañana cambia un umbral, se puede saber
// con qué regla se generó una alerta vieja (FR-AL-01, AC-09).
const RULE_VERSION = 'riesgo-1.0.0';

const redondear = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function normalizarVentana(n) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v)) return VENTANA_DEFECTO;
  return Math.min(Math.max(v, VENTANA_MIN), VENTANA_MAX);
}

function isoDate(d) { return d.toISOString().split('T')[0]; }
function sumarDias(iso, dias) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return isoDate(d);
}

// El último día CERRADO es el anterior a `last_date` de /health.
//
// Ojo, esto es más sutil de lo que parece y el PRD lo definía distinto: la doc
// dice que el día en curso es provisional (solo reportó parte de las estaciones)
// y que ETo queda disponible un día después. Pero la API igual devuelve `eto`
// no nulo para el día en curso — verificado el 2026-07-29: last_date era ese
// mismo día y su fila traía eto=0.43. O sea que filtrar por "eto no nulo", como
// pedía AC-03, NO alcanza para excluir el día provisional: hay que cortar por
// fecha. La no-nulidad se aplica igual, encima de este corte.
function ultimoDiaCerrado(health) {
  const lastDate = health?.data?.meteo?.last_date;
  if (!lastDate) return null;
  return sumarDias(lastDate, -1);
}

// Un día sirve para el balance solo si tiene AMBAS variables. No se imputa
// nada: si falta ETo, ese día no entra (§10.1 punto 4).
const diaCompleto = d => d && d.precip != null && d.eto != null;

// Últimos `n` días completos con fecha ≤ hasta. Devuelve en orden cronológico.
function ventanaDias(serie, n, hasta) {
  if (!Array.isArray(serie)) return [];
  return serie
    .filter(d => diaCompleto(d) && d.date <= hasta)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-n);
}

// Mismas fechas, un año antes. El 29 de febrero no existe en años no bisiestos:
// el PRD manda comparar contra el 28 (§10.2).
function mismasFechasAnioAnterior(fechas) {
  return fechas.map(f => {
    const [a, m, d] = f.split('-');
    const anterior = String(Number(a) - 1);
    if (m === '02' && d === '29') return `${anterior}-02-28`;
    return `${anterior}-${m}-${d}`;
  });
}

function acumular(dias) {
  const precip = dias.reduce((s, d) => s + d.precip, 0);
  const eto    = dias.reduce((s, d) => s + d.eto, 0);
  return { precip, eto, deficit: Math.max(eto - precip, 0) };
}

// ── Balance hídrico (§9.2 + §10.2) ──────────────────────────────────────
//
// serieActual / seriePrevia: filas crudas de /stations/{id}/series.
// → objeto listo para la tarjeta; nunca lanza por datos faltantes, informa
//   cobertura en su lugar.
function balanceHidrico({ serieActual, seriePrevia, ventana, ultimoDia }) {
  const n = normalizarVentana(ventana);
  const dias = ventanaDias(serieActual, n, ultimoDia);

  const base = {
    window_days: n,
    rule_version: RULE_VERSION,
    period_from: null, period_to: null,
    precipitation_mm: null, eto_mm: null, deficit_mm: null,
    previous_year_deficit_mm: null,
    yoy_delta_pct: null, yoy_delta_mm: null, yoy_basis: null, yoy_label: null,
    // Cómo se emparejaron los días con el año anterior: por fecha (lo normal) o
    // por posición (solo si la ventana cruza el 29 de febrero). Va al snapshot
    // para que la auditoría de §5 pueda explicar de dónde salió la comparación.
    yoy_pairing: null,
    completeness: { dias_pedidos: n, dias_usados: dias.length, suficiente: false },
    previous_year_completeness: { dias_pedidos: n, dias_usados: 0, suficiente: false },
  };

  // Sin los N días completos no se muestra un número a medias: se dice cuántos
  // se encontraron y la tarjeta pinta "datos insuficientes" (§13).
  if (dias.length < n) return base;

  const fechas = dias.map(d => d.date);
  const actual = acumular(dias);

  // `ventanaDias` toma los últimos N días CON DATO, no los últimos N días de
  // calendario: con huecos de ETo —que los hay, es el motivo de `margenConsulta`—
  // una "ventana de 2 días" puede abarcar del 01/08 al 12/08, y la tarjeta lo
  // rotulaba como "del 01/08 al 12/08 (2 días cerrados)", contradiciéndose sola.
  // Los milímetros se leen como "llovió 5 mm en 2 días" cuando son de 12.
  const abarcaDias = Math.round(
    (Date.parse(`${fechas[fechas.length - 1]}T12:00:00Z`) - Date.parse(`${fechas[0]}T12:00:00Z`)) / 86400000) + 1;

  const snapshot = {
    ...base,
    period_from: fechas[0],
    period_to: fechas[fechas.length - 1],
    precipitation_mm: redondear(actual.precip),
    eto_mm: redondear(actual.eto),
    deficit_mm: redondear(actual.deficit),
    completeness: {
      dias_pedidos: n, dias_usados: dias.length, suficiente: true,
      // Días de calendario que cubre el período, para que la UI pueda decir
      // "2 días con dato repartidos en 12" en vez de solo "2 días".
      dias_calendario: abarcaDias,
      con_huecos: abarcaDias > dias.length,
    },
  };

  // ── Comparación interanual: las MISMAS fechas del año anterior (AC-05).
  //
  // Salvo un caso: si la ventana contiene el 28 Y el 29 de febrero, las dos
  // fechas colapsan en el mismo día del año anterior (el 29 no existe fuera de
  // los bisiestos, y el PRD manda compararlo contra el 28). Emparejar por fecha
  // encontraría un solo día previo, `diasPrevios.length < n`, y la comparación
  // se perdería entera justo en el año bisiesto. En ese caso —y solo en ese— se
  // empareja por POSICIÓN: los últimos N días completos del año anterior que
  // terminan en la fecha espejo del último día de la ventana.
  const fechasPrevias = mismasFechasAnioAnterior(fechas);
  const colapsanFechas = new Set(fechasPrevias).size < fechasPrevias.length;
  const diasPrevios = colapsanFechas
    ? ventanaDias(seriePrevia, n, fechasPrevias[fechasPrevias.length - 1])
    : (seriePrevia || []).filter(d => diaCompleto(d) && fechasPrevias.includes(d.date));
  snapshot.previous_year_completeness = {
    dias_pedidos: n, dias_usados: diasPrevios.length, suficiente: diasPrevios.length === n,
  };
  snapshot.yoy_pairing = colapsanFechas ? 'posicion' : 'fecha';

  if (diasPrevios.length < n) {
    snapshot.yoy_basis = 'sin_historial';
    snapshot.yoy_label = 'sin comparación interanual';
    return snapshot;
  }

  const previo = acumular(diasPrevios);
  snapshot.previous_year_deficit_mm = redondear(previo.deficit);
  snapshot.yoy_delta_mm = redondear(actual.deficit - previo.deficit);

  if (previo.deficit < BASE_MINIMA_MM) {
    // Base cero: el porcentaje sería inestable o infinito (AC-06).
    snapshot.yoy_basis = 'sin_base_comparable';
    snapshot.yoy_label = 'sin base comparable';
    return snapshot;
  }

  if (actual.deficit === 0) {
    // Formalmente es −100 %, y así se calcula, pero "100 % menos déficit"
    // suena a un cambio dramático cuando lo que pasó es que llovió y no hay
    // déficit. Se marca aparte para que la UI lo lea como estado, no como
    // variación. Caso frecuente en invierno: medido en Rengo (jul-2026),
    // el déficit fue 0 en ventanas de 2, 5 y 30 días.
    snapshot.yoy_delta_pct = -100;
    snapshot.yoy_basis = 'sin_deficit_actual';
    snapshot.yoy_label = 'sin déficit en el período';
    return snapshot;
  }

  const delta = ((actual.deficit - previo.deficit) / previo.deficit) * 100;
  snapshot.yoy_delta_pct = redondear(delta, 1);
  snapshot.yoy_basis = 'comparable';
  snapshot.yoy_label = delta >= 0 ? 'más déficit' : 'menos déficit';
  return snapshot;
}

// Cuántos días de serie pedir para encontrar N días completos. Se pide de más
// a propósito (§10.1 punto 2): los días incompletos no cuentan, así que con
// pedir exactamente N no alcanzaría si alguno viene con ETo nula.
function margenConsulta(n) { return Math.max(n * 4, 12); }

// ════════════════════════════════════════════════════════════════════════
// P2 — Perfil de riesgo y tendencia de temperatura
//
// Todo lo que sigue se apoya en campos NATIVOS de la API INIA, verificados
// contra el servicio real el 2026-07-30. Las definiciones son suyas, no
// nuestras (vienen en `meta.notes` de /series):
//
//   frost     = 1  ⟺  tmín ≤ 0 °C
//   heat_wave = 1  ⟺  día dentro de una racha ≥3 días con tmáx ≥ P90 climatológico
//
// No se reimplementan ni se ajustan: si INIA cambia el criterio, la plataforma
// cambia con él. Lo que sí es nuestro es la CLASIFICACIÓN en niveles, y eso es
// una decisión agronómica abierta — ver UMBRALES_DEFECTO.
// ════════════════════════════════════════════════════════════════════════

// La ventana del balance hídrico son 1-5 días (lo que pide el PRD), pero para
// riesgo de helada o calor esa ventana no dice nada: hay que mirar el mes.
const VENTANA_PERFIL_DEFECTO = 30;
const VENTANA_PERFIL_MIN = 7;
const VENTANA_PERFIL_MAX = 120;

function normalizarVentanaPerfil(n) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v)) return VENTANA_PERFIL_DEFECTO;
  return Math.min(Math.max(v, VENTANA_PERFIL_MIN), VENTANA_PERFIL_MAX);
}

// ⚠️ PLACEHOLDERS. Los umbrales LOW/MED/HIGH por cultivo y etapa fenológica son
// la decisión #1 pendiente del §18 del PRD, a cerrar con INIA el 5 de agosto.
// Están acá, nombrados y en un solo lugar, para poder llevarlos a esa reunión en
// vez de enterrarlos en la lógica — y todo lo que se clasifica con ellos viaja
// con `umbrales_origen: 'placeholder'` para que la UI no los presente como
// criterio validado.
//
// Por qué son insuficientes por diseño: una helada de −1 °C es catastrófica en
// plena floración e irrelevante en dormancia. Sin etapa fenológica —que la
// plataforma hoy no conoce— cualquier umbral fijo es una aproximación.
const UMBRALES_DEFECTO = {
  helada:  { tmin_alto: -2, dias_alto: 3 },
  calor:   { episodios_alto: 2 },
  hidrico: { yoy_alto_pct: 25 },
  // El corte de 7 días es el único de esta tabla que NO es un placeholder
  // nuestro: lo fijó el equipo como el desfase a partir del cual conviene
  // revisar el calendario de aplicaciones. Igual vive acá, junto al resto, para
  // que se pueda discutir y ajustar por cultivo en la reunión con INIA.
  termica: { desfase_dias_alto: 7 },
};

const NIVELES = { alto: 'alto', medio: 'medio', bajo: 'bajo', sin_dato: 'sin_dato' };

// Últimos N días de la serie hasta `hasta`, sin exigir precip/eto (a diferencia
// de ventanaDias, que es para el balance): acá interesan temperatura y banderas.
function ventanaDiasTemperatura(serie, n, hasta) {
  if (!Array.isArray(serie)) return [];
  return serie
    .filter(d => d && d.date <= hasta && d.tmin != null && d.tmax != null)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-n);
}

const activo = v => v === 1 || v === true;

// ── Helada ──────────────────────────────────────────────────────────────
//
// `acumulado` es la fila de /accumulation?variable=heladas: sirve para decir si
// la temporada va cargada respecto de las anteriores, que es la lectura que un
// asesor pide de verdad ("¿esto es normal para el año?").
// Umbral de AVISO del motor de alertas (`check-alerts.js`, `_sensors.js`): se
// avisa por WhatsApp bajo 2 °C, antes de que la helada ocurra. No es la
// definición de helada — son dos cosas distintas que hasta ahora no se
// distinguían, y por eso la web y el WhatsApp se contradecían: un productor con
// mínimas de 1,5 / 0,2 / 0,6 / 0,7 °C recibía cuatro avisos y después leía
// "sin heladas en el período" (verificado en Fundo Valdivia, 2026-08-13).
// Ahora las noches de riesgo se cuentan y se muestran aparte, con su nombre.
const TMIN_AVISO_HELADA = 2;

function perfilHelada(dias, { acumulado = null, umbrales = UMBRALES_DEFECTO } = {}) {
  if (!dias.length) return { nivel: NIVELES.sin_dato, dias_con_helada: 0, detalle: 'sin datos de temperatura en el período' };

  // `frost` es la bandera de la API del INIA; donde no viene (respaldo ERA5) se
  // aplica su misma definición sobre la mínima del día.
  // `d.tmin != null` explícito: sin él, `null <= 0` es `true` en JavaScript y un
  // día sin medir contaba como helada. Hoy lo tapa el filtro de
  // `ventanaDiasTemperatura`, pero la función tiene que ser correcta por sí sola
  // — la línea de `nochesRiesgo` ya lo chequeaba y esta no.
  const esHelada = d => (d.frost != null ? activo(d.frost) : (d.tmin != null && d.tmin <= 0));
  const conHelada = dias.filter(esHelada);
  // Noche de riesgo: NO fue helada, pero estuvo lo bastante cerca como para que
  // el sistema avisara. Se excluyen explícitamente las que sí fueron helada
  // para que los dos números se puedan sumar sin contar nada dos veces.
  // `<=` y no `<`: el motor de alertas avisa con `tmin <= heladaC`
  // (`nivelHelada` en _sensors.js), así que con una mínima de exactamente
  // 2,0 °C el productor recibía el WhatsApp y después leía en la web que no
  // hubo ninguna noche de riesgo. Es el mismo tipo de contradicción que este
  // bloque dice haber resuelto; el borde quedaba abierto.
  const nochesRiesgo = dias.filter(d => !esHelada(d) && d.tmin != null && d.tmin <= TMIN_AVISO_HELADA);
  const tminMin = Math.min(...dias.map(d => d.tmin));
  const ultima = conHelada.length ? conHelada[conHelada.length - 1] : null;
  const ultimaNoche = nochesRiesgo.length ? nochesRiesgo[nochesRiesgo.length - 1] : null;

  let nivel = NIVELES.bajo;
  if (conHelada.length) {
    nivel = (tminMin <= umbrales.helada.tmin_alto || conHelada.length >= umbrales.helada.dias_alto)
      ? NIVELES.alto : NIVELES.medio;
  } else if (nochesRiesgo.length) {
    // Sin helada declarada pero con noches bajo el umbral de aviso, el riesgo no
    // es "bajo": es justamente el escenario en que se mandaron alertas.
    nivel = NIVELES.medio;
  }

  return {
    nivel,
    dias_con_helada: conHelada.length,
    dias_evaluados: dias.length,
    tmin_minima: redondear(tminMin, 1),
    ultima_helada: ultima ? { fecha: ultima.date, tmin: redondear(ultima.tmin, 1) } : null,
    // Lo que explica los avisos de WhatsApp que no aparecían por ningún lado.
    noches_riesgo: nochesRiesgo.length,
    ultima_noche_riesgo: ultimaNoche ? { fecha: ultimaNoche.date, tmin: redondear(ultimaNoche.tmin, 1) } : null,
    umbral_aviso_c: TMIN_AVISO_HELADA,
    temporada: resumirAcumulado(acumulado),
    definicion: 'INIA: helada = temperatura mínima ≤ 0 °C · aviso preventivo bajo 2 °C',
  };
}

// ── Ola de calor ────────────────────────────────────────────────────────
//
// La API marca DÍA A DÍA la pertenencia a una racha; acá se agrupan los días
// consecutivos en episodios, que es como se lee un evento de calor.
function perfilCalor(dias, { acumulado = null, umbrales = UMBRALES_DEFECTO } = {}) {
  if (!dias.length) return { nivel: NIVELES.sin_dato, episodios: [], detalle: 'sin datos de temperatura en el período' };

  // Fechas que SÍ tienen fila en la ventana: un día ausente no es un día sin
  // ola de calor, es un día sin medir. `ventanaDiasTemperatura` descarta los
  // días sin tmax/tmin, así que un solo hueco en medio de una racha la partía en
  // dos episodios — y con el corte en "≥2 episodios ⇒ alto", una racha única de
  // 5 días con un hueco pasaba de nivel MEDIO a ALTO sin que cambiara el clima.
  const medidos = new Set(dias.map(d => d.date));
  const continuaLaRacha = (finAnterior, fecha) => {
    let cursor = sumarDias(finAnterior, 1);
    // Se salta los días que no tenemos medidos; si aparece uno medido que no
    // está marcado como ola, ahí sí se corta el episodio.
    while (cursor < fecha && !medidos.has(cursor)) cursor = sumarDias(cursor, 1);
    return cursor === fecha;
  };

  const episodios = [];
  for (const d of dias) {
    if (!activo(d.heat_wave)) continue;
    const ultimo = episodios[episodios.length - 1];
    if (ultimo && continuaLaRacha(ultimo.hasta, d.date)) {
      // Días de calendario que quedaron sin medir dentro del episodio, para no
      // hacer pasar por continuo algo que se reconstruyó salteando huecos.
      ultimo.dias_sin_dato += Math.max(0,
        Math.round((Date.parse(`${d.date}T12:00:00Z`) - Date.parse(`${ultimo.hasta}T12:00:00Z`)) / 86400000) - 1);
      ultimo.hasta = d.date;
      ultimo.dias++;
      ultimo.tmax_maxima = Math.max(ultimo.tmax_maxima, d.tmax);
    } else {
      episodios.push({ desde: d.date, hasta: d.date, dias: 1, dias_sin_dato: 0, tmax_maxima: d.tmax });
    }
  }
  episodios.forEach(e => { e.tmax_maxima = redondear(e.tmax_maxima, 1); });

  const ultimoDia = dias[dias.length - 1];
  const enCurso = activo(ultimoDia.heat_wave);

  let nivel = NIVELES.bajo;
  if (episodios.length) {
    nivel = (enCurso || episodios.length >= umbrales.calor.episodios_alto) ? NIVELES.alto : NIVELES.medio;
  }

  return {
    nivel,
    episodios,
    episodio_en_curso: enCurso,
    dias_en_ola: dias.filter(d => activo(d.heat_wave)).length,
    dias_evaluados: dias.length,
    tmax_maxima: redondear(Math.max(...dias.map(d => d.tmax)), 1),
    temporada: resumirAcumulado(acumulado),
    definicion: 'INIA: día dentro de una racha de ≥3 días con temperatura máxima ≥ percentil 90 climatológico',
  };
}

// ── Estrés hídrico ──────────────────────────────────────────────────────
//
// No recalcula nada: clasifica el balance que ya produjo balanceHidrico(), para
// que la tarjeta y el perfil nunca puedan contradecirse.
function nivelEstresHidrico(balance, { umbrales = UMBRALES_DEFECTO } = {}) {
  if (!balance || !balance.completeness?.suficiente) {
    return { nivel: NIVELES.sin_dato, detalle: 'sin días completos para calcular el balance' };
  }
  const { deficit_mm, yoy_delta_pct, yoy_basis } = balance;

  if (deficit_mm === 0) {
    return { nivel: NIVELES.bajo, deficit_mm, detalle: 'sin déficit en el período', yoy_basis };
  }
  // Con déficit pero sin comparación posible no se puede decir si es mucho o
  // poco para esta época: se informa el dato sin inventar una severidad.
  if (yoy_basis !== 'comparable') {
    return { nivel: NIVELES.medio, deficit_mm, detalle: 'hay déficit, sin base para compararlo con el año anterior', yoy_basis };
  }
  const nivel = yoy_delta_pct >= umbrales.hidrico.yoy_alto_pct ? NIVELES.alto
    : (yoy_delta_pct >= 0 ? NIVELES.medio : NIVELES.bajo);
  return { nivel, deficit_mm, yoy_delta_pct, yoy_basis };
}

// Normaliza una respuesta de /accumulation a lo que necesita la UI: cuánto va
// esta temporada y cómo se compara con las temporadas completas anteriores.
//
// `reference` puede ser null: la API solo promedia temporadas con ≥98 % de
// cobertura, y una estación nueva no tiene ninguna. Eso NO es un error — es
// información, y se devuelve como tal en vez de omitir el bloque.
function resumirAcumulado(acumulado) {
  if (!acumulado) return null;
  // Se ORDENA por temporada antes de tomar la última. El contrato no garantiza
  // el orden de `data`, y con una respuesta descendente se estaba mostrando la
  // temporada MÁS VIEJA como si fuera la actual.
  const temporadas = (Array.isArray(acumulado.data) ? [...acumulado.data] : [])
    .sort((a, b) => (Number(a.season) || 0) - (Number(b.season) || 0));
  const actual = temporadas[temporadas.length - 1] || null;
  const ref = acumulado.meta?.reference || null;

  // La API solo promedia temporadas con ≥98 % de cobertura; la temporada en
  // curso no llega a eso, así que su total es parcial por definición.
  const enCurso = Boolean(actual && actual.days < 358);

  let comparacion = null;
  if (actual && ref && typeof ref.mean === 'number' && ref.mean > 0) {
    // ⚠️ Un porcentaje entre un acumulado PARCIAL y totales COMPLETOS está
    // sesgado a la baja por construcción, y en el extremo da "−100 %" en pleno
    // invierno solo porque el verano todavía no llegó — que se lee como una
    // anomalía cuando no lo es. Mismo problema que el déficit 0 de la tarjeta
    // de balance, y misma solución: se rotula el caso en vez de mostrar un
    // número que engaña.
    //
    // La excepción es informativa y segura: si la temporada en curso YA superó
    // la media de las cerradas, el sesgo juega a favor y la afirmación se
    // sostiene (solo puede crecer más).
    const supera = actual.total > ref.mean;
    comparacion = {
      media_historica: redondear(ref.mean, 1),
      min: ref.min, max: ref.max,
      temporadas_comparadas: ref.seasons_used ?? null,
      // Solo se publica el porcentaje cuando es metodológicamente comparable:
      // temporada cerrada, o en curso pero ya por encima de la media.
      delta_pct: (!enCurso || supera) ? redondear(((actual.total - ref.mean) / ref.mean) * 100, 1) : null,
      comparable: !enCurso,
      supera_media: supera,
    };
  }

  return {
    temporada: actual?.season ?? null,
    total: actual?.total ?? null,
    dias_con_dato: actual?.days ?? null,
    en_curso: enCurso,
    comparacion,
    sin_referencia: !ref,
  };
}

// ── Tendencia de temperatura ────────────────────────────────────────────
//
// Compara la temperatura media de la ventana actual contra las MISMAS fechas de
// las temporadas anteriores de la propia estación.
//
// ⚠️ Esto es "histórico de estación", NO la normal climática. La API expone
// además `normals_monthly` en /stations/{id}, que es **CR2 1991–2020**
// (verificado: `meta.normal_reference`), un período y una fuente distintos. Se
// devuelven las dos, rotuladas, porque responden preguntas distintas: la banda
// dice si el mes se sale de lo que esa estación suele registrar; la normal, si
// se sale del clima de referencia del país. Confundirlas es el error que el
// plan advertía.
// Mínimo de temporadas para publicar un "rango habitual". Con menos, los
// percentiles son el mínimo y el máximo de la muestra y no significan nada.
const TEMPORADAS_MINIMAS_BANDA = 5;

function tendenciaTemperatura({ diasActuales, seriesPrevias = [], normalMes = null }) {
  const tmeanDe = dias => {
    const v = (dias || []).map(d => d.tmean).filter(x => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };

  const actual = tmeanDe(diasActuales);
  const historicas = seriesPrevias
    .map(s => ({ temporada: s.temporada, tmean: tmeanDe(s.dias), dias: (s.dias || []).length }))
    .filter(h => h.tmean != null && h.dias > 0);

  const base = {
    tmean_actual: actual != null ? redondear(actual, 1) : null,
    dias_evaluados: (diasActuales || []).length,
    temporadas_historicas: historicas.map(h => ({ temporada: h.temporada, tmean: redondear(h.tmean, 1), dias: h.dias })),
    banda: null,
    anomalia_vs_estacion_c: null,
    normal_cr2: normalMes != null ? redondear(normalMes, 1) : null,
    anomalia_vs_normal_c: (actual != null && normalMes != null) ? redondear(actual - normalMes, 1) : null,
    fuente_banda: 'histórico de la estación',
    fuente_normal: 'normal climática CR2 1991–2020',
  };

  if (!historicas.length || actual == null) return base;

  // Con una o dos temporadas, p10 y p90 son el mínimo y el máximo de esa
  // muestra: la "banda" colapsa a un punto o a un segmento entre dos años, y
  // CUALQUIER diferencia mayor que cero cae "sobre el rango habitual". Eso no
  // es una anomalía, es no tener con qué comparar. Es el caso real de las
  // estaciones nuevas del catálogo (Quilamapu registra desde octubre de 2025).
  base.temporadas_disponibles = historicas.length;
  if (historicas.length < TEMPORADAS_MINIMAS_BANDA) {
    base.banda_no_interpretable = true;
    base.detalle_banda = `se necesitan al menos ${TEMPORADAS_MINIMAS_BANDA} temporadas para hablar de "rango habitual"; `
                       + `esta estación tiene ${historicas.length}.`;
    return base;
  }

  const valores = historicas.map(h => h.tmean).sort((a, b) => a - b);
  base.banda = {
    p10: redondear(percentil(valores, 10), 1),
    p50: redondear(percentil(valores, 50), 1),
    p90: redondear(percentil(valores, 90), 1),
    temporadas: historicas.length,
  };
  base.anomalia_vs_estacion_c = redondear(actual - base.banda.p50, 1);
  base.posicion = actual > base.banda.p90 ? 'sobre el rango habitual'
    : (actual < base.banda.p10 ? 'bajo el rango habitual' : 'dentro del rango habitual');
  return base;
}

// Percentil por interpolación lineal sobre un array YA ordenado.
function percentil(ordenados, p) {
  if (!ordenados.length) return null;
  if (ordenados.length === 1) return ordenados[0];
  const pos = (p / 100) * (ordenados.length - 1);
  const bajo = Math.floor(pos), alto = Math.ceil(pos);
  if (bajo === alto) return ordenados[bajo];
  return ordenados[bajo] + (ordenados[alto] - ordenados[bajo]) * (pos - bajo);
}

// ── Acumulación térmica (grados-día) ────────────────────────────────────
//
// Reemplaza al estrés hídrico en el perfil de riesgo. Los dos motivos:
//
//  1. El déficit hídrico ya tiene su propia tarjeta arriba, con más detalle
//     (barras de precipitación/ETo, ventana configurable, estación elegible).
//     Repetirlo como una fila del perfil no agregaba información: la duplicaba,
//     y abría la puerta a que las dos vistas se contradijeran.
//  2. La acumulación térmica es lo que decide CUÁNDO hacer las cosas. Si la
//     temporada viene corrida respecto de la anterior, el calendario de
//     aplicaciones armado sobre la experiencia del año pasado queda desfasado,
//     y ese es un error caro que no avisa por sí solo.
//
// El desfase se expresa en DÍAS EQUIVALENTES y no en °C·día, porque los días
// son la unidad en la que se decide: "adelantado 9 días" se traduce solo a una
// acción, "+112 °C·día" no.
//
// ⚠️ La conversión es una aproximación deliberada: se divide la diferencia de
// GDD por el promedio diario de GDD del período actual. No es fenología por
// cultivo — para eso haría falta el modelo del cultivo y su etapa, que la
// plataforma todavía no conoce (misma limitación que UMBRALES_DEFECTO).
const GDD_BASE = 10;                 // °C, mismo umbral que _agroclim.js y el dashboard
const DESFASE_DIAS_RIESGO = 7;       // corte pedido: más de 7 días ⇒ hay que ajustar

// ── Cuándo el desfase en días significa algo (2026-08-14) ───────────────
//
// La conversión "diferencia de GDD ÷ promedio diario" DEGENERA cuando la
// temporada anterior acumuló ≈0, que es lo normal de julio a septiembre en
// Chile central: con `prev ≈ 0`, la diferencia es ≈ `act.total`, y
// `act.total / (act.total / n)` da exactamente `n`. O sea, el "desfase"
// pasa a ser "cuántos días lleva la temporada" y no mide nada.
//
// Medido el 2026-08-14 en el cuartel piloto (−36,5342 / −71,9304), día a día
// de la temporada: día 7 → "7 días", día 14 → "14 días", día 21 → "21 días",
// día 45 → "42 días". El guard viejo (`promedioDiario > 0.5`) no lo atrapa:
// con la ventana de 30 días —la de por defecto— el promedio daba 0,553 y el
// perfil publicaba "atrasada 24 días, nivel alto", mientras que con ventana de
// 60 el mismo cuartel el mismo día decía "sin dato, nivel bajo".
//
// El guard correcto es sobre el ACUMULADO de ambas series: hasta que las dos
// no hayan juntado calor suficiente, la razón entre ellas es ruido. 100 °C·día
// son ~20 días de acumulación real a ritmo de primavera.
//
// Segunda cota: el desfase no puede superar la ventana evaluada. Decir
// "atrasada 24 días" mirando 30 días de datos es aritméticamente posible y
// agronómicamente absurdo.
const GDD_MINIMO_PARA_DESFASE = 100;   // °C·día, en AMBAS temporadas

// Devuelve { dias, motivo }. `dias` null ⇒ no interpretable, y `motivo` explica
// por qué, para que la UI y el bot digan lo mismo.
function desfaseEnDias({ totalActual, diasActual, totalPrevio }) {
  if (!diasActual) return { dias: null, motivo: 'sin_datos' };
  if (totalActual < GDD_MINIMO_PARA_DESFASE || totalPrevio < GDD_MINIMO_PARA_DESFASE) {
    return { dias: null, motivo: 'acumulacion_insuficiente' };
  }
  const promedioDiario = totalActual / diasActual;
  if (!(promedioDiario > 0)) return { dias: null, motivo: 'acumulacion_insuficiente' };
  const crudo = Math.round((totalActual - totalPrevio) / promedioDiario);
  // Acotado a la ventana: el desfase se mide DENTRO del período observado.
  const acotado = Math.max(-diasActual, Math.min(diasActual, crudo));
  return { dias: acotado, motivo: acotado === crudo ? null : 'acotado_a_la_ventana' };
}

const TEXTO_SIN_DESFASE = 'Todavía no hay acumulación térmica suficiente para estimar adelanto o atraso.';

function gddDeDias(dias) {
  let total = 0, contados = 0;
  for (const d of dias) {
    if (d.tmax == null || d.tmin == null) continue;
    total += Math.max(0, (d.tmax + d.tmin) / 2 - GDD_BASE);
    contados++;
  }
  return { total, dias: contados };
}

function perfilAcumulacionTermica(diasActuales, diasPrevios, { acumulado = null, umbrales = UMBRALES_DEFECTO } = {}) {
  // Solo días con las dos temperaturas: son los que aportan grados-día.
  const conDato = arr => (arr || []).filter(d => d && d.tmax != null && d.tmin != null);
  const utilesAct  = conDato(diasActuales);
  const utilesPrev = conDato(diasPrevios);

  if (!utilesAct.length) {
    return { nivel: NIVELES.sin_dato, detalle: 'sin datos de temperatura en el período' };
  }

  // La acumulación que se informa es la del período completo pedido: es un dato
  // válido por sí solo, aunque no haya con qué compararlo.
  const total = gddDeDias(utilesAct);
  const base = { gdd_acumulado: redondear(total.total, 1), dias_evaluados: total.dias, gdd_base: GDD_BASE,
                 temporada: resumirAcumulado(acumulado) };

  if (!utilesPrev.length) {
    // Sin año anterior no hay desfase que medir. Se informa la acumulación
    // igual (es útil por sí sola) pero sin fabricar un nivel de riesgo.
    return { ...base, nivel: NIVELES.sin_dato, gdd_anio_anterior: null, dias_desfase: null,
             detalle: 'sin datos del mismo período de la temporada anterior para comparar' };
  }

  // Para COMPARAR, las dos ventanas tienen que tener el mismo número de días.
  // Si una trae menos —le faltaban filas al proveedor, o el rango se recortó—
  // la diferencia de acumulados mide sobre todo esa asimetría y no el clima:
  // la serie más larga siempre acumula más.
  //
  // Es exactamente lo que pasaba con el respaldo: la ventana actual venía de la
  // API de pronóstico (60 días reales de 90 pedidos) y la previa del archivo
  // (90 completos). El desfase salía −15,7 °C·día cuando lo correcto era −6,6.
  // Se recortan las dos a la COLA común: los días más recientes, que son los
  // que gobiernan la decisión.
  const nComun = Math.min(utilesAct.length, utilesPrev.length);
  const act  = gddDeDias(utilesAct.slice(-nComun));
  const prev = gddDeDias(utilesPrev.slice(-nComun));
  base.dias_comparados = nComun;
  // Se dice cuándo la comparación usó menos días que el período informado, en
  // vez de dejar que el número quede sin explicación.
  if (nComun < total.dias) base.dias_evaluados_previos = utilesPrev.length;

  const diferencia = act.total - prev.total;
  // Ver `desfaseEnDias`: el guard va sobre el acumulado de las DOS temporadas,
  // no sobre el promedio diario. Con el guard viejo, en invierno el desfase
  // degeneraba en "cuántos días lleva la temporada".
  const { dias: diasDesfase } = desfaseEnDias({
    totalActual: act.total, diasActual: act.dias, totalPrevio: prev.total,
  });

  if (diasDesfase == null) {
    // Nivel `sin_dato` y no `bajo`: no pudimos evaluar, que no es lo mismo que
    // "el riesgo es bajo". Con `bajo`, `nivelGlobal` daba por evaluado el
    // cuartel entero en pleno invierno.
    return { ...base, nivel: NIVELES.sin_dato, gdd_anio_anterior: redondear(prev.total, 1),
             diferencia_gdd: redondear(diferencia, 1), dias_desfase: null,
             detalle: `${TEXTO_SIN_DESFASE} Se necesitan al menos ${GDD_MINIMO_PARA_DESFASE} °C·día `
                    + `acumulados en las dos temporadas (van ${redondear(act.total, 1)} y ${redondear(prev.total, 1)}).` };
  }

  const magnitud = Math.abs(diasDesfase);
  const nivel = magnitud > (umbrales.termica?.desfase_dias_alto ?? DESFASE_DIAS_RIESGO)
    ? NIVELES.alto : NIVELES.bajo;

  return {
    ...base,
    nivel,
    gdd_anio_anterior: redondear(prev.total, 1),
    diferencia_gdd: redondear(diferencia, 1),
    dias_desfase: diasDesfase,           // + = adelantada, − = atrasada
    rumbo: diasDesfase > 0 ? 'adelantada' : (diasDesfase < 0 ? 'atrasada' : 'en fase'),
    umbral_dias: umbrales.termica?.desfase_dias_alto ?? DESFASE_DIAS_RIESGO,
  };
}

// ── Acumulación térmica de la TEMPORADA (2026-09-24) ────────────────────
//
// La tarjeta de riesgo medía el desfase sobre la ventana móvil del perfil (30
// días, con el mínimo de 100 °C·día de `desfaseEnDias`), mientras el gráfico de
// grados-día —dos tarjetas más abajo— lo mide sobre la temporada (1-ago → hoy)
// en horizontal. Sobre Santa Rosa el 24-09 una decía "no hay acumulación
// suficiente" y la otra "atrasada ~5 días". Decisión del usuario: la tarjeta
// usa la temporada, o sea la `comparacionTemporada` que ya calcula el gráfico
// (`calcularAgroclim` en fields.js). Esto solo le pone nivel y shape de perfil.
//
// `comparacion` = { gdd_actual, gdd_anio_anterior, diferencia_gdd,
// dias_diferencia, texto }; `gdd` = el objeto `gdd` del mismo cómputo.
function perfilTermicaDeTemporada(comparacion, gdd, { umbrales = UMBRALES_DEFECTO } = {}) {
  const base = {
    ventana: 'temporada',
    temporada_desde: gdd?.desde ?? null,
    gdd_base: GDD_BASE,
    gdd_acumulado: comparacion.gdd_actual != null ? redondear(comparacion.gdd_actual, 1) : null,
    gdd_anio_anterior: comparacion.gdd_anio_anterior != null ? redondear(comparacion.gdd_anio_anterior, 1) : null,
    diferencia_gdd: comparacion.diferencia_gdd ?? null,
    dias_evaluados: gdd?.dias_corridos ?? null,
  };
  const dias = comparacion.dias_diferencia;
  if (dias == null) {
    return { ...base, nivel: NIVELES.sin_dato, dias_desfase: null, detalle: comparacion.texto || TEXTO_SIN_DESFASE };
  }
  const umbral = umbrales.termica?.desfase_dias_alto ?? DESFASE_DIAS_RIESGO;
  return {
    ...base,
    nivel: Math.abs(dias) > umbral ? NIVELES.alto : NIVELES.bajo,
    dias_desfase: dias,                  // + = adelantada, − = atrasada
    rumbo: dias > 0 ? 'adelantada' : (dias < 0 ? 'atrasada' : 'en fase'),
    umbral_dias: umbral,
  };
}

// ── Temporada de riego (2026-08-14) ─────────────────────────────────────
//
// De septiembre a fines de marzo. Fuera de eso la demanda la cubre la lluvia y
// el déficit no gobierna ninguna decisión de riego.
//
// Vive acá, y no solo en el front, porque el CRON de alertas tiene que usar el
// mismo criterio que la pantalla. Hasta hoy no lo hacía: la alerta de "falta de
// agua" (<5 mm en 7 días) se disparaba los doce meses del año, mientras que la
// tarjeta de balance hídrico solo se dibuja en temporada. En agosto el productor
// recibía "solo 0 mm en 7 días, revisa el riego" y al entrar a la app no había
// absolutamente nada sobre agua — además de que el aviso es climáticamente
// absurdo en pleno invierno chileno.
//
// El espejo en el front es `enTemporadaDeRiego()` de public/app.html. Si se
// cambian los meses, hay que cambiarlos en los dos lados.
const MES_INICIO_RIEGO = 9;   // septiembre
const MES_FIN_RIEGO    = 3;   // marzo (inclusive)

function enTemporadaDeRiego(fechaISO) {
  const mes = Number(String(fechaISO).slice(5, 7));
  return mes >= MES_INICIO_RIEGO || mes <= MES_FIN_RIEGO;
}

// ── Cuándo empieza a AVISAR la alerta de riego (2026-09-10) ─────────────
//
// La tarjeta de balance hídrico se dibuja desde el 1 de septiembre; la alerta
// de "falta de agua" no sale hasta el 15 (pedido del usuario). La primera
// quincena de septiembre todavía es transición: el productor mira el balance
// para decidir cuándo abrir el riego, pero un WhatsApp que dice "solo 0 mm en
// 7 días, revisa el riego" llega antes de que haya riego que revisar.
//
// Es la ÚNICA divergencia deliberada entre la pantalla y el canal de avisos, y
// solo corre hacia adelante: el cierre (fin de marzo) es el mismo en los dos.
// Si mañana se quiere alinear de nuevo, se borra esta función y el cron vuelve
// a `enTemporadaDeRiego`.
const DIA_INICIO_ALERTA_RIEGO = 15;

function enTemporadaDeAlertaRiego(fechaISO) {
  if (!enTemporadaDeRiego(fechaISO)) return false;
  const mes = Number(String(fechaISO).slice(5, 7));
  if (mes !== MES_INICIO_RIEGO) return true;
  return Number(String(fechaISO).slice(8, 10)) >= DIA_INICIO_ALERTA_RIEGO;
}

// Peor nivel de un conjunto — el titular del perfil.
function nivelGlobal(niveles) {
  const orden = [NIVELES.alto, NIVELES.medio, NIVELES.bajo, NIVELES.sin_dato];
  for (const n of orden) if (niveles.includes(n)) return n;
  return NIVELES.sin_dato;
}

module.exports = {
  balanceHidrico, ultimoDiaCerrado, normalizarVentana, ventanaDias,
  mismasFechasAnioAnterior, margenConsulta, sumarDias, isoDate,
  VENTANA_DEFECTO, VENTANA_MIN, VENTANA_MAX, BASE_MINIMA_MM, RULE_VERSION,
  // P2 — perfil de riesgo y tendencia de temperatura
  perfilHelada, perfilCalor, nivelEstresHidrico, perfilAcumulacionTermica, perfilTermicaDeTemporada, tendenciaTemperatura,
  resumirAcumulado, ventanaDiasTemperatura, normalizarVentanaPerfil, nivelGlobal,
  // Criterio ÚNICO de "adelanto/atraso de temporada": lo comparten el perfil de
  // riesgo (web) y `compararGradosDia` (bot de WhatsApp y cron). Antes cada uno
  // tenía el suyo y podían contradecirse sobre el mismo cuartel el mismo día.
  desfaseEnDias, GDD_MINIMO_PARA_DESFASE, TEXTO_SIN_DESFASE, GDD_BASE,
  enTemporadaDeRiego, MES_INICIO_RIEGO, MES_FIN_RIEGO,
  enTemporadaDeAlertaRiego, DIA_INICIO_ALERTA_RIEGO,
  UMBRALES_DEFECTO, NIVELES,
  VENTANA_PERFIL_DEFECTO, VENTANA_PERFIL_MIN, VENTANA_PERFIL_MAX,
};

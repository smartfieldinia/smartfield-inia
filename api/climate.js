// ════════════════════════════════════════════════════════════════════════
// api/climate.js — riesgo climático por campo, sobre la API INIA v1.0.
//   GET   /api/climate?field_id=<id>[&window=2][&as=]  → ClimateDashboardSnapshot
//   GET   /api/climate?stations=1&field_id=<id>[&as=]  → estaciones sugeridas
//
// Las tres operaciones viven en UN endpoint a propósito: el plan Hobby de
// Vercel tope a 12 funciones serverless y el proyecto ya está en el límite
// (mismo motivo por el que la analítica es una rama de fields.js, no un
// endpoint aparte).
//
// La key de la API INIA nunca sale de acá: el navegador habla con este
// endpoint, no con INIA (NFR-SEC-01, AC-10).
// ════════════════════════════════════════════════════════════════════════

const { requireAuth } = require('./_auth');
const { resolveActingUser } = require('./_authz');
const { sbSelect } = require('./_supabase');
const { centroidOf } = require('./_geocoding');
const {
  getHealth, getSeries, getStation, getAccumulation,
  estacionesCercanas, elegirEstacion,
  distanciaKm, BoletinError, RADIO_SUGERENCIA_KM, flushSnapshots, resumenMetricas,
} = require('./_boletin');
const {
  balanceHidrico, ultimoDiaCerrado, normalizarVentana, margenConsulta, sumarDias,
  ventanaDias, VENTANA_MIN, VENTANA_MAX, VENTANA_DEFECTO, RULE_VERSION,
  perfilHelada, perfilCalor, perfilAcumulacionTermica, perfilTermicaDeTemporada, tendenciaTemperatura,
  ventanaDiasTemperatura, normalizarVentanaPerfil, nivelGlobal,
  UMBRALES_DEFECTO, VENTANA_PERFIL_MIN, VENTANA_PERFIL_MAX,
} = require('./_riesgo');
const {
  seriesParaBalance, seriesParaPerfil, ultimoDiaCerradoRespaldo, FUENTE_RESPALDO,
} = require('./_respaldo-clima');
// La elección de estación y el criterio de "dato demasiado viejo" se COMPARTEN
// con api/fields.js: viven en _clima-cuartel.js, no duplicados acá.
const {
  resolverEstacion, verificarAtraso, diasEntre, FALLAS_DE_INFRAESTRUCTURA,
} = require('./_clima-cuartel');
// Pronóstico a 5 días: mismos umbrales por cultivo que el cron de alertas.
const { getRiesgoProximosDias, HORIZONTE_RIESGO_DIAS } = require('./_sensors');
const { resumenFrio } = require('./_agroclim');
const { agroclimDeCampo } = require('./fields');
const { getUmbrales } = require('./_umbrales');

// Presupuesto de la invocación. `maxDuration` son 30 s; se corta en 24 para que
// el error viaje como respuesta JSON en vez de un 504 mudo de la plataforma.
const PRESUPUESTO_MS = 24000;

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const caller = await requireAuth(req, res);
  if (!caller) return;
  const targetId = await resolveActingUser(req, res, caller.id);
  if (!targetId) return;

  const url = new URL(req.url, 'http://x');
  const fieldId = url.searchParams.get('field_id');
  if (!fieldId) return res.status(400).json({ error: 'Falta field_id' });

  const deadline = Date.now() + PRESUPUESTO_MS;

  try {
    const campo = await cargarCampo(fieldId, targetId);
    if (!campo) return res.status(404).json({ error: 'Campo no encontrado' });

    // El `await` de cada rama no es decorativo: sin él las promesas rechazadas
    // escapan de este try/catch, `responderError()` no se ejecuta nunca y la
    // function muere sin responder — con la API INIA caída el navegador se
    // quedaba esperando. Verificado en la auditoría del 30-07 (defecto C1).
    if (req.method !== 'GET')    return res.status(405).json({ error: 'Método no permitido' });
    if (url.searchParams.get('stations') === '1') return await handleStations(res, campo, deadline);

    // Pronóstico a 5 días. Es una RAMA y no una función nueva: el plan Hobby
    // topa en 12 funciones serverless y el proyecto está al límite.
    //
    // La API del INIA no publica pronóstico —solo lo observado hasta ayer—, así
    // que este dato sale de Open-Meteo y no hay alternativa. Lo que sí cambia es
    // que ya no se pide desde el navegador con umbrales escritos a mano: se
    // resuelve acá, con los MISMOS umbrales por cultivo que usa el cron de
    // alertas. Antes el front tenía su propio 2 °C fijo y el cron leía
    // `alert_rules`: coincidían solo porque esa tabla está vacía.
    if (url.searchParams.get('pronostico') === '1') {
      return await handlePronostico(res, campo, targetId);
    }

    const excedidoPerfil = url.searchParams.get('perfil') === '1' || url.searchParams.get('tendencia') === '1';
    if (excedidoPerfil) {
      const excedido = excedeLimite(caller.id);
      if (excedido) return responder429(res, excedido);
      if (url.searchParams.get('perfil') === '1') {
        return await handlePerfil(res, campo, url.searchParams.get('dias'), deadline);
      }
      return await handleTendencia(res, campo, url.searchParams.get('dias'), deadline);
    }

    const excedido = excedeLimite(caller.id);
    if (excedido) return responder429(res, excedido);
    return await handleSnapshot(res, campo, url.searchParams.get('window'), deadline);
  } catch (err) {
    return responderError(res, err, 'climate');
  } finally {
    // Cierra las escrituras del respaldo persistente sin bloquear la respuesta.
    await flushSnapshots().catch(() => {});
    // Observabilidad del consumo de la cuota de INIA (P4). Línea única y
    // parseable en los logs de Vercel: cuántas llamadas costó esta invocación,
    // cuánto absorbió la caché, si hubo 429 y si se sirvió un dato viejo.
    // Nunca incluye la key ni datos del usuario.
    console.log('[boletin] uso', JSON.stringify(resumenMetricas()));
  }
};

// ── Límite propio de consumo (C5) ───────────────────────────────────────
//
// La cuota de 300 req/min de INIA es de la plataforma entera, no por usuario, y
// un snapshot frío gasta hasta 8 llamadas: sin freno, ~37 snapshots/min agotan
// la cuota para todos. Este límite es por instancia (no hay Redis en el
// proyecto), así que no es un control global exacto — es un tope de cortesía
// que evita que un solo navegador en bucle consuma la cuota común. El respaldo
// real es la caché: repetir la misma consulta dentro de 5 min no llega a INIA.
const LIMITE_POR_MINUTO = 20;
const consumo = new Map();   // user_id → [timestamps]

function responder429(res, segundos) {
  res.setHeader('Retry-After', segundos);
  return res.status(429).json({
    error: 'Demasiadas consultas de riesgo climático seguidas. Intenta de nuevo en un momento.',
    code: 'rate_limited_local',
  });
}

function excedeLimite(userId) {
  const ahora = Date.now();
  const previos = (consumo.get(userId) || []).filter(t => ahora - t < 60000);
  if (previos.length >= LIMITE_POR_MINUTO) {
    const masViejo = previos[0];
    return Math.max(1, Math.ceil((60000 - (ahora - masViejo)) / 1000));
  }
  previos.push(ahora);
  consumo.set(userId, previos);
  // El Map no crece sin control: se limpian los usuarios sin actividad reciente.
  if (consumo.size > 200) {
    for (const [id, marcas] of consumo) {
      if (!marcas.some(t => ahora - t < 60000)) consumo.delete(id);
    }
  }
  return null;
}

// Guardia de propiedad: solo campos del usuario (o del productor bajo ?as=).
// `select: '*'` a propósito y no una lista de columnas: `estacion_id` la agrega
// la migración v7 y con `select` explícito este endpoint se caería con 400 en
// cualquier deploy anterior a aplicarla. Con `*`, si la columna todavía no
// existe simplemente llega `undefined` y se cae a la estación por proximidad.
async function cargarCampo(fieldId, userId) {
  const filas = await sbSelect('user_fields', {
    select: '*', id: `eq.${fieldId}`, user_id: `eq.${userId}`, limit: 1,
  });
  return filas[0] || null;
}

// ── GET ?stations=1 — candidatas para el selector (FR-ST-03) ────────────
async function handleStations(res, campo, deadline) {
  // Mismo criterio de historial que el snapshot, para que el selector marque
  // igual que la tarjeta cuáles sirven para la comparación interanual.
  const health = await getHealth({ deadline }).catch(() => null);
  const ultimoDia = health ? ultimoDiaCerrado(health) : null;
  const historialDesde = ultimoDia ? sumarDias(ultimoDia, -365 - VENTANA_MAX) : null;

  const { centroide, cercanas, estacion } = await resolverEstacion(campo, { historialDesde, deadline });
  if (!centroide) return res.status(400).json({ error: 'El campo no tiene polígono válido' });

  res.json({
    field_id: campo.id,
    // La columna sigue en la base pero ya no gobierna: la estación es siempre
    // la de proximidad (ver `resolverEstacion`). Se informa solo para diagnóstico.
    estacion_id_historica: campo.estacion_id || null,
    // Si /health no respondió no hay fecha de corte, así que `tiene_historial`
    // sale null para TODAS las estaciones y el selector dejaría de advertir
    // cuáles no sirven para comparar — sin decir que no pudo comprobarlo (C8).
    // Con esta bandera la UI lo dice en vez de callar.
    historial_verificado: Boolean(ultimoDia),
    // Sugerida por cercanía/historial, SIN verificar todavía que publique ETo:
    // eso requiere pedir la serie y solo lo hace el snapshot. Puede no ser la
    // que termine usándose — el `station_id` del snapshot es la fuente de verdad.
    estacion_sugerida: estacion?.id || null,
    radio_sugerencia_km: RADIO_SUGERENCIA_KM,
    estaciones: cercanas.map(s => ({
      id: s.id, nombre: s.name, institucion: s.institution,
      region: s.region, comuna: s.comuna,
      distancia_km: s.distancia_km ?? null,
      fuera_de_radio: (s.distancia_km ?? 0) > RADIO_SUGERENCIA_KM,
      primer_dato: s.first_date || null,
      tiene_historial: s.tiene_historial,
    })),
  });
}

// El PATCH que fijaba la estación a mano (FR-ST-03) se eliminó el 2026-09-13:
// la estación es siempre la de proximidad. Ver `resolverEstacion` en
// `_clima-cuartel.js`. Un PATCH ahora cae en el 405 de más arriba.

// ── GET — el snapshot del dashboard ─────────────────────────────────────
//
// Se intenta con la API del INIA, que es la fuente oficial y la que mide el
// predio de verdad. Si esa cadena se cae entera —el host del contrato v1.0 es
// un devtunnel temporal y su relay lleva días en 429— se arma el mismo balance
// con el reanálisis ERA5 sobre el centroide del cuartel, rotulado como
// respaldo. Antes ese caso terminaba en una tarjeta con un error rojo y sin un
// solo número, aun cuando el dato de fondo (lluvia y demanda atmosférica) no
// depende de que el túnel de INIA esté arriba.
// ── Caché de una respuesta que no cambia en todo el día (2026-08-14) ─────
//
// El perfil y el balance se calculan sobre una ventana que TERMINA AYER, así que
// para el mismo cuartel y la misma ventana el resultado es idéntico hasta la
// próxima medianoche. Se le ponía `max-age=300`: cinco minutos sobre un dato
// diario, y por eso cada ida y vuelta entre 15/30/60 días volvía a pegarle al
// servidor. `stale-while-revalidate` deja que el navegador pinte al instante lo
// último que tenga mientras refresca por detrás.
function cacheHastaFinDelDia() {
  const ahora = Date.now();
  const finDelDiaUTC = Date.UTC(
    new Date(ahora).getUTCFullYear(), new Date(ahora).getUTCMonth(), new Date(ahora).getUTCDate() + 1);
  const segundos = Math.max(300, Math.floor((finDelDiaUTC - ahora) / 1000));
  return `private, max-age=${segundos}, stale-while-revalidate=86400`;
}

// AbortSignal que respeta lo que queda del presupuesto de la invocación.
// El margen es el mismo que reserva `_boletin.js` para alcanzar a responder.
const MARGEN_RESPUESTA_RESPALDO_MS = 1500;
function señalConDeadline(deadline) {
  if (!deadline) return undefined;
  const restante = deadline - Date.now() - MARGEN_RESPUESTA_RESPALDO_MS;
  return AbortSignal.timeout(Math.max(1000, restante));
}

// ── GET ?pronostico=1 — helada y golpe de calor a 5 días ────────────────
//
// Único dato del dashboard que NO puede venir de INIA: su contrato v1.0 publica
// observado hasta `last_date − 1`, no pronóstico. Se rotula como tal.
async function handlePronostico(res, campo, userId) {
  const centroide = centroidOf(campo.polygon_coords);
  if (!centroide) return res.status(400).json({ error: 'El campo no tiene polígono válido' });

  // La región del productor: `alert_rules` puede tener umbrales por cultivo Y
  // zona, y es el mismo criterio que aplica el cron.
  let zona = null;
  try {
    const [perfil] = await sbSelect('users_profile', { select: 'region', id: `eq.${userId}`, limit: 1 });
    zona = perfil?.region || null;
  } catch (_) { /* sin región: umbrales por cultivo a secas */ }

  const umbral = await getUmbrales(campo.cultivo, zona);
  const riesgo = await getRiesgoProximosDias({
    lat: centroide.lat, lon: centroide.lon,
    dias: HORIZONTE_RIESGO_DIAS,
    heladaC: umbral.helada, calorC: umbral.calor,
  });

  // El pronóstico se corrige varias veces al día: cachear más que unos minutos
  // haría que la pantalla mostrara una corrida vieja del modelo.
  res.setHeader('Cache-Control', 'private, max-age=900');
  return res.json({
    ...riesgo,
    field_id: campo.id,
    cultivo: campo.cultivo || null,
    umbral_helada_c: umbral.helada,
    umbral_calor_c: umbral.calor,
    umbrales_origen: umbral.origen,
    fuente: 'Open-Meteo',
    // Para que la tarjeta pueda explicar por qué esto no es INIA.
    nota_fuente: 'La red de estaciones del INIA publica lo observado, no pronóstico.',
  });
}

async function handleSnapshot(res, campo, ventanaPedida, deadline) {
  const ventana = normalizarVentana(ventanaPedida);
  try {
    const snapshot = await snapshotDesdeINIA(campo, ventana, deadline);
    // Mismo TTL que la caché de series del cliente INIA: dentro de esos 5
    // minutos la respuesta no puede cambiar, así que un refresco del dashboard
    // no vuelve a gastar cuota de la API (C5). `private` porque el snapshot es
    // del campo de un usuario y viaja tras autenticación.
    res.setHeader('Cache-Control', cacheHastaFinDelDia());
    return res.json(snapshot);
  } catch (err) {
    const infra = err instanceof BoletinError && FALLAS_DE_INFRAESTRUCTURA.includes(err.code);
    if (!infra) throw err;

    const respaldo = await snapshotDeRespaldo(campo, ventana, err, deadline).catch(() => null);

    if (!respaldo) {
      // Un campo sin polígono no es una falla del servicio y no se arregla
      // reintentando: se dice qué falta, como antes de existir el respaldo.
      if (!campo.polygon_coords) {
        return res.status(422).json({
          error: 'No se pudo asociar una estación meteorológica a este campo',
          detalle: 'el campo no tiene polígono',
        });
      }
      // Sin respaldo (Open-Meteo caído, o ni él cubrió la ventana) se propaga
      // el error original: es la única forma honesta de no mostrar nada.
      throw err;
    }

    console.warn(`[climate] snapshot de respaldo ERA5 para el campo ${campo.id} (INIA: ${err.code})`);
    res.setHeader('Cache-Control', cacheHastaFinDelDia());
    return res.json(respaldo);
  }
}

// Balance hídrico con la misma regla de negocio, calculado sobre el reanálisis
// ERA5 en el centroide del cuartel. Devuelve null si no hay con qué.
async function snapshotDeRespaldo(campo, ventana, errorInia, deadline = null) {
  const centroide = centroidOf(campo.polygon_coords);
  if (!centroide) return null;

  const ultimoDia = ultimoDiaCerradoRespaldo();
  const { actual, previa } = await seriesParaBalance({
    lat: centroide.lat, lon: centroide.lon, ultimoDia, margen: margenConsulta(ventana),
    signal: señalConDeadline(deadline),
  });

  const balance = balanceHidrico({ serieActual: actual, seriePrevia: previa, ventana, ultimoDia });
  if (balance.deficit_mm == null) return null;   // ni el respaldo cubrió la ventana

  return {
    field_id: campo.id,
    field_nombre: campo.nombre,
    // No hay estación: el dato es del punto del cuartel. Se nombra así de
    // explícito para que nadie lea "estación" donde hay un modelo.
    station_id: null,
    station_name: 'Reanálisis sobre el cuartel',
    station_institution: 'ECMWF ERA5 vía Open-Meteo',
    station_region: null,
    station_comuna: null,
    station_distancia_km: null,
    station_origen: 'respaldo',
    station_fuera_de_radio: false,
    station_tiene_historial: true,
    station_descartadas: [],
    ...balance,
    ventana_min: VENTANA_MIN,
    ventana_max: VENTANA_MAX,
    rule_version: RULE_VERSION,
    data_updated_at: new Date().toISOString(),
    last_date_disponible: ultimoDia,
    ultimo_dia_cerrado: ultimoDia,
    stale: false,
    // Los dos campos que la tarjeta usa para rotular de dónde salió el número.
    es_respaldo: true,
    respaldo_motivo: errorInia?.code || 'sin_respuesta',
    fuente: FUENTE_RESPALDO,
  };
}

async function snapshotDesdeINIA(campo, ventana, deadline) {

  // El health va primero: de su `last_date` sale el día de corte, y de ahí la
  // fecha que una estación debe cubrir para permitir la comparación interanual.
  const health = await getHealth({ deadline });
  const ultimoDia = ultimoDiaCerrado(health);
  if (!ultimoDia) throw new BoletinError('La API INIA no informó la última fecha disponible', { code: 'no_last_date' });
  verificarAtraso(ultimoDia);
  const historialDesde = sumarDias(ultimoDia, -365 - ventana);

  const { estacion, origen, cercanas } = await resolverEstacion(campo, { historialDesde, deadline });
  if (!estacion) {
    // 'no_data' y no un 422 directo: sin estación tampoco hay nada que mostrar,
    // y el respaldo ERA5 sí puede resolverlo (no necesita catálogo).
    throw new BoletinError(
      campo.polygon_coords ? 'Sin estaciones en el catálogo para este campo' : 'El campo no tiene polígono',
      { code: 'no_data' },
    );
  }

  // La elegida por proximidad primero, y las otras cercanas de reserva por si
  // esa no tiene datos en la ventana pedida (ver `buscarEstacionConDatos`).
  const candidatas = ordenarCandidatas(estacion, cercanas);
  const elegida = await buscarEstacionConDatos(candidatas, { ultimoDia, ventana, deadline });

  const usada = elegida.estacion;
  const balance = balanceHidrico({
    serieActual: elegida.actual.data,
    seriePrevia: elegida.previa.data,
    ventana,
    ultimoDia,
  });

  const desactualizado = Boolean(elegida.actual.stale || health.stale);
  const actual = elegida.actual;

  return {
    field_id: campo.id,
    field_nombre: campo.nombre,
    station_id: usada.id,
    station_name: usada.name,
    station_institution: usada.institution,
    station_region: usada.region,
    station_comuna: usada.comuna,
    station_distancia_km: usada.distancia_km ?? null,
    station_origen: origen,                              // 'proximidad' (ya no hay elección manual)
    station_fuera_de_radio: (usada.distancia_km ?? 0) > RADIO_SUGERENCIA_KM,
    // false = la estación es demasiado nueva para comparar contra el año
    // anterior; la tarjeta muestra el balance sin variación interanual.
    station_tiene_historial: usada.tiene_historial,
    // Estaciones más cercanas que se descartaron y por qué (auditoría: el
    // administrador INIA debe poder ver de dónde salió cada dato — §5).
    station_descartadas: elegida.descartadas,
    ...balance,
    ventana_min: VENTANA_MIN,
    ventana_max: VENTANA_MAX,
    rule_version: RULE_VERSION,
    data_updated_at: new Date(actual.obtenidoEn || Date.now()).toISOString(),
    last_date_disponible: health.data?.meteo?.last_date || null,
    ultimo_dia_cerrado: ultimoDia,
    stale: desactualizado,
    es_respaldo: false,
    fuente: 'INIA Chile — Boletín Agroclimático',        // NFR-COMP-01: atribución visible
  };
}

// ── GET ?perfil=1 — perfil de riesgo del cuartel (P2) ───────────────────
//
// Helada, ola de calor, estrés hídrico y frío acumulado, sobre una ventana
// propia (30 días por defecto): la ventana de 1-5 días del balance hídrico no
// dice nada sobre riesgo de helada.
//
// NO incluye presión de enfermedades: la API v1.0 no la publica y estimarla a
// partir de humedad y temperatura sería inventar un modelo fitopatológico que
// nadie validó. Es la decisión #5 del §18 del PRD.
async function handlePerfil(res, campo, diasPedidos, deadline) {
  const dias = normalizarVentanaPerfil(diasPedidos);
  try {
    return await perfilDesdeINIA(res, campo, dias, deadline);
  } catch (err) {
    const infra = err instanceof BoletinError && FALLAS_DE_INFRAESTRUCTURA.includes(err.code);
    if (!infra) throw err;

    // `deadline` va al respaldo: era el único camino de red que quedaba FUERA
    // del presupuesto, y por ahí la invocación podía pasarse de `maxDuration` y
    // devolver un 504 sin JSON — exactamente el fallo que PRESUPUESTO_MS existe
    // para evitar.
    const respaldo = await perfilDeRespaldo(campo, dias, err, deadline).catch(() => null);
    if (!respaldo) throw err;

    console.warn(`[climate] perfil de respaldo ERA5 para el campo ${campo.id} (INIA: ${err.code})`);
    res.setHeader('Cache-Control', cacheHastaFinDelDia());
    return res.json(respaldo);
  }
}

// Perfil de riesgo sobre el reanálisis. Helada y acumulación térmica salen
// completas —una es la definición del INIA aplicada a la mínima diaria, la otra
// se calcula de tmin/tmax—; el riesgo de calor NO, porque su definición depende
// del percentil 90 climatológico de la estación. Se devuelve como 'sin_dato' en
// vez de 'bajo': no evaluarlo no es lo mismo que descartarlo.
// La fila "Acumulación térmica" mide la TEMPORADA, con la misma comparación
// que el gráfico de grados-día (decisión del usuario, 2026-09-24: antes era la
// ventana móvil del perfil y las dos tarjetas podían contradecirse). null si el
// cómputo no llega a tiempo: ahí se queda la lectura de la ventana, que es
// mejor que una fila vacía.
async function termicaDeTemporada(campo, deadline) {
  const restante = deadline ? deadline - Date.now() - 1500 : 15000;
  if (restante < 2500) return null;
  const agro = await agroclimDeCampo(campo, { presupuestoMs: restante }).catch(() => null);
  if (!agro || !agro.comparacionTemporada || !agro.gdd) return null;
  return perfilTermicaDeTemporada(agro.comparacionTemporada, agro.gdd);
}

async function perfilDeRespaldo(campo, dias, errorInia, deadline = null) {
  const centroide = centroidOf(campo.polygon_coords);
  if (!centroide) return null;

  const ultimoDia = ultimoDiaCerradoRespaldo();
  // Se descarga SIEMPRE la ventana máxima y se recorta en memoria. Medido: 15 y
  // 60 días pesan 944 y 2.405 bytes y tardan lo mismo (el costo es el handshake
  // TLS, no el volumen), así que pedir de a poco solo servía para que cada clic
  // en 15/30/60 gastara un round-trip nuevo. Con esto, las tres ventanas salen
  // de una sola descarga y del caché.
  const { actual, previa } = await seriesParaPerfil({
    lat: centroide.lat, lon: centroide.lon, ultimoDia,
    dias: VENTANA_PERFIL_MAX,
    signal: señalConDeadline(deadline),
  });

  const diasTemp = ventanaDiasTemperatura(actual, dias, ultimoDia);
  if (!diasTemp.length) return null;
  const diasTempPrevios = ventanaDiasTemperatura(previa, dias, sumarDias(ultimoDia, -365));

  const helada  = perfilHelada(diasTemp, { acumulado: null });
  const termica = await termicaDeTemporada(campo, deadline)
    || perfilAcumulacionTermica(diasTemp, diasTempPrevios, { acumulado: null });
  const calor   = {
    nivel: 'sin_dato',
    episodios: [],
    dias_evaluados: diasTemp.length,
    detalle: 'La ola de calor se define contra el percentil 90 climatológico de la estación; '
           + 'sin la red del INIA disponible no se puede evaluar.',
  };

  return {
    field_id: campo.id,
    field_nombre: campo.nombre,
    station_id: null,
    station_name: 'Reanálisis sobre el cuartel',
    station_institution: 'ECMWF ERA5 vía Open-Meteo',
    station_distancia_km: null,
    station_origen: 'respaldo',
    period_from: diasTemp[0]?.date || null,
    period_to: diasTemp[diasTemp.length - 1]?.date || null,
    dias_pedidos: dias,
    dias_evaluados: diasTemp.length,
    nivel_global: nivelGlobal([helada.nivel, termica.nivel]),
    riesgos: { helada, calor, acumulacion_termica: termica },
    // Horas frío: la API del INIA las publica acumuladas por temporada; no se
    // reconstruyen desde el reanálisis diario, así que se dicen ausentes.
    frio_acumulado: null,
    umbrales: UMBRALES_DEFECTO,
    umbrales_origen: 'placeholder',
    umbrales_nota: 'Cortes provisionales, sin etapa fenológica. Pendientes de definir con INIA (§18.1 del PRD).',
    rule_version: RULE_VERSION,
    stale: false,
    es_respaldo: true,
    respaldo_motivo: errorInia?.code || 'sin_respuesta',
    fuente: FUENTE_RESPALDO,
  };
}

async function perfilDesdeINIA(res, campo, dias, deadline) {
  const health = await getHealth({ deadline });
  const ultimoDia = ultimoDiaCerrado(health);
  if (!ultimoDia) throw new BoletinError('La API INIA no informó la última fecha disponible', { code: 'no_last_date' });
  verificarAtraso(ultimoDia);

  const { estacion, origen, centroide } = await resolverEstacion(campo, {
    historialDesde: sumarDias(ultimoDia, -365 - VENTANA_MAX), deadline,
  });
  if (!estacion) return res.status(422).json({ error: 'No se pudo asociar una estación meteorológica a este campo' });

  const desde = sumarDias(ultimoDia, -(dias - 1));
  // En paralelo con las series del perfil: es otro cómputo y no depende de ellas.
  const termicaTemporadaP = termicaDeTemporada(campo, deadline);
  // Las tres acumulaciones son best-effort: una estación nueva no tiene
  // temporadas completas y la API devuelve `reference: null`. Eso no invalida
  // el perfil — solo se pierde el "¿es normal para el año?".
  const [serie, seriePrevia, accHeladas, accOlas, accFrio, accGdd] = await Promise.all([
    getSeries(estacion.id, desde, ultimoDia, { deadline }),
    // La serie del año anterior sostiene la comparación interanual del perfil
    // (OBJ-03): hoy, el desfase de acumulación térmica.
    getSeries(estacion.id, sumarDias(desde, -365), sumarDias(ultimoDia, -365), { deadline })
      .catch(() => ({ data: [], stale: false })),
    getAccumulation(estacion.id, 'heladas', null, { deadline }).catch(() => null),
    getAccumulation(estacion.id, 'olas', null, { deadline }).catch(() => null),
    // Horas frío reales, no porciones Fisher: es la unidad en la que están
    // escritos los requerimientos por especie/variedad (Stanley, 2026-08-05).
    // Desde el 2026-09-24 NO sale de `/accumulation`: esa acumula la temporada
    // anual de la red (1-may → hoy) y su media es de temporadas may→abr, así
    // que esta tarjeta decía 1.047 h mientras el gráfico de abajo terminaba en
    // 674. `resumenFrio` usa la misma serie diaria y la misma ventana que el
    // gráfico, el bot y el cron (ver `_agroclim.js`).
    resumenFrio({ estacion, lat: centroide.lat, lon: centroide.lon, hasta: ultimoDia, deadline }).catch(() => null),
    getAccumulation(estacion.id, 'gdd', null, { deadline }).catch(() => null),
  ]);

  const diasTemp = ventanaDiasTemperatura(serie.data, dias, ultimoDia);
  // Mismo tramo de la temporada anterior, día por día: es contra esto que se
  // mide el desfase térmico.
  const diasTempPrevios = ventanaDiasTemperatura(seriePrevia.data, dias, sumarDias(ultimoDia, -365));

  const helada  = perfilHelada(diasTemp, { acumulado: accHeladas });
  const calor   = perfilCalor(diasTemp, { acumulado: accOlas });
  // Reemplaza al estrés hídrico, que ya tiene su propia tarjeta con más
  // detalle arriba (ver el comentario de perfilAcumulacionTermica).
  const termica = (await termicaTemporadaP)
    || perfilAcumulacionTermica(diasTemp, diasTempPrevios, { acumulado: accGdd });
  // Una sola línea: `setHeader` reemplaza, y hasta el 2026-08-27 había debajo un
  // `private, max-age=300` —el original de cuando nació el perfil— que pisaba
  // este en silencio. El perfil es histórico (día cerrado), así que se cachea
  // hasta el fin del día, igual que las otras tres ramas de este archivo.
  res.setHeader('Cache-Control', cacheHastaFinDelDia());
  res.json({
    field_id: campo.id,
    field_nombre: campo.nombre,
    station_id: estacion.id,
    station_name: estacion.name,
    station_institution: estacion.institution,
    station_distancia_km: estacion.distancia_km ?? null,
    station_origen: origen,
    period_from: diasTemp[0]?.date || null,
    period_to: diasTemp[diasTemp.length - 1]?.date || null,
    dias_pedidos: dias,
    dias_evaluados: diasTemp.length,
    nivel_global: nivelGlobal([helada.nivel, calor.nivel, termica.nivel]),
    riesgos: { helada, calor, acumulacion_termica: termica },
    // Horas frío acumuladas: no es un riesgo agudo, es un indicador de
    // temporada para frutales (variable `chill` de la API INIA). Va aparte.
    frio_acumulado: accFrio,
    // La UI TIENE que mostrar que estos cortes no están validados por INIA.
    umbrales: UMBRALES_DEFECTO,
    umbrales_origen: 'placeholder',
    umbrales_nota: 'Cortes provisionales, sin etapa fenológica. Pendientes de definir con INIA (§18.1 del PRD).',
    rule_version: RULE_VERSION,
    ventana_min: VENTANA_PERFIL_MIN,
    ventana_max: VENTANA_PERFIL_MAX,
    ultimo_dia_cerrado: ultimoDia,
    stale: Boolean(serie.stale || health.stale),
    fuente: 'INIA Chile — Boletín Agroclimático',
  });
}

// ── GET ?tendencia=1 — temperatura vs. el histórico de la estación (P2) ──
//
// Dos referencias distintas, rotuladas por separado a propósito:
//   · la BANDA p10–p90 sale de las temporadas anteriores de ESTA estación;
//   · la NORMAL es CR2 1991–2020, que la API entrega en /stations/{id}.
// Mezclarlas daría un número sin significado — es la confusión que el plan de
// P2 advertía explícitamente.
const MAX_TEMPORADAS_BANDA = 11;

async function handleTendencia(res, campo, diasPedidos, deadline) {
  const dias = normalizarVentanaPerfil(diasPedidos);

  const health = await getHealth({ deadline });
  const ultimoDia = ultimoDiaCerrado(health);
  if (!ultimoDia) throw new BoletinError('La API INIA no informó la última fecha disponible', { code: 'no_last_date' });

  const { estacion, origen } = await resolverEstacion(campo, { deadline });
  if (!estacion) return res.status(422).json({ error: 'No se pudo asociar una estación meteorológica a este campo' });

  const desde = sumarDias(ultimoDia, -(dias - 1));

  // Cuántas temporadas hacia atrás tiene sentido pedir: las que la estación
  // realmente cubre. Quilamapu registra desde 2025-10 — pedirle 11 años sería
  // gastar 11 llamadas para recibir 11 vacíos.
  const detalle = await getStation(estacion.id, { deadline }).catch(() => null);
  const primerDato = detalle?.data?.data?.first_date || estacion.first_date || null;
  const anioActual = Number(ultimoDia.slice(0, 4));
  const anioPrimero = primerDato ? Number(primerDato.slice(0, 4)) : anioActual;
  const disponibles = Math.max(0, Math.min(MAX_TEMPORADAS_BANDA, anioActual - anioPrimero));

  const previas = await Promise.all(
    Array.from({ length: disponibles }, (_, i) => i + 1).map(async atras => {
      const d = sumarDias(desde, -365 * atras);
      const h = sumarDias(ultimoDia, -365 * atras);
      const s = await getSeries(estacion.id, d, h, { deadline }).catch(() => null);
      return s ? { temporada: anioActual - atras, dias: ventanaDiasTemperatura(s.data, dias, h) } : null;
    })
  );

  const serieActual = await getSeries(estacion.id, desde, ultimoDia, { deadline });
  const diasActuales = ventanaDiasTemperatura(serieActual.data, dias, ultimoDia);

  // Normal CR2 del mes en que termina la ventana.
  const mes = String(Number(ultimoDia.slice(5, 7)));
  const normalMes = detalle?.data?.normals_monthly?.[mes]?.tmean ?? null;

  const tendencia = tendenciaTemperatura({
    diasActuales,
    seriesPrevias: previas.filter(Boolean),
    normalMes,
  });

  res.setHeader('Cache-Control', 'private, max-age=300');
  res.json({
    field_id: campo.id,
    field_nombre: campo.nombre,
    station_id: estacion.id,
    station_name: estacion.name,
    station_distancia_km: estacion.distancia_km ?? null,
    station_origen: origen,
    station_primer_dato: primerDato,
    period_from: diasActuales[0]?.date || null,
    period_to: diasActuales[diasActuales.length - 1]?.date || null,
    dias_pedidos: dias,
    ...tendencia,
    rule_version: RULE_VERSION,
    ultimo_dia_cerrado: ultimoDia,
    stale: Boolean(serieActual.stale || health.stale),
    fuente: 'INIA Chile — Boletín Agroclimático',
  });
}

// Cuántas estaciones se prueban antes de rendirse. Cada una son 2 consultas de
// serie (año actual + anterior), cacheadas 5 min; con 300 req/min de límite el
// costo es despreciable, pero igual se acota para no barrer el catálogo.
const MAX_CANDIDATAS_EVALUADAS = 3;

// Orden en que se prueban: primero la sugerida por elegirEstacion() (que ya
// resolvió el trade-off distancia/historial), después el resto por distancia.
// Este orden solo decide a quién se le pide la serie para ver si tiene ETo; el
// criterio de preferencia vive en elegirEstacion().
function ordenarCandidatas(sugerida, cercanas) {
  const resto = cercanas.filter(s => s.id !== sugerida.id);
  return [sugerida, ...resto].slice(0, MAX_CANDIDATAS_EVALUADAS);
}

// Primera candidata que efectivamente sirve para calcular el balance.
//
// El catálogo no dice si una estación publica ETo, y sin ETo no hay balance
// hídrico posible. No es un detalle teórico: DMC-360011 (Aeródromo de Chillán,
// serie desde 2018) no registra radiación, así que su `eto` viene null todos los
// días y `meta.eto_days` es 0 — pasaría el filtro de historial y daría una
// tarjeta vacía. La única forma de saberlo es pedir la serie y mirarla, así que
// se prueban las candidatas en orden y se usa la primera con cobertura completa.
//
// Si ninguna la tiene, se devuelve la primera igual: el balance sale con
// `completeness.suficiente: false` y la tarjeta muestra "datos insuficientes"
// con la cobertura encontrada (§13), que es el comportamiento que pide el PRD.
async function buscarEstacionConDatos(candidatas, { ultimoDia, ventana, deadline = null }) {
  const margen = margenConsulta(ventana);
  const desde  = sumarDias(ultimoDia, -(margen - 1));
  const desdePrevio = sumarDias(desde, -365);
  const hastaPrevio = sumarDias(ultimoDia, -365);
  const descartadas = [];
  let primera = null;
  let ultimoError = null;

  for (const candidata of candidatas) {
    // La serie del año anterior es best-effort: si la estación es nueva, la API
    // responde 404/no_data y el balance sale sin comparación en vez de fallar.
    const [actual, previa] = await Promise.all([
      // El `.catch(() => null)` de antes borraba la causa: un 429 o un timeout
      // quedaban anotados como 'sin_serie', y el artefacto de auditoría culpaba
      // a la estación de un problema que era nuestro (C7). Ahora se conserva.
      getSeries(candidata.id, desde, ultimoDia, { deadline }).catch(err => { ultimoError = err; return null; }),
      getSeries(candidata.id, desdePrevio, hastaPrevio, { deadline }).catch(() => ({ data: [], stale: false })),
    ]);

    if (!actual) {
      descartadas.push({
        id: candidata.id,
        distancia_km: candidata.distancia_km,
        motivo: 'sin_serie',
        // 'rate_limited' | 'unreachable' | 'presupuesto_agotado' | 'no_data'…
        causa: ultimoError?.code || null,
        // Un fallo nuestro no dice nada sobre la estación: la auditoría tiene
        // que poder distinguirlo de una estación que realmente no publica.
        atribuible_a_estacion: !['rate_limited', 'unreachable', 'presupuesto_agotado'].includes(ultimoError?.code),
      });
      // Sin tiempo no tiene sentido seguir probando candidatas: cada una son dos
      // llamadas más y todas fallarían igual.
      if (ultimoError?.code === 'presupuesto_agotado') break;
      continue;
    }

    const resultado = { estacion: candidata, actual, previa, descartadas };
    if (!primera) primera = resultado;

    const dias = ventanaDias(actual.data, ventana, ultimoDia);
    if (dias.length >= ventana) return resultado;

    descartadas.push({
      id: candidata.id,
      distancia_km: candidata.distancia_km,
      // El motivo real casi siempre es ETo: precipitación la publican todas.
      motivo: (actual.meta?.eto_days === 0) ? 'sin_eto' : 'cobertura_insuficiente',
      dias_completos: dias.length,
    });
  }

  if (!primera) {
    // Si ninguna respondió por un problema de infraestructura (429, red caída,
    // presupuesto), se propaga ESE error: `responderError` lo traduce a 429/502
    // con su código. Decir 'no_data' escondería la causa real (C7).
    if (['rate_limited', 'unreachable', 'presupuesto_agotado'].includes(ultimoError?.code)) throw ultimoError;
    throw new BoletinError('Ninguna estación cercana devolvió serie diaria', { code: 'no_data' });
  }
  // Se usa la primera, pero se saca de la lista de descartadas para no
  // contradecir el snapshot (aparecería como usada y descartada a la vez).
  primera.descartadas = descartadas.filter(d => d.id !== primera.estacion.id);
  return primera;
}

function responderError(res, err, contexto) {
  if (err instanceof BoletinError) {
    // 401 de INIA no es 401 del usuario: es la key del backend. Se traduce a
    // 502 para no hacerle creer al navegador que su sesión venció.
    // 504 cuando se acabó el presupuesto: no es que INIA esté caído, es que
    // tardó más de lo que la function podía esperar. Mensaje distinto para que
    // el usuario sepa que reintentar tiene sentido.
    const status = err.code === 'presupuesto_agotado' ? 504
      : (err.status === 429 ? 429 : (err.status === 404 ? 404 : 502));
    console.error(`[${contexto}] API INIA: ${err.code || 'error'}`);
    const mensajes = {
      404: 'La estación no tiene datos para el período pedido',
      504: 'La API de riesgo climático INIA está tardando demasiado. Intenta de nuevo.',
      429: 'Se alcanzó el límite de consultas a la API INIA. Intenta en un minuto.',
    };
    return res.status(status).json({
      error: mensajes[status] || 'El servicio de riesgo climático INIA no está disponible',
      code: err.code || null,
    });
  }
  console.error(`[${contexto}] error:`, err.message);
  return res.status(500).json({ error: 'Error al calcular el riesgo climático' });
}

module.exports.config = { maxDuration: 30 };

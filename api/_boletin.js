// ════════════════════════════════════════════════════════════════════════
// Cliente de la API de Riesgo Climático INIA ("Boletín Agroclimático" v1.0,
// contrato del 23-07-2026). Serie diaria por estación, catálogo territorial
// y anomalías vs. la normal CR2 1991–2020.
//
// Es solo lectura (todos los endpoints son GET) y la credencial es una key
// personal que va como `Authorization: Bearer`. NFR-SEC-01/02 del PRD: la key
// vive solo en env del backend, nunca se devuelve al cliente ni se escribe en
// logs — de las respuestas solo se loguea el X-Request-Id, que es el dato que
// pide el equipo del Boletín para soporte.
//
// Mismo patrón que el resto de `api/`: fetch nativo, cero dependencias.
// ════════════════════════════════════════════════════════════════════════

// La URL base del contrato v1.0 es un devtunnel TEMPORAL. Por eso es env var y
// no una constante: cuando INIA publique el host definitivo se cambia en Vercel
// sin tocar código ni redesplegar lógica. El default sirve para desarrollo.
const BASE = (process.env.BOLETIN_API_URL || 'https://giant-ant-fvx379q-3000.brs.devtunnels.ms/api/v1').replace(/\/$/, '');
const KEY  = process.env.BOLETIN_API_KEY;

// TTLs alineados con el Cache-Control que declara el servicio (300 s en los
// endpoints de datos) y con la frecuencia real de cambio de cada recurso.
const TTL = {
  health:       5 * 60 * 1000,
  stations:    24 * 60 * 60 * 1000,
  station:     30 * 60 * 1000,
  series:       5 * 60 * 1000,
  accumulation: 45 * 60 * 1000,
  summary:      45 * 60 * 1000,
};

// Timeout de UNA llamada. Antes eran 20 s, que en el peor caso (3 estaciones
// candidatas × 2 series + una espera por 429) sumaban ~75 s contra un
// maxDuration de 30 s: la function moría sin responder y el navegador veía un
// 504 mudo. Con 8 s, el peor caso entra en el presupuesto y, si aun así no
// alcanza, el deadline corta antes con un error explicable.
const TIMEOUT_LLAMADA_MS = 8000;

// Margen que se reserva al final del presupuesto para poder armar y enviar la
// respuesta aunque la última llamada haya consumido todo lo demás.
const MARGEN_RESPUESTA_MS = 1500;

// Tope de entradas de cada caché. La clave de las series incluye las fechas, así
// que cada día genera claves nuevas que ya nunca vuelven a servir: sin tope, una
// instancia caliente acumulaba series indefinidamente (~3,5 MB por 40 series).
// Map preserva el orden de inserción, así que expulsar `keys().next()` es LRU
// siempre que las lecturas reinserten (lo hace `tocar()`).
const MAX_ENTRADAS_CACHE = 40;
const MAX_ENTRADAS_STALE = 20;

class BoletinError extends Error {
  constructor(message, { status = null, code = null, requestId = null } = {}) {
    super(message);
    this.name = 'BoletinError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

// Caché de instancia. Vercel reutiliza instancias calientes, así que esto
// absorbe la mayoría de las lecturas repetidas dentro de una misma ventana.
// `stale` guarda la última respuesta buena INDEFINIDAMENTE (no vence): es el
// "último snapshot válido" que pide NFR-OPS-01 para cuando la API no responde.
const cache = new Map();  // path → { data, expira, obtenidoEn }
const stale = new Map();  // path → { data, obtenidoEn }

function esperar(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Métricas de consumo (P4) ────────────────────────────────────────────
//
// La cuota de INIA (300 req/min) es de la plataforma entera y hasta ahora no se
// medía nada: no había forma de saber cuánto se consume, cuánto absorbe la
// caché ni con qué frecuencia se sirve un dato viejo. Son contadores en
// memoria de instancia —no un sistema de métricas— pero alcanzan para ver la
// tendencia en los logs de Vercel y para decidir si hace falta algo más.
const metricas = {
  llamadas: 0, aciertos_cache: 0, errores: 0,
  rate_limited: 0, reintentos: 0, stale_servido: 0, stale_desde_bd: 0,
  ms_total: 0, ms_max: 0,
};

function anotarLatencia(ms) {
  metricas.ms_total += ms;
  if (ms > metricas.ms_max) metricas.ms_max = ms;
}

// Resumen listo para loguear al cerrar una invocación.
function resumenMetricas() {
  const { llamadas, aciertos_cache, ms_total } = metricas;
  const total = llamadas + aciertos_cache;
  return {
    ...metricas,
    ms_promedio: llamadas ? Math.round(ms_total / llamadas) : 0,
    tasa_cache: total ? Math.round((aciertos_cache / total) * 100) / 100 : 0,
    entradas_cache: cache.size,
  };
}

// Inserta respetando el tope, expulsando la entrada más vieja (C4).
function guardarConTope(mapa, clave, valor, tope) {
  if (mapa.has(clave)) mapa.delete(clave);
  mapa.set(clave, valor);
  while (mapa.size > tope) mapa.delete(mapa.keys().next().value);
}

// Marca una entrada como recién usada, para que el orden del Map sea LRU real
// y no simple FIFO por inserción.
function tocar(mapa, clave, valor) {
  mapa.delete(clave);
  mapa.set(clave, valor);
}

// Cuánto queda del presupuesto de la invocación. Sin deadline, no hay límite
// global y cada llamada se acota sola con TIMEOUT_LLAMADA_MS.
function restante(deadline) {
  return deadline ? deadline - Date.now() : Infinity;
}

// ── Cortacircuitos (2026-08-13) ─────────────────────────────────────────
//
// El host del contrato v1.0 es un devtunnel de Microsoft y su relay empezó a
// devolver 429 de forma sostenida (`x-ms-ratelimit-limit: 0`, retry-after de
// días): no es la cuota de INIA, es el túnel agotado. Con el servicio caído
// así, cada llamada gastaba ~6 s (fetch + 5 s de espera + reintento) y un
// snapshot necesita cuatro o cinco: el presupuesto de 24 s se agotaba antes de
// llegar al respaldo y el usuario veía un error en vez del último dato bueno.
//
// Mientras el circuito está abierto no se toca la red: se falla al instante con
// un error degradable, así `boletinGet` va derecho a la caché o al snapshot
// persistido. Se cierra solo pasado el plazo, así que un servicio que vuelve se
// vuelve a usar sin intervención.
const CIRCUITO_MS = 60 * 1000;
let circuitoHasta = 0;

function abrirCircuito(motivo) {
  if (Date.now() < circuitoHasta) return;
  circuitoHasta = Date.now() + CIRCUITO_MS;
  console.warn(`[boletin] circuito abierto por ${CIRCUITO_MS / 1000}s (${motivo})`);
}

// Segundos que el servicio pide esperar. El relay del devtunnel usa su propia
// cabecera y valores absurdos (cientos de miles de segundos): si lo que pide no
// cabe holgadamente en una invocación, esperar no sirve de nada.
function esperaPedida(res) {
  const crudo = res.headers.get('retry-after') || res.headers.get('x-ms-ratelimit-retry-after');
  const seg = parseInt(crudo, 10);
  return Number.isFinite(seg) ? seg : null;
}

// GET crudo contra el servicio. `intento` es interno (reintento por 429/5xx).
async function pedir(path, { intento = 0, deadline = null } = {}) {
  if (!KEY && !path.startsWith('/health')) {
    throw new BoletinError('BOLETIN_API_KEY no configurada', { code: 'missing_key' });
  }

  if (Date.now() < circuitoHasta) {
    throw new BoletinError('La API INIA no está respondiendo (circuito abierto)', {
      status: 429, code: 'circuito_abierto',
    });
  }

  const queda = restante(deadline);
  if (queda <= MARGEN_RESPUESTA_MS) {
    throw new BoletinError('Se agotó el tiempo disponible para consultar la API INIA', {
      code: 'presupuesto_agotado',
    });
  }

  let res;
  const t0 = Date.now();
  metricas.llamadas++;
  if (intento > 0) metricas.reintentos++;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: KEY ? { Authorization: `Bearer ${KEY}` } : {},
      // El menor entre el timeout por llamada y lo que quede del presupuesto.
      signal: AbortSignal.timeout(Math.min(TIMEOUT_LLAMADA_MS, queda - MARGEN_RESPUESTA_MS)),
    });
    anotarLatencia(Date.now() - t0);
  } catch (err) {
    anotarLatencia(Date.now() - t0);
    metricas.errores++;
    // Red caída, DNS muerto o timeout: el devtunnel temporal hace esto probable.
    abrirCircuito('sin respuesta');
    throw new BoletinError(`No se pudo contactar la API INIA: ${err.message}`, { code: 'unreachable' });
  }

  const requestId = res.headers.get('x-request-id');

  if (res.status === 429) {
    metricas.rate_limited++;
    // Retry-After manda: la doc pide explícitamente NO reintentar en bucle
    // ignorándolo. Un solo reintento, y solo si la espera cabe en el presupuesto
    // — antes se dormían hasta 15 s sin mirar el reloj, que era la mitad del
    // maxDuration entero.
    //
    // Sin cabecera NO se reintenta a ciegas: cuando el 429 viene del relay del
    // devtunnel (cuota agotada, se destraba en días) esos 5 s de cortesía se
    // pagaban en cada una de las llamadas del snapshot y no destrababan nada.
    const seg = esperaPedida(res);
    const espera = seg != null && seg <= 15 ? seg * 1000 : null;
    if (espera && intento === 0 && restante(deadline) > espera + TIMEOUT_LLAMADA_MS + MARGEN_RESPUESTA_MS) {
      await esperar(espera);
      return pedir(path, { intento: intento + 1, deadline });
    }
    abrirCircuito(seg != null ? `429, pide esperar ${seg}s` : '429 sostenido');
    throw new BoletinError('Límite de solicitudes de la API INIA alcanzado', {
      status: 429, code: 'rate_limited', requestId,
    });
  }

  if (res.status >= 500 && intento === 0 && restante(deadline) > 700 + TIMEOUT_LLAMADA_MS + MARGEN_RESPUESTA_MS) {
    await esperar(700);               // backoff corto: 500/503 suelen ser transitorios
    return pedir(path, { intento: intento + 1, deadline });
  }

  if (!res.ok) {
    // El cuerpo de error es { error: { code, message } }. Se propaga el code
    // (invalid_key, station_not_found, no_data...) pero NUNCA la cabecera enviada.
    let code = null, message = `API INIA respondió ${res.status}`;
    try {
      const cuerpo = await res.json();
      code = cuerpo?.error?.code || null;
      if (cuerpo?.error?.message) message = cuerpo.error.message;
    } catch { /* respuesta no-JSON: queda el mensaje genérico */ }
    throw new BoletinError(message, { status: res.status, code, requestId });
  }

  return res.json();
}

// GET con caché + fallback a la última respuesta válida.
// → { data, meta, stale, obtenidoEn }
async function boletinGet(path, ttl, { deadline = null } = {}) {
  const ahora = Date.now();
  const vigente = cache.get(path);
  if (vigente && vigente.expira > ahora) {
    metricas.aciertos_cache++;
    tocar(cache, path, vigente);
    return { ...vigente.data, stale: false, obtenidoEn: vigente.obtenidoEn };
  }

  try {
    const cuerpo = await pedir(path, { deadline });
    const guardado = { data: cuerpo.data, meta: cuerpo.meta || {} };
    guardarConTope(cache, path, { data: guardado, expira: ahora + ttl, obtenidoEn: ahora }, MAX_ENTRADAS_CACHE);
    guardarConTope(stale, path, { data: guardado, obtenidoEn: ahora }, MAX_ENTRADAS_STALE);
    persistirSnapshot(path, guardado, ahora);
    return { ...guardado, stale: false, obtenidoEn: ahora };
  } catch (err) {
    // 4xx de cliente (station_not_found, invalid_range) son errores reales del
    // pedido: servir un snapshot viejo los escondería. Solo se degrada a stale
    // ante caída/límite/5xx, que es lo que NFR-OPS-01 contempla.
    const degradable = !err.status || err.status === 429 || err.status >= 500;
    if (!degradable) {
      if (err.requestId) console.error(`[boletin] ${path} falló (X-Request-Id: ${err.requestId})`);
      throw err;
    }

    const previo = stale.get(path);
    if (previo) {
      metricas.stale_servido++;
      console.warn(`[boletin] sirviendo snapshot stale de ${path} (${err.code || err.message})`);
      return { ...previo.data, stale: true, obtenidoEn: previo.obtenidoEn };
    }

    // Instancia fría: la memoria está vacía justo cuando más falta hace el
    // respaldo. Se busca en Supabase el último snapshot bueno que dejó
    // cualquier instancia anterior (C2 — antes esto no existía y NFR-OPS-01
    // solo se cumplía si la misma instancia ya había servido esa ruta).
    const persistido = await leerSnapshotPersistido(path);
    if (persistido) {
      metricas.stale_servido++;
      metricas.stale_desde_bd++;
      console.warn(`[boletin] snapshot stale desde Supabase para ${path} (${err.code || err.message})`);
      guardarConTope(stale, path, persistido, MAX_ENTRADAS_STALE);
      return { ...persistido.data, stale: true, obtenidoEn: persistido.obtenidoEn };
    }

    if (err.requestId) console.error(`[boletin] ${path} falló (X-Request-Id: ${err.requestId})`);
    throw err;
  }
}

// ── Persistencia del último snapshot válido (NFR-OPS-01) ────────────────
//
// Tabla `boletin_snapshots` (migration_v8). Es un caché de respaldo, no una
// fuente de verdad: si la tabla no existe o Supabase falla, todo sigue
// funcionando con la caché de instancia y se pierde solo la resistencia al
// arranque en frío. Por eso ningún error de acá se propaga.
//
// Las escrituras NO se esperan en línea (encarecerían cada consulta a INIA);
// se acumulan y `flushSnapshots()` las cierra antes de responder.
const escriturasPendientes = [];
let persistenciaRota = false;   // la tabla no existe → no reintentar en esta instancia

function persistirSnapshot(path, guardado, obtenidoEn) {
  if (persistenciaRota) return;
  const { sbUpsert } = require('./_supabase');
  const promesa = sbUpsert('boletin_snapshots', [{
    path,
    payload: guardado,
    obtenido_en: new Date(obtenidoEn).toISOString(),
  }], 'path').catch(err => {
    // 404/42P01 = falta la migración v8. Se anota una vez y se deja de intentar.
    if (/boletin_snapshots/.test(err.message)) {
      persistenciaRota = true;
      console.warn('[boletin] sin tabla boletin_snapshots: el respaldo queda solo en memoria (falta migración v8)');
    } else {
      console.warn(`[boletin] no se pudo persistir el snapshot de ${path}`);
    }
  });
  escriturasPendientes.push(promesa);
}

async function leerSnapshotPersistido(path) {
  if (persistenciaRota) return null;
  try {
    const { sbSelect } = require('./_supabase');
    const filas = await sbSelect('boletin_snapshots', { path: `eq.${path}`, limit: 1 });
    const fila = filas[0];
    if (!fila?.payload) return null;
    return { data: fila.payload, obtenidoEn: new Date(fila.obtenido_en).getTime() };
  } catch (err) {
    if (/boletin_snapshots/.test(err.message)) persistenciaRota = true;
    return null;
  }
}

// Cierra las escrituras pendientes antes de que la function termine. Con
// timeout: persistir el respaldo nunca debe demorar la respuesta al usuario.
// En la práctica ya terminaron mientras corrían las demás llamadas a INIA.
async function flushSnapshots({ timeoutMs = 2000 } = {}) {
  if (!escriturasPendientes.length) return;
  const enCurso = escriturasPendientes.splice(0, escriturasPendientes.length);
  await Promise.race([
    Promise.allSettled(enCurso),
    esperar(timeoutMs),
  ]);
}

// ── Endpoints ───────────────────────────────────────────────────────────

// Todos aceptan `{ deadline }` — el instante (Date.now()+N) en que la function
// tiene que haber terminado. Sin él cada llamada se acota sola, pero la suma no.

// Estado del servicio + hasta qué fecha hay datos. Público (no usa la key).
const getHealth = (opts) => boletinGet('/health', TTL.health, opts);

// Catálogo completo de estaciones (424 al 2026-07). Cambia rarísimo → 24 h.
const getStations = (opts) => boletinGet('/stations', TTL.stations, opts);

// Detalle de una estación: metadata, rango disponible, último dato y normales.
const getStation = (id, opts) => boletinGet(`/stations/${encodeURIComponent(id)}`, TTL.station, opts);

// Serie diaria. `from`/`to` en YYYY-MM-DD; acotar siempre el rango.
const getSeries = (id, from, to, opts) =>
  boletinGet(`/stations/${encodeURIComponent(id)}/series?from=${from}&to=${to}`, TTL.series, opts);

// Acumulado por temporada de una variable acumulable (chill, gdd, precip, eto…),
// con la media/min/max de las temporadas completas en meta.reference.
function getAccumulation(id, variable, startMonth, opts) {
  const qs = startMonth ? `?variable=${variable}&start_month=${startMonth}` : `?variable=${variable}`;
  return boletinGet(`/stations/${encodeURIComponent(id)}/accumulation${qs}`, TTL.accumulation, opts);
}

// ── Estación ↔ campo ────────────────────────────────────────────────────

// Radio máximo por defecto para SUGERIR una estación. Es una decisión de
// producto abierta (pendiente #2 del PRD, a cerrar con INIA el 5-ago): la red
// es muy desigual — hay campos con estación a 1 km y otros a casi 30 km, donde
// el dato deja de representar al predio. Se sugiere igual pero se devuelve
// siempre la distancia para que la UI la muestre y el usuario pueda corregir.
const RADIO_SUGERENCIA_KM = 35;

function distanciaKm(lat1, lon1, lat2, lon2) {
  const dy = (lat2 - lat1) * 111.0;
  const dx = (lon2 - lon1) * 111.0 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dx * dx + dy * dy);
}

// Estaciones más cercanas a un punto, ordenadas por distancia.
// Cada una trae `distancia_km` y `tiene_historial` (¿alcanza para comparar
// contra el año anterior?).
// → [{ id, name, institution, region, comuna, lat, lon, elevation_m, first_date,
//      distancia_km, tiene_historial }]
async function estacionesCercanas({ lat, lon }, { limite = 5, radioKm = RADIO_SUGERENCIA_KM, historialDesde = null, deadline = null } = {}) {
  const { data } = await getStations({ deadline });
  if (!Array.isArray(data)) return [];
  const conDistancia = data
    .filter(s => typeof s.lat === 'number' && typeof s.lon === 'number')
    .map(s => ({
      ...s,
      distancia_km: Math.round(distanciaKm(lat, lon, s.lat, s.lon) * 10) / 10,
      tiene_historial: historialDesde ? Boolean(s.first_date && s.first_date <= historialDesde) : null,
    }))
    .sort((a, b) => a.distancia_km - b.distancia_km);

  const dentroDelRadio = conDistancia.filter(s => s.distancia_km <= radioKm);
  // Si ninguna cae dentro del radio, igual se devuelven las más cercanas: la UI
  // avisa que está fuera del radio recomendado en vez de dejar el campo huérfano.
  return (dentroDelRadio.length ? dentroDelRadio : conDistancia).slice(0, limite);
}

// Hasta cuántos km de más se aceptan a cambio de tener historial interanual.
//
// ⚠️ Este umbral es una decisión de producto que corresponde a INIA (pendiente
// #2 del PRD: criterio de selección cuando hay varias estaciones cercanas), no
// una constante técnica. Queda acá, nombrada y con default explícito, para
// llevarla a la revisión del 5 de agosto en vez de enterrarla en la lógica.
const MARGEN_HISTORIAL_KM = 5;

// Cuál sugerir de un conjunto ya ordenado por distancia.
//
// Gana la más cercana, salvo que no tenga historial suficiente para comparar
// contra el año anterior y exista otra con historial a menos de
// MARGEN_HISTORIAL_KM de más.
//
// El caso que motiva la regla es real: para el campo de Chillán del piloto la
// más cercana es Quilamapu (~1 km) pero registra desde el 2025-10-10, así que
// la comparación interanual sale vacía; la siguiente con historial largo está a
// 15 km. Se prefiere el dato cercano —la representatividad del balance hídrico
// cae rápido con la distancia— y la tarjeta avisa que no hay comparación. Pero
// si la alternativa con historial estuviera a 2 o 3 km, conviene esa.
//
// Si ninguna tiene historial, se devuelve la más cercana y el snapshot lo
// informa (balance sin comparación, no un error).
function elegirEstacion(candidatas) {
  if (!candidatas.length) return null;
  const primera = candidatas[0];
  if (primera.tiene_historial !== false) return primera;

  const conHistorial = candidatas.find(s => s.tiene_historial);
  if (conHistorial && (conHistorial.distancia_km - primera.distancia_km) <= MARGEN_HISTORIAL_KM) {
    return conHistorial;
  }
  return primera;
}

// Tamaño de las cachés y estado de la persistencia. Para pruebas y para la
// observabilidad de consumo que pide P4 del plan.
const cacheStats = () => ({
  entradas: cache.size,
  stale: stale.size,
  topes: { cache: MAX_ENTRADAS_CACHE, stale: MAX_ENTRADAS_STALE },
  persistencia_rota: persistenciaRota,
  escrituras_pendientes: escriturasPendientes.length,
});

module.exports = {
  getHealth, getStations, getStation, getSeries, getAccumulation,
  estacionesCercanas, elegirEstacion, distanciaKm, BoletinError, flushSnapshots,
  RADIO_SUGERENCIA_KM, MARGEN_HISTORIAL_KM, BOLETIN_BASE: BASE,
  TIMEOUT_LLAMADA_MS, MARGEN_RESPUESTA_MS, cacheStats, resumenMetricas,
};

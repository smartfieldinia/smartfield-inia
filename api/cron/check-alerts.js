// ════════════════════════════════════════════════════════════════════════
// Motor de alertas — corre por cron (Vercel) o manualmente para probar.
// Recorre los campos/cuarteles de los usuarios, evalúa clima (Open-Meteo) y
// satélite (GEE), y envía avisos por WhatsApp (Twilio) según las preferencias
// de cada agricultor (a nivel de perfil, con override por cuartel). Guarda
// cada aviso en la tabla `alerts` (con `field_id`) y evita duplicar el mismo
// tipo de aviso por CUARTEL el mismo día — antes el dedupe era por usuario,
// lo que bloqueaba las alertas de un cuartel si otro cuartel del mismo
// usuario ya había avisado ese día.
//
// Si el productor tiene un asesor vinculado con `notificar_asesor=true`, el
// asesor recibe una copia del mismo mensaje (prefijada con el nombre del
// productor) — no se fusionan destinatarios, es un envío adicional.
//
// Seguridad: exige  Authorization: Bearer ${CRON_SECRET}  (Vercel Cron lo
// envía automáticamente). Para probar a mano:
//   GET /api/cron/check-alerts?test=1&phone=56912345678
//   con el header Authorization: Bearer <CRON_SECRET>
// ════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { sbSelect, sbInsert, sbUpsert } = require('../_supabase');
const { getForecast, getRiesgoProximosDias, getIndices, getDeltaArea, HORIZONTE_RIESGO_DIAS } = require('../_sensors');
const { sendEmail, emailDeUsuario, htmlAviso } = require('../_email');
const { sendTemplate } = require('../_kapso');
const { RULE_VERSION, enTemporadaDeAlertaRiego } = require('../_riesgo');
const { getUmbrales } = require('../_umbrales');

// ── Presupuesto y concurrencia del recorrido ────────────────────────────
//
// `maxDuration` son 300 s (vercel.json). Se corta en 240 para que el resumen y
// los envíos ya encolados alcancen a salir: pasarse del límite mata la
// invocación sin escribir nada, y lo que se pierde son siempre los mismos
// cuarteles, los del final de la lista.
const PRESUPUESTO_MS = 240000;
// 4 cuarteles a la vez: cada uno son ~4 llamadas a GEE/Open-Meteo, así que esto
// ya son ~16 peticiones en vuelo. Subirlo cambia el cuello de botella de
// nosotros a los proveedores, y GEE responde 429 antes de lo que uno cree.
const CONCURRENCIA_CUARTELES = 4;

// Plantillas WhatsApp aprobadas por Meta — obligatorias en el número
// productivo para mensajes que el negocio inicia fuera de la ventana de 24h
// (el texto libre solo vale como respuesta dentro de esa ventana). La
// primera versión (una sola plantilla genérica `alerta_agro`, con "detalle"
// como texto libre y una invitación a responder) fue RECHAZADA por Meta —
// probablemente por mezclar Utility con lenguaje de engagement y tener casi
// todo el cuerpo como variable. Se reemplazó por una plantilla FIJA por tipo
// de alerta, con solo valores numéricos como variable (nombre del cuartel +
// 1-3 números), sin invitación a responder. Cuerpos a crear/aprobar en Meta:
//   alerta_helada:    "❄️ SmartField INIA: alerta de helada en tu cuartel {{1}}.
//                      Se pronostican {{2}}°C esta noche. Protege tu cultivo."
//   alerta_calor:     "☀️ SmartField INIA: alerta de calor en tu cuartel {{1}}.
//                      Se pronostican hasta {{2}}°C. Cuida el riego y el
//                      estrés térmico."
//   alerta_sequia:    "🌧️ SmartField INIA: alerta de falta de agua en tu
//                      cuartel {{1}}. Solo {{2}} mm de lluvia en los últimos
//                      7 días. Revisa el riego."
//   alerta_satelital: "🛰️ SmartField INIA: alerta satelital en tu cuartel
//                      {{1}}. El vigor del cultivo bajó un {{2}}% respecto a
//                      la última medición."
//   alerta_boletin:   "📋 SmartField INIA: resumen semanal de tu cuartel
//                      {{1}}. Temperatura mínima {{2}}°C, máxima {{3}}°C,
//                      lluvia últimos 7 días {{4}} mm. Revisa más detalles
//                      en la app."   ← v1, se deja solo como fallback
//   alerta_boletin_v2: "📋 SmartField INIA: resumen semanal de tu cuartel
//                      {{1}}. Temperatura mínima {{2}}°C, máxima {{3}}°C,
//                      lluvia últimos 7 días {{4}} mm. {{5}} Buena semana."
//                      (id 27992032200460239, creada el 2026-08-24). El cierre
//                      fijo NO es decorativo: Meta rechaza los cuerpos que
//                      terminan en una variable.
// Todas categoría Utility, idioma Español (es). `{{1}}` es siempre el
// nombre del cuartel — la copia al asesor reusa la misma plantilla
// sumándole el nombre del productor a esa variable.
// Marca Avisa (2026-10): cada tipo usa su copia `_avisa` ("Avisa INIA:" en vez
// de "SmartField INIA:", ver scripts/crear-plantillas-avisa.js) y cae a la
// original, ya aprobada, mientras Meta revisa la nueva.
const ALERT_TEMPLATES = {
  helada:  { name: 'alerta_helada_avisa',    lang: 'es', fallback: { name: 'alerta_helada',    lang: 'es' } },
  calor:   { name: 'alerta_calor_avisa',     lang: 'es', fallback: { name: 'alerta_calor',     lang: 'es' } },
  sequia:  { name: 'alerta_sequia_avisa',    lang: 'es', fallback: { name: 'alerta_sequia',    lang: 'es' } },
  ndvi:    { name: 'alerta_satelital_avisa', lang: 'es', fallback: { name: 'alerta_satelital', lang: 'es' } },
  // El boletín usa la v2 (2026-08-24): la v1 terminaba en "Revisa más detalles
  // en la app", que es justo lo que Stanley pidió sacar — el productor abría la
  // app y perdía el hilo. La v2 cambia esa frase por {{5}}: el detalle
  // agronómico que este cron YA calcula (horas frío, adelanto de temporada,
  // vigor vs. año pasado) y que hasta ahora moría en la tabla `alerts`.
  // `fallback` cubre la ventana mientras Meta aprueba la nueva: si el envío
  // falla por la plantilla, sale la anterior con sus parámetros.
  boletin: { name: 'alerta_boletin_v2_avisa', lang: 'es', params: 5,
             fallback: { name: 'alerta_boletin_v2', lang: 'es', params: 5 } },
};

// Un parámetro de plantilla no admite saltos de línea, tabs ni más de 4
// espacios seguidos (Meta lo rechaza con #132000), y vacío tampoco: si no hay
// nada agronómico que contar, se dice eso.
const SIN_DETALLE_AGRONOMICO = 'Sin novedades agronómicas esta semana.';
function detalleAgronomico(texto) {
  const limpio = String(texto || '').replace(/\s+/g, ' ').trim();
  return limpio ? limpio.slice(0, 300) : SIN_DETALLE_AGRONOMICO;
}
const { mergePrefs } = require('../_prefs');
// Comparar contra "la misma fecha del año pasado" no es tomar cualquier lectura
// de la ventana: es la más cercana al aniversario (ver _vigor.js).
const { lecturaMasCercana } = require('../_vigor');
const { compararGradosDia, horasFrioAcumuladas } = require('../_agroclim');
// Informe semanal de terreno: se arma con los datos que este cron ya calcula.
const { generarInformeSemanal, enviarInformePorCorreo, textoInforme, precargarInforme } = require('../_informe');
const { agroclimDeCampo } = require('../fields');
const { lluvia7dDelCampo, demandaHidrica7dDelCampo, superaDemanda } = require('../_clima-cuartel');

// Los umbrales por defecto viven en `_umbrales.js` (`UMBRAL_DEFECTO`), que es el
// mismo lugar del que los lee la tarjeta de pronóstico del dashboard. Acá había
// una COPIA con los mismos cuatro números; su última referencia viva era
// `UMBRAL.ndvi`, y se fue el 2026-09-14 cuando la regla satelital pasó a usar el
// umbral resuelto por cultivo (`umbral.area_delta`). Copiarlos de nuevo acá es
// exactamente el patrón que `_umbrales.js` existe para evitar: el día que INIA
// pueble `alert_rules`, el cron usaría los de la tabla y la pantalla los de la
// copia, y el mismo cuartel diría "riesgo medio" por WhatsApp y "sin riesgo" en
// la app el mismo día.

// Cobertura mínima para creerle al porcentaje de área. `area_caida` se mide
// sobre los píxeles con dato en las DOS ventanas, así que con media nube encima
// "25 % de área caída" puede ser el 25 % de un tercio del cuartel. Por debajo de
// esto se trata igual que "no hubo pasada limpia": callarse, no adivinar.
const COBERTURA_MINIMA = 0.35;

// Largo de cada mitad del Δ satelital. Mismo valor por defecto que el selector
// de la capa Δ NDVI en el dashboard: si el mapa dice que un sector cayó, el
// WhatsApp tiene que estar mirando la misma ventana. Sentinel-2 revisita cada
// ~5 días, así que 10 asegura al menos una escena por mitad salvo semana
// completamente nublada.
const DELTA_DIAS = 10;

// Hasta dónde se estira la búsqueda de una pasada limpia PARA LA ALERTA.
// `_sensors.js` admite hasta 60 días y el bot a pedido los usa: si un productor
// pregunta en pleno invierno, contestar con la pasada de hace 40 días diciendo
// que es de hace 40 días es mejor que no contestar. Una alerta es al revés —se
// dispara sola y afirma que algo cambió "en la última pasada"—, así que no puede
// comparar contra un mes y medio atrás: 15 días es el tope (Stanley, 2026-09-14:
// "tomar un periodo de máximo 10 a 15 días"). Si en 15 días no hubo pasada
// limpia, no se alerta y queda contado en `resumen.ndvi_sin_pasada`.
const DELTA_TOPE_ALERTA_DIAS = 15;

// ── Ventana de silencio por tipo de aviso ─────────────────────────────
//
// Cuántos días NO se repite el mismo aviso para el mismo cuartel. El aviso
// satelital compara los últimos DELTA_DIAS contra los DELTA_DIAS previos: una
// caída queda dentro de esa ventana durante DELTA_DIAS, así que cada corrida
// diaria la vuelve a ver y el productor recibe el mismo mensaje todos los días
// por un solo hecho. Del 23 al 27-08-2026 fueron 43 avisos diarios a 6 usuarios,
// el mismo número exacto los cinco días. Los avisos de clima no llevan silencio:
// una helada hoy y otra mañana son dos hechos distintos.
const SILENCIO_DIAS = { ndvi: DELTA_DIAS };


// ¿La caída es solo el ciclo normal del cultivo? Si el NDVI de hoy está igual o
// mejor que el del año pasado en la misma época, lo que bajó entre las dos
// ventanas es estacionalidad —vid y frutales caducos pierden hoja todos los
// inviernos—, no un problema del cuartel. Sin lectura del año anterior (cuartel
// nuevo, o sin backfill) no se puede descartar nada y la alerta sigue su curso:
// ante la duda preferimos un falso positivo a un falso negativo.
async function pareceCaidaEstacional(fieldId, ndviHoy, todayISO) {
  if (ndviHoy == null) return false;
  const unAnioAtras = new Date(Date.parse(todayISO) - 365 * 86400000);
  const desde = new Date(unAnioAtras.getTime() - 20 * 86400000).toISOString().split('T')[0];
  const hasta = new Date(unAnioAtras.getTime() + 20 * 86400000).toISOString().split('T')[0];
  try {
    const filas = await sbSelect('ndvi_history', {
      select: 'ndvi,fecha', field_id: `eq.${fieldId}`,
      and: `(fecha.gte.${desde},fecha.lte.${hasta})`, order: 'fecha.asc',
    });
    const anioAnterior = lecturaMasCercana(filas, unAnioAtras.toISOString().split('T')[0])?.valor;
    if (anioAnterior == null || anioAnterior <= 0) return false;
    return ndviHoy >= anioAnterior;
  } catch (_) {
    return false;
  }
}

// Lo que el informe semanal necesita de un cuartel, tomado de lo que el bucle
// YA calculó. Es una función y no un literal en medio del bucle para que el
// arnés pueda ejercitar el contrato cron ↔ informe sin red: el bug de
// `serieNdvi` sobrevivió justamente porque no había forma de testear esta
// frontera, y los fixtures del arnés armaban las unidades a mano — con el shape
// correcto, que no era el que el cron mandaba.
//
// `clima` y `umbral` viajan aunque el bucle ya los tenga calculados y antes se
// tiraran: alimentan las acciones y el gráfico de pronóstico del informe sin
// costar una sola llamada de red.
//
// `serieNdvi` NO se llena acá: la carga `generarInformeSemanal` en lote, una vez
// por usuario y solo los lunes. Se declara vacía para que el shape esté completo
// en el punto donde se arma.
function unidadDeInforme({ campo, orden, avisos, riesgo, clima, umbral, ndviActual }) {
  return {
    campo, orden, riesgo, clima, umbral, ndviActual,
    serieNdvi: [],
    // El boletín se excluye: no es una señal de terreno, es el resumen que sale
    // por WhatsApp.
    alertas: (avisos || [])
      .filter(a => a.tipo !== 'boletin')
      .map(a => ({
        tipo: a.tipo, titulo: a.titulo, nivel: a.nivel || null,
        // Los tres campos con los que el informe redacta su propia frase
        // ("helada: mínima -2,4 °C el miércoles 9"). Antes se mandaba
        // `detalle: a.detalleInforme`, un campo que no se asignaba en ninguna
        // parte del repo, así que el motivo caía siempre al título pelado.
        fechaEvento: a.fechaEvento || null,
        valor: a.valor ?? null,
        unidad: a.unidad || null,
      })),
  };
}

// ════════════════════════════════════════════════════════════════════════
// Entregas (§11.3 del PRD) — la alerta y su envío son cosas distintas.
//
// Hasta la v9 el resultado de sendTemplate() solo se acumulaba en
// `resumen.errores`, que muere con la invocación del cron: una alerta que nunca
// salió quedaba indistinguible de una entregada. Eso importa hoy mismo, no en
// abstracto — sin método de pago en el WhatsApp Manager, Meta bloquea todos los
// mensajes iniciados por el negocio, que es exactamente lo que manda este cron.
// Ahora cada intento deja una fila con su estado y su motivo de fallo.
//
// Degrada solo: si la migración v9 no está aplicada, se anota una vez y el
// motor sigue funcionando como antes (mandando y guardando alertas).
// ════════════════════════════════════════════════════════════════════════
let deliveriesDisponible = true;

async function registrarEntrega(alertId, datos) {
  if (!deliveriesDisponible || !alertId) return null;
  try {
    const [fila] = await sbInsert('notification_deliveries', {
      alert_id: alertId, canal: 'whatsapp', ...datos,   // `datos.canal` puede sobreescribirlo (email)
    });
    return fila?.id || null;
  } catch (e) {
    if (/notification_deliveries/.test(e.message)) {
      deliveriesDisponible = false;
      console.warn('[alertas] sin tabla notification_deliveries: no se registra el estado de entrega (falta migración v9)');
    }
    return null;
  }
}

// Envía y deja registrado el resultado. `rol` distingue al productor de la
// copia al asesor: son entregas independientes de la misma alerta.
// ── Un mensaje por campo y evento, no uno por cuartel ─────────────────
//
// El registro en `alerts` es y sigue siendo POR CUARTEL: la idempotencia
// depende de eso y el usuario las lee así en la app. Lo que se agrupa es el
// ENVÍO. Una helada regional es un solo hecho, y un asesor con 36 cuarteles
// recibía 36 WhatsApp idénticos el mismo día — con el número en el escalón más
// bajo de Meta (250 conversaciones/24 h), eso además consume la cuota entera.
//
// La plantilla aprobada no cambia: {{1}} es un parámetro de texto (sin saltos
// de línea ni formato, lo que Meta acepta) que hasta el 2026-09-10 llevaba el
// nombre de un cuartel: "Pivote 1 y 12 cuarteles más".
//
// ── Un mensaje por CAMPO, no por cartera (2026-09-10) ─────────────────
//
// Una helada, un golpe de calor o una semana sin lluvia le ocurren al PREDIO
// entero: entre cuarteles vecinos el pronóstico no cambia más que un par de
// décimas, así que el aviso no es "de un cuartel en particular". El
// agrupamiento del 08-21 juntaba toda la cartera del usuario en un mensaje, y
// un productor con dos campos a kilómetros de distancia (Santa Rosa, 34
// cuarteles; Human, 5) recibía uno solo, rotulado con el nombre de un cuartel
// de cualquiera de los dos. Ahora sale uno por campo, rotulado con el nombre
// del campo.
//
// Los cuarteles sin `predio_id` (11 de 55 en producción al 2026-09-10) no
// pertenecen a ningún campo: se agrupan entre ellos bajo la clave `sin-predio`
// y conservan el rótulo anterior.
// El mismo centinela lo usa el informe semanal para armar su grupo "Cuarteles
// sin campo": el agrupamiento por predio tiene que ser uno solo, o un cuartel
// suelto podría caer en un grupo para el WhatsApp y en otro para el PDF.
const SIN_PREDIO = 'sin-predio';

// Agrupa las unidades del informe por predio. Replica el criterio de
// `agruparPorPredio` de `public/app.html` —incluido el del nombre, que sale del
// primer cuartel que lo tenga porque una fila vieja puede traer `predio_id` sin
// `predio_nombre`—, y no lo importa porque ese archivo es un monolito sin build.
//
// Está exportada para el arnés: es la frontera donde un cuartel suelto podría
// caer en un grupo distinto del que usan las alertas.
function agruparUnidadesPorPredio(unidades) {
  const grupos = new Map();
  for (const u of unidades || []) {
    const clave = u.campo?.predio_id || SIN_PREDIO;
    if (!grupos.has(clave)) grupos.set(clave, { predioId: clave, nombre: null, unidades: [] });
    const g = grupos.get(clave);
    g.unidades.push(u);
    if (!g.nombre && u.campo?.predio_nombre) g.nombre = u.campo.predio_nombre;
  }
  for (const g of grupos.values()) {
    g.nombre = g.predioId === SIN_PREDIO ? 'Cuarteles sin campo' : (g.nombre || 'Campo sin nombre');
  }
  return [...grupos.values()];
}

// La clave de idempotencia del informe semanal. LLEVA EL PREDIO desde que sale
// uno por campo: sin eso, el índice único parcial sobre `dedupe_key` (migración
// v9) deja entrar el primer predio de la semana y rechaza en silencio a todos
// los demás — el usuario recibiría un informe en vez de tres y nada lo diría.
function claveInforme(userId, predioId, semana) {
  return `${userId}|informe|${predioId}|${semana}|${RULE_VERSION}`;
}

function claveCampo(p) {
  return p.predioId || SIN_PREDIO;
}

function claveGrupo(userId, predio, tipo, periodo, rol, destinatario) {
  return `${userId}|${predio}|${tipo}|${periodo}|${rol}|${destinatario}`;
}

// Rótulo de {{1}}: el nombre del campo cuando existe, con el alcance entre
// paréntesis para que el productor sepa cuánto abarca sin abrir la app. Sin
// campo, el rótulo viejo (un cuartel + "y N más").
function rotularGrupo(items) {
  const campo = items[0]?.predioNombre;
  const nombres = items.map(i => i.cuartel);
  if (campo) {
    return items.length === 1 ? `${campo} (${nombres[0]})` : `${campo} (${items.length} cuarteles)`;
  }
  if (nombres.length === 1) return nombres[0];
  const resto = nombres.length - 1;
  return `${nombres[0]} y ${resto} ${resto === 1 ? 'cuartel más' : 'cuarteles más'}`;
}

// Junta los pendientes por destinatario y manda uno por grupo. Cada alerta del
// grupo recibe su propio registro de entrega, para que en la tabla se vea qué
// cuarteles viajaron en ese mensaje.
async function despacharAgrupado(pendientes, resumen) {
  const grupos = new Map();
  for (const p of pendientes) {
    const k = claveGrupo(p.userId, claveCampo(p), p.tipo, p.periodo, p.rol, p.phone);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  }

  for (const items of grupos.values()) {
    const primero = items[0];
    const params = [...primero.params];
    params[0] = primero.prefijoProductor
      ? `${rotularGrupo(items)} (productor: ${primero.prefijoProductor})`
      : rotularGrupo(items);

    if (!primero.phone) {
      for (const i of items) {
        await registrarEntrega(i.alertId, { rol: i.rol, estado: 'not_requested', plantilla: primero.tpl.name });
        resumen.entregas.not_requested++;
      }
      continue;
    }

    let plantillaUsada = primero.tpl.name;
    let r = await sendTemplate(primero.phone, primero.tpl.name, primero.tpl.lang,
      primero.tpl.params ? params.slice(0, primero.tpl.params) : params);
    // La plantilla nueva puede seguir en revisión (o haber sido rechazada):
    // antes que perder el aviso, se manda la versión anterior recortando los
    // parámetros que esa no tiene.
    if (!r.ok && primero.tpl.fallback && /template/i.test(String(r.error || ''))) {
      const fb = primero.tpl.fallback;
      const r2 = await sendTemplate(primero.phone, fb.name, fb.lang, params.slice(0, fb.params || params.length));
      if (r2.ok) { plantillaUsada = fb.name; r = r2; resumen.errores.push(`${primero.tpl.name} no disponible, salió ${fb.name}`); }
    }
    for (const i of items) {
      await registrarEntrega(i.alertId, {
        rol: i.rol, destinatario: primero.phone, plantilla: plantillaUsada,
        estado: r.ok ? 'sent' : 'failed',
        proveedor_id: r.ok ? (r.sid || null) : null,
        error: r.ok ? null : String(r.error || '').slice(0, 500),
        // Deja rastro de que el mensaje llevaba varios cuarteles: si no, en la
        // tabla parecen N envíos y en el teléfono hubo uno.
        agrupado_con: items.length > 1 ? items.length : null,
      });
    }
    if (r.ok) { resumen.enviados++; resumen.entregas.sent += items.length; }
    else { resumen.entregas.failed += items.length; resumen.errores.push(`${primero.rol}: ${r.error}`); }
    if (items.length > 1) resumen.agrupados = (resumen.agrupados || 0) + items.length - 1;
  }
}

// Qué mandaría el despacho, sin mandarlo (modo `?dry=1`).
function planDeEnvio(pendientes) {
  const grupos = new Map();
  for (const p of pendientes) {
    const k = claveGrupo(p.userId, claveCampo(p), p.tipo, p.periodo, p.rol, p.phone);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  }
  return [...grupos.values()].map(items => ({
    tipo: items[0].tipo,
    rol: items[0].rol,
    tiene_numero: !!items[0].phone,
    campo: items[0].predioNombre || null,
    cuarteles: items.length,
    rotulo: rotularGrupo(items),
    mensajes_antes: items.length,
    mensajes_ahora: 1,
    // Qué plantilla saldría y con cuántos parámetros: es la forma de ver, sin
    // mandar nada, que el boletín arma los 5 de `alerta_boletin_v2` (el 5º es
    // el detalle agronómico que antes solo llegaba a la app).
    plantilla: items[0].tpl?.name || null,
    parametros: (items[0].params || []).length,
    detalle: items[0].tipo === 'boletin' ? (items[0].params || [])[4] || null : undefined,
  }));
}

// Qué correos saldrían, sin mandarlos (modo `?dry=1`).
function planDeCorreos(pendientes) {
  const grupos = new Map();
  for (const p of pendientes) {
    const k = claveGrupoEmail(p);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  }
  return [...grupos.values()].map(items => ({
    tipo: items[0].tipo,
    fecha_evento: items[0].periodo,
    campo: items[0].predioNombre || null,
    cuarteles: items.length,
    mensajes_antes: items.length,
    mensajes_ahora: 1,
    asunto: asuntoCorreo(items[0].tipo === 'helada', alcanceCorreo(items), items[0].periodo),
  }));
}

// Niveles que disparan aviso. Con los umbrales por defecto, `medio` es
// exactamente el criterio anterior (mínima bajo 2 °C / máxima sobre 35 °C), así
// que la lista de avisados no cambia: cambia el horizonte y el detalle.
const NIVEL_AVISA = new Set(['medio', 'alto']);

// Un aviso de helada a 4 días es útil; una plantilla de WhatsApp que dice "esta
// noche" para ese mismo evento es FALSA. Las plantillas aprobadas por Meta
// tienen ese texto fijo, así que por WhatsApp solo salen los eventos de hoy o
// mañana; el resto va por correo (texto libre) y queda en la app.
//
// Para mandar los de 2-5 días por WhatsApp hay que aprobar plantillas nuevas
// con la fecha como variable — p. ej. `alerta_helada_dia`: "❄️ SmartField INIA:
// riesgo de helada {{2}} en tu cuartel {{1}}. Mínima prevista {{3}}°C." — y eso
// hoy está bloqueado por el WhatsApp Manager (falta método de pago).
const DIAS_PLANTILLA_WHATSAPP = 1;

function diasHasta(fechaISO) {
  if (!fechaISO) return null;
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const dif = (Date.parse(fechaISO + 'T00:00:00Z') - Date.parse(hoy + 'T00:00:00Z')) / 86400000;
  return Number.isFinite(dif) ? Math.round(dif) : null;
}

function cuandoTexto(fechaISO) {
  const d = diasHasta(fechaISO);
  if (d == null) return '';
  if (d <= 0) return 'hoy';
  if (d === 1) return 'mañana';
  return `en ${d} días (${fechaISO})`;
}

// ── Un correo por campo y evento, no uno por cuartel ──────────────────
//
// Mismo criterio que `despacharAgrupado` para WhatsApp, y por el mismo motivo:
// una helada es un hecho del PREDIO, no de cada cuartel. El correo salía dentro
// del bucle, uno por aviso, y el 2026-09-01 un productor con 32 cuarteles
// recibió 32 correos de la misma helada. Entre cuarteles vecinos el pronóstico
// no cambia —a lo sumo un par de décimas de grado—, y esa diferencia se cuenta
// en la lista del cuerpo, no en 32 asuntos.
//
// La unidad de agrupamiento es el CAMPO desde el 2026-09-10 (antes era la
// cartera entera del usuario): dos predios distintos son dos eventos distintos
// y ahora cada uno lleva su nombre en el asunto.
//
// Lo que se agrupa es el ENVÍO: en `alerts` sigue habiendo una fila por cuartel
// (la app las lee así) y cada una recibe su propia fila de entrega.
// Desde el 2026-09-10 el campo entra en la clave, igual que en WhatsApp: dos
// predios del mismo dueño son dos hechos distintos y el correo que decía
// "39 cuarteles de tu predio" mezclaba los dos.
function claveGrupoEmail(p) {
  return `${p.userId}|${claveCampo(p)}|${p.tipo}|${p.periodo}`;
}

// Cómo se nombra al destinatario del aviso: el CAMPO cuando existe, porque el
// evento es del predio y no de un cuartel suelto. Sin campo, lo de antes.
function alcanceCorreo(items) {
  const campo = items[0]?.predioNombre;
  if (campo) return campo;
  return items.length > 1 ? `${items.length} cuarteles` : items[0].cuartel;
}

function asuntoCorreo(esHelada, alcance, fechaEvento) {
  return `${esHelada ? '❄️' : '☀️'} Riesgo de ${esHelada ? 'helada' : 'golpe de calor'}`
    + ` ${cuandoTexto(fechaEvento)} — ${alcance}`;
}

// Detalle por cuartel, ya ordenado del más expuesto al menos.
function listaCuarteles(items) {
  const filas = items.map(i =>
    `<li style="margin:0 0 4px"><strong>${i.cuartel}</strong> — ${i.aviso.valor} ${i.aviso.unidad} (riesgo ${i.aviso.nivel})</li>`
  ).join('');
  return `<ul style="margin:14px 0 0;padding-left:18px;font-size:14px;line-height:1.55;color:#12211d">${filas}</ul>`;
}

// Un correo para todos los cuarteles del mismo evento. Best-effort y con una
// fila de entrega por alerta: que Resend falle no debe tumbar la corrida ni el
// envío por WhatsApp.
async function enviarCorreoAgrupado({ items, email, resumen }) {
  const esHelada = items[0].aviso.tipo === 'helada';
  // El cuartel más expuesto encabeza: la mínima más baja en helada, la máxima
  // más alta en calor. Es el número que decide si el productor sale a regar.
  const orden = [...items].sort((a, b) => esHelada
    ? (a.aviso.valor ?? 0) - (b.aviso.valor ?? 0)
    : (b.aviso.valor ?? 0) - (a.aviso.valor ?? 0));
  const peor    = orden[0].aviso;
  const nivel   = orden.some(i => i.aviso.nivel === 'alto') ? 'alto' : peor.nivel;
  const cuando  = cuandoTexto(peor.fechaEvento);
  const varios  = orden.length > 1;
  const evento  = esHelada ? 'helada' : 'golpe de calor';
  const extremo = esHelada ? 'mínima' : 'máxima';

  const campo   = orden[0].predioNombre || null;
  const asunto  = asuntoCorreo(esHelada, alcanceCorreo(orden), peor.fechaEvento);

  // Con campo, el sujeto de la frase es el campo; el detalle por cuartel viaja
  // igual en la lista de abajo, que es donde se ven las décimas de diferencia.
  const donde = campo
    ? ` en el campo <strong>${campo}</strong> (${orden.length} ${orden.length === 1 ? 'cuartel' : 'cuarteles'})`
    : ` en <strong>${orden.length} cuarteles</strong>`;
  let cuerpo = `Riesgo <strong>${nivel}</strong> de ${evento} ${cuando}${varios || campo ? donde : ''}: `;
  cuerpo += varios
    ? `la ${extremo} más ${esHelada ? 'baja' : 'alta'} pronosticada es de <strong>${peor.valor} ${peor.unidad}</strong> (${orden[0].cuartel}).`
    : `se pronostica una ${extremo} de <strong>${peor.valor} ${peor.unidad}</strong>.`;
  if (varios) cuerpo += listaCuarteles(orden);

  const r = await sendEmail({
    to: email,
    subject: asunto,
    html: htmlAviso({
      titulo: peor.titulo, cuerpo,
      campo,
      cuartel: orden[0].cuartel,
      cuarteles: orden.map(i => i.cuartel),
      pie: `Pronóstico Open-Meteo a ${HORIZONTE_RIESGO_DIAS} días. Los niveles usan cortes provisionales y no consideran la etapa fenológica del cultivo. Puedes desactivar estos avisos desde Gestión de cuarteles en la plataforma.`,
    }),
  });

  for (const i of orden) {
    await registrarEntrega(i.alertId, {
      canal: 'email', rol: 'productor', destinatario: email,
      estado: r.ok ? 'sent' : 'failed',
      proveedor_id: r.ok ? (r.id || null) : null,
      error: r.ok ? null : String(r.error || '').slice(0, 500),
      // Igual que en WhatsApp: sin esto, en la tabla parecen N envíos y en la
      // bandeja hubo uno.
      agrupado_con: orden.length > 1 ? orden.length : null,
    });
  }
  if (r.ok) { resumen.entregas.sent += orden.length; resumen.correos = (resumen.correos || 0) + 1; }
  else { resumen.entregas.failed += orden.length; resumen.errores.push(`email: ${r.error}`); }
  if (orden.length > 1) resumen.correos_agrupados = (resumen.correos_agrupados || 0) + orden.length - 1;
  return r;
}

// Junta los correos pendientes por (usuario, tipo, día del evento) y manda uno
// por grupo. El email se resuelve una vez por usuario: antes era una llamada a
// la Admin API de Supabase por cada aviso.
async function despacharCorreos(pendientes, resumen) {
  const grupos = new Map();
  for (const p of pendientes) {
    const k = claveGrupoEmail(p);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  }
  const emails = new Map();
  for (const items of grupos.values()) {
    const userId = items[0].userId;
    if (!emails.has(userId)) emails.set(userId, await emailDeUsuario(userId));
    const email = emails.get(userId);
    if (!email) {
      for (const i of items) {
        await registrarEntrega(i.alertId, {
          canal: 'email', rol: 'productor', estado: 'not_requested',
          error: 'sin email en la cuenta',
        });
        resumen.entregas.not_requested++;
      }
      continue;
    }
    try {
      await enviarCorreoAgrupado({ items, email, resumen });
    } catch (e) {
      resumen.errores.push(`email: ${e.message}`);
    }
  }
}

// Año + semana ISO ("2026-W31"), para identificar el boletín semanal por su
// semana y no por el día en que se logró mandar.
function semanaISO(fecha) {
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  // La semana ISO se ancla al jueves: se desplaza al jueves de esta semana y se
  // cuenta desde el primer jueves del año.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const inicioAnio = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((d - inicioAnio) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
}

// Centroide simple de un polígono [[lon,lat], ...]
function centroid(coords) {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  let sx = 0, sy = 0, n = 0;
  for (const c of coords) {
    if (!Array.isArray(c) || c.length < 2) continue;
    sx += c[0]; sy += c[1]; n++;
  }
  return n ? { lon: sx / n, lat: sy / n } : null;
}

// `getUmbrales` vive en _umbrales.js: lo comparte con la tarjeta de pronóstico
// del dashboard, para que WhatsApp y la pantalla no puedan divergir.


// Comparación en tiempo constante: `!==` sobre strings corta en el primer byte
// distinto y filtra el secret carácter a carácter ante quien pueda medir la
// latencia. `timingSafeEqual` exige buffers del mismo largo, de ahí el chequeo previo.
function autorizado(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const esperado = Buffer.from(`Bearer ${secret}`, 'utf8');
  const recibido = Buffer.from(req.headers.authorization || '', 'utf8');
  return esperado.length === recibido.length && crypto.timingSafeEqual(esperado, recibido);
}

module.exports = async function handler(req, res) {
  // ── Autorización ──────────────────────────────────────────────────────
  if (!autorizado(req)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const url           = new URL(req.url, 'http://x');
  const isTest        = url.searchParams.get('test') === '1';
  const overridePhone = url.searchParams.get('phone') || null;
  // Simulación: evalúa todo y devuelve QUÉ mandaría, sin tocar la base ni el
  // proveedor. Es la única forma de revisar el agrupamiento sin despertar a
  // treinta agricultores un domingo.
  const isDry = url.searchParams.get('dry') === '1';

  const todayISO = new Date().toISOString().split('T')[0];
  const esLunes  = new Date().toLocaleDateString('en-US', { timeZone: 'America/Santiago', weekday: 'short' }) === 'Mon';

  // `entregas` es el desglose que antes no existía: cuántos envíos salieron,
  // cuántos rechazó el proveedor y cuántos no se intentaron por falta de canal.
  // Es lo que hace visible, en la respuesta del cron, que Meta esté bloqueando
  // los mensajes por falta de método de pago.
  const resumen = { campos: 0, avisos: 0, enviados: 0, entregas: { sent: 0, failed: 0, not_requested: 0 }, errores: [] };
  // Ni los WhatsApp ni los correos salen dentro del bucle: se encolan y se
  // despachan agrupados al final (ver `despacharAgrupado` y `despacharCorreos`),
  // uno por evento y destinatario en vez de uno por cuartel.
  const pendientesWhatsApp = [];
  const pendientesEmail    = [];
  // Evita mandar el mismo tipo de aviso dos veces al mismo número por el
  // mismo CUARTEL en esta corrida (antes era solo por teléfono+tipo, lo que
  // bloqueaba avisos de otros cuarteles del mismo usuario).
  const yaEnviadoRun = new Set();

  try {
    // Mensaje de confirmación inmediato en modo prueba (reusa alerta_boletin,
    // la que más variables tiene, como smoke test de la integración)
    if (isTest && overridePhone) {
      const tpl = ALERT_TEMPLATES.boletin;
      const r = await sendTemplate(overridePhone, tpl.name, tpl.lang,
        ['Prueba Avisa', '10', '20', '5', 'Mensaje de prueba.'].slice(0, tpl.params || 4));
      if (r.ok) resumen.enviados++;
      else resumen.errores.push(`test: ${r.error}`);
    }

    // ── Traer todos los campos con el dueño (teléfono + preferencias) ─────
    const campos = await sbSelect('user_fields', {
      select: '*,users_profile(nombre,whatsapp_phone,preferencias)',
    });
    resumen.campos = campos.length;

    // ── Vínculos de asesores que quieren copia de las alertas de "su" productor ──
    const advisorIdsByProducer = {};
    let advisorPhones = {};
    try {
      const advisorLinks = await sbSelect('advisor_links', {
        select: 'advisor_id,producer_id', estado: 'eq.activo', notificar_asesor: 'eq.true',
      });
      for (const l of advisorLinks) (advisorIdsByProducer[l.producer_id] ||= []).push(l.advisor_id);
      const advisorIds = [...new Set(advisorLinks.map(l => l.advisor_id))];
      if (advisorIds.length) {
        const rows = await sbSelect('users_profile', { select: 'id,whatsapp_phone', id: `in.(${advisorIds.join(',')})` });
        advisorPhones = Object.fromEntries(rows.map(r => [r.id, r.whatsapp_phone]));
      }
    } catch (_) { /* sin vínculos aún, o tabla recién creada */ }

    // ── Acopio para el informe semanal ──────────────────────────────────
    //
    // El informe se arma DESPUÉS del bucle, con lo que el bucle ya calculó:
    // clima, riesgo a 5 días, NDVI y avisos por cuartel. Guardarlos acá es lo
    // que hace que el informe no cueste ni una llamada de red extra — y es la
    // única forma de que entre en el presupuesto del cron.
    //
    // Ojo: el boletín semanal de más abajo se arma POR CUARTEL. El informe es
    // por usuario: con los 35 cuarteles de Santa Rosa, un informe por cuartel
    // serían 35 PDF idénticos.
    const porUsuario = new Map();

    // Cada cuartel se procesa entero acá; el pool de más abajo decide cuántos
    // corren a la vez. `orden` es la posición original en `campos`: los envíos y
    // el informe se reordenan con él al final, así que paralelizar no cambia qué
    // cuartel queda como representativo de un mensaje agrupado.
    const procesarCuartel = async (campo, orden) => {
      const perfil = campo.users_profile || {};
      const prefs  = mergePrefs(perfil.preferencias, campo.preferencias);
      const phone  = overridePhone || perfil.whatsapp_phone || null;
      const nombre = campo.nombre || 'tu campo';
      // Antes se saltaba el cuartel entero si no había teléfono, así que un
      // usuario sin WhatsApp no generaba NINGUNA alerta — tampoco en la app,
      // donde sí puede leerlas. Ahora se evalúa igual y la entrega queda como
      // `not_requested`. Sin perfil asociado sí se salta: es un campo huérfano
      // y no hay a quién avisarle ni quién lo vea.
      if (!campo.users_profile) return;

      const cen = centroid(campo.polygon_coords);
      if (!cen) return;

      const umbral = await getUmbrales(campo.cultivo, campo.region);

      // Clima (solo si alguna preferencia climática o el boletín lo necesita)
      const necesitaClima = prefs.clima.helada || prefs.clima.calor || prefs.clima.sequia
        || prefs.boletin.resumen_semanal || prefs.clima.horas_frio;
      const clima = necesitaClima ? await getForecast(cen) : {};
      // La lluvia de 7 días (alerta de sequía, boletín, informe) sale de la
      // MISMA serie que el dashboard: estación INIA más cercana, Open-Meteo solo
      // de relleno. Hasta el 2026-09-24 era el pasado de `getForecast`
      // (Open-Meteo): 50,2 mm en Santa Rosa la misma semana que la estación
      // medía 37,0, y con un umbral de 5 mm la alerta podía salir o no según la
      // fuente. Si la serie no responde, queda el número de `getForecast`.
      if (necesitaClima) {
        const lluvia = await lluvia7dDelCampo(campo).catch(() => null);
        if (lluvia) {
          clima.precip7d = lluvia.mm;
          clima.precip7dFuente = lluvia.fuente === 'open-meteo' ? 'Open-Meteo' : 'INIA';
        }
      }

      // Helada y calor miran 5 días, no solo mañana (Stanley, 2026-08-05): un
      // aviso de helada sirve si llega con tiempo de mover riego o calefactores.
      // `getForecast` sigue usándose para la lluvia de 7 días (sequía/boletín),
      // que es pasado y este pronóstico no trae.
      const riesgo = (prefs.clima.helada || prefs.clima.calor)
        ? await getRiesgoProximosDias({ ...cen, dias: HORIZONTE_RIESGO_DIAS, heladaC: umbral.helada, calorC: umbral.calor })
        : null;

      // `templateParams` alimenta las variables de la plantilla WhatsApp
      // correspondiente (ver ALERT_TEMPLATES arriba) — {{1}} es siempre el
      // nombre del cuartel. `contenido` sigue siendo el texto rico que se
      // guarda en `alerts` y lee la UI de /app.
      const avisos = []; // { tipo, titulo, contenido, fuente, templateParams }

      // Se avisa desde nivel `medio` — que con el umbral por defecto es
      // exactamente el criterio viejo (mínima bajo 2 °C / máxima sobre 35 °C),
      // así que no cambia a quién se le avisa: cambia CUÁNTO antes se entera y
      // que ahora el aviso dice el día y el nivel.
      if (prefs.clima.helada && NIVEL_AVISA.has(riesgo?.helada?.nivel)) {
        const h = riesgo.helada;
        avisos.push({
          tipo: 'helada', titulo: 'Aviso de helada', fuente: 'Open-Meteo',
          contenido: `❄️ *Helada* — "${nombre}": riesgo ${h.nivel}, ${h.tmin}°C ${cuandoTexto(h.fecha)}. Protege el cultivo.`,
          templateParams: [nombre, h.tmin],
          // Metadatos del pronóstico: deciden si el aviso todavía se puede
          // mandar con la plantilla de WhatsApp (que dice "esta noche") y
          // alimentan el correo, donde el texto es libre.
          fechaEvento: h.fecha, nivel: h.nivel, valor: h.tmin, unidad: '°C',
        });
      }
      if (prefs.clima.calor && NIVEL_AVISA.has(riesgo?.calor?.nivel)) {
        const c = riesgo.calor;
        avisos.push({
          tipo: 'calor', titulo: 'Aviso de calor', fuente: 'Open-Meteo',
          contenido: `☀️ *Calor fuerte* — "${nombre}": riesgo ${c.nivel}, hasta ${c.tmax}°C ${cuandoTexto(c.fecha)}. Cuida riego y estrés térmico.`,
          templateParams: [nombre, c.tmax],
          fechaEvento: c.fecha, nivel: c.nivel, valor: c.tmax, unidad: '°C',
        });
      }
      // Solo en temporada de riego, y desde el 15 de septiembre (2026-09-10,
      // pedido del usuario): la temporada abre el 1 pero la primera quincena
      // todavía es transición. Fuera de eso, "solo 0 mm en 7 días, revisa el
      // riego" es un aviso que el productor recibe en pleno invierno —cuando no
      // riega— y que además no tiene contraparte en la app: la tarjeta de
      // balance hídrico tampoco se dibuja fuera de temporada.
      // La tarjeta sigue apareciendo desde el 1 (`enTemporadaDeRiego()` del
      // front); el desfase de 15 días es deliberado, ver `_riesgo.js`.
      // `hoy` no existe en este scope: la fecha del día se llama `todayISO`.
      // Era un ReferenceError que reventaba el cron entero —con 500— apenas un
      // usuario tenía la alerta de sequía activada, que es el default. Se
      // introdujo el 14-08 y ese es, exactamente, el último día con alertas
      // generadas: desde entonces la corrida moría antes de escribir nada.
      // ── Demanda de agua contra el año pasado (2026-09-24) ─────────────
      //
      // Era "Falta de agua — solo X mm en 7 días. Revisa el riego", disparado
      // con lluvia < 5 mm. Stanley: "dar alerta de falta de riego mmmm no sé,
      // no sabemos si está regando o no; solo indicar la diferencia y que se
      // requiere más que el año pasado en la misma fecha". Y el usuario pidió
      // sacarla del correo y de WhatsApp: queda SOLO en la app (`soloApp`),
      // descriptiva y sin recetar.
      //
      // Dispara con el déficit de 7 días (ETo − lluvia) ≥ 25 % sobre el de las
      // mismas fechas del año pasado —el corte "alto" de la tarjeta de riesgo,
      // `hidrico.yoy_alto_pct`—, o, si el año pasado no hubo déficit, con 5 mm
      // o más de diferencia. `tipo` sigue siendo 'sequia': es la clave de la
      // preferencia del usuario y de la deduplicación.
      if (prefs.clima.sequia && enTemporadaDeAlertaRiego(todayISO)) {
        const dh = await demandaHidrica7dDelCampo(campo).catch(() => null);
        if (superaDemanda(dh)) {
          const mm = x => String(x).replace('.', ',');
          avisos.push({
            tipo: 'sequia', titulo: 'Más demanda de agua que el año pasado',
            fuente: dh.fuente === 'open-meteo' ? 'Open-Meteo' : 'INIA',
            soloApp: true,
            contenido: `💧 *Más demanda de agua que el año pasado* — "${nombre}": déficit de los últimos 7 días `
              + `${mm(dh.deficit_mm)} mm (ETo ${mm(dh.eto_mm)} mm − lluvia ${mm(dh.lluvia_mm)} mm), `
              + `${mm(dh.diferencia_mm)} mm más que en las mismas fechas del año pasado (${mm(dh.previo_mm)} mm)`
              + `${dh.diferencia_pct != null ? `, +${mm(dh.diferencia_pct)} %` : ''}. `
              + 'Se requiere más agua que el año pasado a esta fecha.',
            valor: dh.diferencia_mm, unidad: 'mm',
          });
        }
      }

      // ── Satélite: caída de vigor entre pasadas ────────────────────────
      //
      // Antes se comparaba la mediana de 90 días de HOY contra la fila que el
      // cron guardó AYER, que es la mediana de 90 días de ayer: dos ventanas
      // con 89 días de datos en común, así que la caída relativa daba siempre
      // ~0 y la alerta prácticamente no podía dispararse. Ahora se restan dos
      // ventanas CONSECUTIVAS de `DELTA_DIAS`, que es exactamente lo que pinta
      // la capa Δ NDVI del mapa: el número del WhatsApp y el color del mapa
      // cuentan la misma historia.
      let curNdvi = null;
      if (prefs.satelital.ndvi_caida) {
        const [cur, area] = await Promise.all([
          // Se sigue guardando la mediana larga en el historial: es la que
          // alimenta las curvas del dashboard y cambiarla las reescribiría.
          getIndices({ polygon: campo.polygon_coords }),
          // `getDeltaArea` reemplaza a dos `getIndices` (ventana reciente y
          // previa) y devuelve el área caída, la cobertura, el Δ medio y el NDVI
          // actual.
          //
          // ⚠️ **Son menos llamadas pero MÁS tiempo de pared**, y el matiz importa
          // para el presupuesto del cron. Medido contra producción el 2026-09-15
          // con `topeDias: 15`: **5,3 a 11,9 s por cuartel** contra **1,5 s** de
          // las dos `getIndices` en paralelo. La razón es que `getDeltaArea`
          // encadena hasta cuatro viajes a GEE (escenas → ventana actual →
          // ventana anterior → medición) y no puede paralelizarlos: cada uno
          // decide el siguiente. Con 55 cuarteles y `CONCURRENCIA_CUARTELES = 4`
          // son ~14 tandas: el bucle pasa de ~21 s a ~105 s en el caso medio, y
          // el `PRESUPUESTO_MS` de 240 s deja de tener el margen que tenía.
          // Si algún día aprieta, lo que sobra es el sondeo de escenas: con tope
          // 15 la escalera es [10, 15] y se podrían pedir las dos ventanas de una.
          getDeltaArea({ polygon: campo.polygon_coords, dias: DELTA_DIAS, topeDias: DELTA_TOPE_ALERTA_DIAS })
            .catch(e => ({ error: e.message })),
        ]);
        curNdvi = cur.ndvi;
        if (cur.ndvi != null) {
          // Sin pasada limpia en la ventana de la alerta no se inventa nada: se
          // cuenta y se sigue. Es un estado del cielo, no del cuartel.
          if (area.sin_pasada || area.error) {
            resumen.ndvi_sin_pasada = (resumen.ndvi_sin_pasada || 0) + 1;
          } else if (area.area_caida != null) {
            const pct = Math.round(area.area_caida * 100);
            // El porcentaje sobre cuatro píxeles no es una anomalía: es ruido.
            const cobertura = area.cobertura;
            const tapado = cobertura != null && cobertura < COBERTURA_MINIMA;
            if (tapado) resumen.ndvi_sin_cobertura = (resumen.ndvi_sin_cobertura || 0) + 1;

            const supera = area.area_caida > umbral.area_delta && !tapado;
            const estacional = supera && await pareceCaidaEstacional(campo.id, cur.ndvi, todayISO);
            if (estacional) resumen.ndvi_estacional = (resumen.ndvi_estacional || 0) + 1;
            if (supera && !estacional) {
              // El `{{2}}` de la plantilla sigue siendo la caída de VIGOR y no el
              // % de área: el cuerpo aprobado por Meta dice "el vigor del cultivo
              // bajó un {{2}}%", y poner ahí el área diría una cosa por otra.
              //
              // Se usa `delta_medio_caida` —cuánto bajó DONDE bajó— y no
              // `delta_medio`, que es la media del cuartel entero. Medido contra
              // producción el 2026-09-14 en el cuartel "carnes": 52,5 % del área
              // caída con `delta_medio` de **+0,0052**. O sea que el promedio
              // SUBE mientras media hectárea pierde vigor — el caso exacto que
              // motivó cambiar el criterio. Con la media del cuartel, la
              // plantilla habría dicho "el vigor bajó un 0%" junto a una imagen
              // medio roja. Con la de la zona caída dice 8 %, que es verdad.
              //
              // La base es el NDVI del cuartel y no el de la zona caída (sería un
              // nodo más para afinar un denominador): el error es de segundo
              // orden y va hacia el lado conservador.
              const caida = area.delta_medio_caida != null ? Math.abs(area.delta_medio_caida) : null;
              const base = (area.ndvi_actual != null && caida != null) ? area.ndvi_actual + caida : null;
              const drop = (base != null && base > 0) ? caida / base : null;
              const dias = area.ventanas?.actual?.dias || DELTA_DIAS;
              avisos.push({
                tipo: 'ndvi', titulo: 'Aviso del satélite', fuente: 'Google Earth Engine',
                // El % de ÁREA sí va acá: esto es lo que se lee en /app y lo que
                // sale por WhatsApp cuando la ventana de 24 h está abierta.
                //
                // Cierra invitando a pedir la imagen porque la imagen NO puede ir
                // adjunta a una plantilla —no hay ninguna aprobada con header de
                // imagen— y responder es lo que abre la ventana de 24 h por la
                // que el bot sí puede mandarla.
                //
                // "dónde bajó" y no "mapa" a secas: es una de las frases que la
                // descripción de `enviar_mapa_delta_campo` declara como
                // disparador, y "mapa" solo es ambiguo con el NDVI actual
                // (`enviar_imagen_indice_campo`), que es otra imagen y no
                // contesta esta pregunta.
                contenido: `🛰️ *Satélite* — "${nombre}": el ${pct}% del cuartel perdió vigor de forma`
                  + ` marcada respecto de la pasada anterior (últimos ${dias} días).`
                  + (drop != null ? ` El vigor medio bajó ${Math.round(drop * 100)}%.` : '')
                  + ` Respondé "dónde bajó en ${nombre}" y te mando el mapa para ver qué sector es.`,
                templateParams: [nombre, drop != null ? Math.round(drop * 100) : pct],
              });
            }
          }
          // Guardar la lectura nueva en el historial (los 6 índices, no solo NDVI).
          // En `?dry=1` no: ese modo se documenta —y se usa— como "muestra qué
          // mandaría sin tocar nada", y esta era la única escritura que se le
          // escapaba. Correr el dry para revisar el agrupamiento dejaba una fila
          // del día en `ndvi_history` de cada cuartel.
          if (!isDry) {
            try {
              await sbUpsert('ndvi_history', [{
                field_id: campo.id, fecha: todayISO,
                ndvi: cur.ndvi, ndre: cur.ndre, evi: cur.evi, msavi: cur.msavi, tcari: cur.tcari, ndmi: cur.ndmi,
              }], 'field_id,fecha');
            } catch (_) {}
          }
        }
      }

      // Boletín semanal (lunes) — incluye horas frío y comparación de temporada si están activas
      if (prefs.boletin.resumen_semanal && (esLunes || isTest)) {
        const partes = [];
        if (clima.tminProx != null) partes.push(`mín ${clima.tminProx}°C`);
        if (clima.tmaxProx != null) partes.push(`máx ${clima.tmaxProx}°C`);
        if (clima.precip7d != null) partes.push(`lluvia 7 días ${clima.precip7d} mm`);

        let extra = '';
        if (prefs.clima.horas_frio) {
          // Misma estación y misma serie que el gráfico de /app (2026-09-24).
          // La ventana va dicha: en septiembre "acumuladas" a secas se leía
          // como "hasta hoy", y la temporada de frío cierra el 31 de julio.
          const { horas } = await horasFrioAcumuladas(cen);
          if (horas != null) extra += ` Horas frío de la temporada (1 may-31 jul): ${horas} h.`;
        }
        if (prefs.satelital.comparacion_temporada) {
          // El texto del gráfico de /app, no uno propio: `compararGradosDia`
          // (Open-Meteo, mínimo de 100 °D) decía "todavía no hay acumulación
          // suficiente" el mismo día que la pantalla decía "atrasada ~5 días"
          // (2026-09-24). Solo si falla se cae al cálculo por coordenadas.
          const agro = await agroclimDeCampo(campo).catch(() => null);
          const texto = agro && agro.comparacionTemporada
            ? agro.comparacionTemporada.texto
            : (await compararGradosDia(cen)).texto;
          if (texto) extra += ` ${texto}`;

          // Backfill: comparar NDVI actual vs. el mismo período del año anterior
          // (poblado por cron/backfill-field.js — puede no existir aún para este cuartel).
          if (curNdvi != null) {
            const unAnioAtras = new Date(Date.now() - 365 * 86400000);
            const desde = new Date(unAnioAtras - 20 * 86400000).toISOString().split('T')[0];
            const hasta = new Date(unAnioAtras.getTime() + 20 * 86400000).toISOString().split('T')[0];
            try {
              // `limit: 1` con `order: fecha.asc` devolvía la lectura MÁS VIEJA
              // de la ventana de ±20 días, es decir hasta 20 días antes del
              // aniversario. En primavera, con el NDVI subiendo rápido, eso
              // infla la caída reportada. Ahora se compara contra la lectura
              // más CERCANA al aniversario (misma regla que usa el bot).
              const histRows = await sbSelect('ndvi_history', {
                select: 'ndvi,fecha', field_id: `eq.${campo.id}`,
                and: `(fecha.gte.${desde},fecha.lte.${hasta})`, order: 'fecha.asc',
              });
              const ndviAnioAnterior = lecturaMasCercana(histRows, unAnioAtras.toISOString().split('T')[0])?.valor;
              if (ndviAnioAnterior != null && ndviAnioAnterior > 0) {
                const diffPct = Math.round(((curNdvi - ndviAnioAnterior) / ndviAnioAnterior) * 100);
                if (diffPct !== 0) {
                  extra += ` Vigor satelital ${diffPct > 0 ? 'mejor' : 'menor'} que el año pasado en la misma época (${Math.abs(diffPct)}%).`;
                }
              }
            } catch (_) { /* sin backfill aún para este cuartel */ }
          }
        }

        const detalleBoletin = `${partes.join(', ') || 'sin datos de clima'}.${extra}`;
        avisos.push({
          tipo: 'boletin', titulo: 'Resumen semanal', fuente: 'SmartField',
          // El boletín se identifica por su SEMANA, no por el día: si el cron
          // falla el lunes y se reintenta el martes, sale una vez, no dos.
          periodo: semanaISO(new Date()),
          contenido: `📋 *Resumen semanal* — "${nombre}": ${detalleBoletin} — SmartField INIA`,
          // La plantilla solo admite 3 números fijos (min/máx/lluvia); el resto
          // del detalle (horas frío, comparación de temporada) queda en
          // `contenido`/tabla `alerts`, visible en la app pero no en el WhatsApp.
          templateParams: [
            nombre,
            clima.tminProx ?? 'sin dato',
            clima.tmaxProx ?? 'sin dato',
            clima.precip7d ?? 'sin dato',
            // {{5}}: horas frío, adelanto/atraso de temporada y vigor vs. el
            // año pasado — lo mismo que va en `contenido`. Al agrupar varios
            // cuarteles en un mensaje, viaja el del primero, igual que los
            // números de clima.
            detalleAgronomico(extra),
          ],
        });
      }

      // Lo que el informe semanal necesita de este cuartel, tomado de lo que ya
      // se calculó arriba. El boletín (tipo `boletin`) se excluye: no es una
      // señal de terreno, es el resumen que se manda por WhatsApp.
      if (!porUsuario.has(campo.user_id)) {
        porUsuario.set(campo.user_id, { perfil, prefs, phone, unidades: [] });
      }
      porUsuario.get(campo.user_id).unidades.push(
        unidadDeInforme({ campo, orden, avisos, riesgo, clima, umbral, ndviActual: curNdvi }));

      // ── Despachar cada aviso ────────────────────────────────────────────
      //
      // Idempotencia (FR-AL-01): la clave es campo + tipo + PERÍODO + versión
      // de regla, no "usuario + tipo + hoy". Dos consecuencias buscadas:
      //   · si mañana cambian los umbrales, `rule_version` cambia y una alerta
      //     generada con el criterio nuevo NO queda silenciada por una vieja;
      //   · el boletín semanal se identifica por su semana, no por el día en
      //     que se mandó, así que reintentarlo el martes no lo duplica.
      for (const a of avisos) {
        resumen.avisos++;
        const periodo = a.periodo || todayISO;
        const claveAlerta = `${campo.id}|${a.tipo}|${periodo}|${RULE_VERSION}`;

        // Anti-repetido dentro de la misma corrida.
        if (yaEnviadoRun.has(claveAlerta)) continue;
        yaEnviadoRun.add(claveAlerta);

        if (!isTest) {
          const yaExiste = await sbSelect('alerts', {
            select: 'id', dedupe_key: `eq.${claveAlerta}`, limit: 1,
          }).catch(async () => {
            // Sin la migración v9 no existe la columna: se cae al criterio
            // anterior (por cuartel y día) para no dejar de deduplicar.
            return sbSelect('alerts', {
              select: 'id', user_id: `eq.${campo.user_id}`, tipo: `eq.${a.tipo}`,
              field_id: `eq.${campo.id}`, created_at: `gte.${todayISO}`, limit: 1,
            });
          });
          if (yaExiste.length) continue;

          // Además de la clave exacta: ¿ya se avisó lo mismo hace poco?
          const silencio = SILENCIO_DIAS[a.tipo];
          if (silencio) {
            const desdeISO = new Date(Date.now() - silencio * 86400000).toISOString();
            const reciente = await sbSelect('alerts', {
              select: 'id', field_id: `eq.${campo.id}`, tipo: `eq.${a.tipo}`,
              created_at: `gte.${desdeISO}`, limit: 1,
            }).catch(() => []);
            if (reciente.length) { resumen.ndvi_silenciado = (resumen.ndvi_silenciado || 0) + 1; continue; }
          }
        }

        // La alerta se guarda SIEMPRE, haya canal o no. Antes, un usuario sin
        // WhatsApp no generaba ninguna fila, así que tampoco la veía en la app
        // —donde sí puede leerlas—; ahora existe, y su entrega queda como
        // `not_requested`.
        let alertId = null;
        // Avisos que viven solo en la app (hoy, la demanda de agua): no entran
        // al plan de WhatsApp ni de correo, ni se copian al asesor.
        if (isDry && a.soloApp) continue;
        if (isDry) {
          pendientesWhatsApp.push({
            userId: campo.user_id, tipo: a.tipo, periodo, rol: 'productor', orden,
            phone: prefs.canales.whatsapp !== false ? phone : null,
            tpl: ALERT_TEMPLATES[a.tipo], params: a.templateParams, alertId: null, cuartel: nombre,
            predioId: campo.predio_id || null, predioNombre: campo.predio_nombre || null,
          });
          // El correo también entra al plan: es el canal que se desbordó a 32
          // mensajes, así que tiene que poder revisarse sin mandar nada.
          if (a.fechaEvento && prefs.canales.email !== false) {
            pendientesEmail.push({
              userId: campo.user_id, tipo: a.tipo, periodo: a.fechaEvento, orden,
              aviso: a, cuartel: nombre, alertId: null,
              predioId: campo.predio_id || null, predioNombre: campo.predio_nombre || null,
            });
          }
          continue;
        }
        try {
          const fila = {
            user_id: campo.user_id, field_id: campo.id,
            tipo: a.tipo, titulo: a.titulo, contenido: a.contenido, fuente: a.fuente,
            leido: false, rule_version: RULE_VERSION, periodo, dedupe_key: claveAlerta,
          };
          let creada;
          try {
            [creada] = await sbInsert('alerts', fila);
          } catch (e) {
            if (!/rule_version|periodo|dedupe_key/.test(e.message)) throw e;
            // Migración v9 sin aplicar: insertar sin las columnas nuevas.
            const { rule_version, periodo: _p, dedupe_key, ...legado } = fila;
            [creada] = await sbInsert('alerts', legado);
          }
          alertId = creada?.id || null;
        } catch (e) { resumen.errores.push(`alert insert (${a.tipo}): ${e.message}`); }

        const tpl = ALERT_TEMPLATES[a.tipo];
        if (a.soloApp) {
          await registrarEntrega(alertId, {
            rol: 'productor', estado: 'not_requested', plantilla: null,
            error: 'aviso solo en la app: no sale por WhatsApp ni por correo (2026-09-24)',
          });
          resumen.entregas.not_requested++;
          continue;
        }
        // WhatsApp: solo si el evento cae dentro del horizonte que la plantilla
        // aprobada describe bien ("esta noche"). Los avisos que no son de
        // pronóstico (sequía, NDVI, boletín) no traen `fechaEvento` y salen
        // como siempre.
        const dias = diasHasta(a.fechaEvento);
        const plantillaSirve = a.fechaEvento == null || (dias != null && dias <= DIAS_PLANTILLA_WHATSAPP);
        const mandaWhatsApp = plantillaSirve && prefs.canales.whatsapp !== false;
        if (mandaWhatsApp) {
          pendientesWhatsApp.push({
            userId: campo.user_id, tipo: a.tipo, periodo, rol: 'productor', orden,
            phone, tpl, params: a.templateParams, alertId, cuartel: nombre,
            predioId: campo.predio_id || null, predioNombre: campo.predio_nombre || null,
          });
        } else {
          await registrarEntrega(alertId, {
            rol: 'productor', estado: 'not_requested', plantilla: tpl?.name,
            error: plantillaSirve
              ? 'el usuario desactivó el canal WhatsApp'
              : `evento a ${dias} días: no hay plantilla de WhatsApp con fecha`,
          });
          resumen.entregas.not_requested++;
        }

        // Correo (segundo canal, pedido de Stanley el 2026-08-05): va para los
        // avisos de pronóstico, y es el ÚNICO canal capaz de decir "el jueves"
        // mientras no existan plantillas de WhatsApp con la fecha adentro.
        if (a.fechaEvento && prefs.canales.email !== false) {
          pendientesEmail.push({
            userId: campo.user_id, tipo: a.tipo, periodo: a.fechaEvento, orden,
            aviso: a, cuartel: nombre, alertId,
            predioId: campo.predio_id || null, predioNombre: campo.predio_nombre || null,
          });
        }

        // Copia al/los asesor(es) vinculados que la pidieron (misma plantilla,
        // con el nombre del productor sumado al cuartel — {{1}} — para
        // identificarlo). Cada copia es una entrega propia con su estado.
        for (const advisorId of advisorIdsByProducer[campo.user_id] || []) {
          const advisorPhone = advisorPhones[advisorId];
          if (!advisorPhone || advisorPhone === phone) continue;
          pendientesWhatsApp.push({
            userId: campo.user_id, tipo: a.tipo, periodo, rol: 'asesor', orden,
            phone: advisorPhone, tpl, params: a.templateParams, alertId, cuartel: nombre,
            predioId: campo.predio_id || null, predioNombre: campo.predio_nombre || null,
            // El nombre del productor se agrega al rotular el grupo, para que
            // el asesor sepa de quién es sin abrir la app.
            prefijoProductor: perfil.nombre || 'N/D',
          });
        }
      }
    };

    // ── Recorrido con concurrencia acotada ──────────────────────────────
    //
    // Esto era un `for` en serie, y cada vuelta espera tres consultas a GEE más
    // el pronóstico: con 49 cuarteles la corrida pasó de 155 s a 177 s al sumar
    // la máscara de nubes, contra el `maxDuration` de 300 s del plan Hobby — y
    // una corrida ya se pasó. Pasarse no reparte el daño: mueren las alertas de
    // los ÚLTIMOS cuarteles, siempre los mismos, y nada lo dice.
    //
    // La concurrencia es baja a propósito: cada cuartel son ~4 llamadas a GEE y
    // Open-Meteo, y no se gana nada yendo más rápido si el proveedor empieza a
    // contestar 429. El deadline es la otra mitad: si el presupuesto se agota,
    // los cuarteles que faltan quedan CONTADOS en el resumen en vez de
    // desaparecer dentro de un 504 mudo.
    const deadline = Date.now() + PRESUPUESTO_MS;
    let siguiente = 0;
    const trabajador = async () => {
      while (siguiente < campos.length) {
        if (Date.now() > deadline) {
          resumen.sin_procesar = campos.length - siguiente;
          siguiente = campos.length;
          return;
        }
        const idx = siguiente++;
        try {
          await procesarCuartel(campos[idx], idx);
        } catch (e) {
          resumen.errores.push(`cuartel ${campos[idx]?.nombre || campos[idx]?.id}: ${e.message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCIA_CUARTELES, campos.length) }, trabajador));
    if (resumen.sin_procesar) {
      console.error(`[check-alerts] presupuesto agotado: ${resumen.sin_procesar} cuarteles sin procesar`);
    }

    // El orden original importa para el mensaje agrupado: el cuartel que
    // encabeza el grupo es el que aporta los números del boletín y el que
    // aparece entre paréntesis en el rótulo. Sin reordenar, el representativo
    // cambiaría de corrida en corrida según quién terminara antes.
    pendientesWhatsApp.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    pendientesEmail.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    for (const datos of porUsuario.values()) {
      datos.unidades.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    }

    // ── Informe semanal de terreno ──────────────────────────────────────
    //
    // Va acá, después del bucle: se arma UNO por usuario con lo que el bucle ya
    // calculó (clima, umbrales, riesgo a 5 días, NDVI y avisos por cuartel).
    //
    // **Ya no es gratis en red, y el matiz importa.** Desde que se arregló el
    // bug de `serieNdvi`, `generarInformeSemanal` pide además el histórico de
    // NDVI en lotes de 8 cuarteles (`cargarSeriesNdvi`): ~5 requests a
    // PostgREST para la cartera de 35, una vez por semana y DESPUÉS del bucle,
    // o sea fuera del presupuesto que se pelea con GEE. Sin eso el informe no
    // tiene tendencia, que era medio informe.
    //
    // Sale los lunes, igual que el boletín, y con la misma idempotencia por
    // semana ISO: reintentar el martes no lo duplica.
    if ((esLunes || isTest) && !isDry) {
      const semanaActual = semanaISO(new Date());
      for (const [userId, datos] of porUsuario) {
        if (!datos.prefs.boletin.resumen_semanal) continue;
        // ── Un informe por PREDIO (Stanley, 2026-09-14) ──────────────────
        //
        // Antes salía uno por usuario con todos los campos mezclados en la misma
        // tabla, y los tres gráficos agroclimáticos más el pronóstico se armaban
        // con `filas[0]` —el cuartel que encabeza la visita—, así que con dos
        // predios a 80 km el clima del PDF era el de uno solo y el otro leía un
        // pronóstico que no era el suyo. Agrupando por predio eso se arregla sin
        // tocar el modelo: `filas[0]` ya es de este campo.
        //
        // El agrupamiento se replica acá porque `agruparPorPredio` vive en
        // `public/app.html`, que es un monolito sin build y no se puede importar.
        // El criterio del nombre es el mismo que allá: sale del primer cuartel
        // que lo tenga, porque una fila vieja puede venir con `predio_id` y sin
        // `predio_nombre`.
        const porPredio = agruparUnidadesPorPredio(datos.unidades);

        // Las dos cargas de red, UNA vez por usuario y no una por predio: las
        // series van en lotes de 8 por el tope de 1.000 filas de PostgREST, y
        // `calcularAgroclim` agrupa por clima, así que pedir todo junto es más
        // barato que pedirlo por partes. El tope de climas sube al número de
        // predios: el 3 por defecto protege al dashboard (24 s), no a este cron.
        let precargado;
        try {
          precargado = await precargarInforme(datos.unidades, todayISO, { topeClimas: Math.max(3, porPredio.length) });
        } catch (err) {
          resumen.errores.push(`informe ${userId}: precarga ${err.message}`);
          continue;
        }

        let correo = null, correoResuelto = false;
        for (const { predioId, nombre: predioNombre, unidades } of porPredio) {
          try {
            const gen = await generarInformeSemanal({
              userId,
              titular: predioNombre,
              productor: datos.perfil.nombre || 'Productor',
              scope: 'predio',
              periodo: semanaActual,
              hasta: todayISO,
              unidades,
              precargado,
            });
            if (gen.ok && gen.modelo.resumen.sinSerie === gen.modelo.resumen.unidades) {
              // Salió un informe entero sin una sola serie de NDVI. Puede ser un
              // usuario nuevo sin histórico, o puede ser que la carga en lote se
              // haya roto — que fue el bug que dejó la columna de tendencia
              // muerta durante semanas sin que nada lo dijera. Se grita acá en
              // vez de imprimirse como "— sin señal" en cada fila del PDF.
              resumen.errores.push(`informe ${userId}/${predioNombre}: ningún cuartel con serie NDVI`);
            }
            if (!gen.ok) { resumen.informes_omitidos = (resumen.informes_omitidos || 0) + 1; continue; }

            // Se registra como alerta para que quede visible en /app aunque el
            // correo falle: el informe existe, lo haya recibido o no.
            //
            // La clave lleva el PREDIO: sin eso, el índice único parcial de
            // `dedupe_key` (migración v9) deja pasar el primer predio de la
            // semana y bloquea en silencio a todos los demás.
            const clave = claveInforme(userId, predioId, semanaActual);
            const yaHay = isTest ? [] : await sbSelect('alerts', {
              select: 'id', dedupe_key: `eq.${clave}`, limit: 1,
            }).catch(() => []);
            if (yaHay.length) continue;

            let alertId = null;
            if (!isTest) {
              const [creada] = await sbInsert('alerts', [{
                user_id: userId, field_id: unidades[0]?.campo?.id || null,
                tipo: 'informe', titulo: `Informe semanal de terreno — ${predioNombre}`,
                contenido: textoInforme(gen.modelo), fuente: 'SmartField',
                rule_version: RULE_VERSION, periodo: semanaActual, dedupe_key: clave,
              }]).catch(err => {
                console.warn(`[informe] no se pudo registrar: ${err.message}`);
                return [];
              });
              alertId = creada?.id || null;
            }

            // El PDF va por correo, que es el único canal que hoy puede llevarlo:
            // por WhatsApp, fuera de la ventana de 24 h solo salen plantillas, y
            // ninguna de las aprobadas tiene header de documento.
            if (datos.prefs.canales.email !== false) {
              // El correo del usuario se resuelve UNA vez: `emailDeUsuario` pega
              // a la Admin API de Supabase y el dato es el mismo para todos sus
              // predios.
              if (!correoResuelto) { correo = await emailDeUsuario(userId).catch(() => null); correoResuelto = true; }
              const env = await enviarInformePorCorreo({ userId, ...gen, email: correo });
              resumen.informes = (resumen.informes || 0) + (env.ok ? 1 : 0);
              if (!env.ok) resumen.errores.push(`informe ${userId}/${predioNombre}: ${env.error}`);
              // Que quede en la base si llegó o no. Hasta el 2026-09-14 el
              // informe era el único envío que no dejaba rastro —solo las
              // alertas registraban entrega—, y con un correo por predio esa
              // ceguera se multiplica.
              await registrarEntrega(alertId, {
                canal: 'email', destinatario: correo, rol: 'productor',
                estado: env.ok ? 'sent' : 'failed', proveedor_id: env.id || null,
                error: env.ok ? null : String(env.error || '').slice(0, 300),
              });
            }
          } catch (err) {
            // Un informe que falla no puede voltear la corrida de alertas, ni
            // llevarse puestos a los otros predios del mismo usuario.
            console.warn(`[informe] ${userId}/${predioNombre}: ${err.message}`);
            resumen.errores.push(`informe ${userId}/${predioNombre}: ${err.message}`);
          }
        }
      }
    }

    // Recién acá salen los WhatsApp, uno por (usuario, campo, tipo, período, número).
    if (isDry) {
      return res.status(200).json({
        ok: true, dry: true, ...resumen,
        plan: planDeEnvio(pendientesWhatsApp),
        plan_correos: planDeCorreos(pendientesEmail),
        // En modo simulación el informe se arma pero no se guarda ni se manda:
        // así se puede ver a quién le tocaría y con qué prioridades.
        informes: [...porUsuario].map(([id, d]) => ({ userId: id, cuarteles: d.unidades.length })),
      });
    }
    await despacharAgrupado(pendientesWhatsApp, resumen);
    await despacharCorreos(pendientesEmail, resumen);

    return res.status(200).json({ ok: true, ...resumen });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, ...resumen });
  }
};

// Se cuelgan del handler exportado (Vercel solo mira la función) para poder probar
// la normalización del 5º parámetro sin red — ver scripts/probar-calculos.js § 12.
module.exports.detalleAgronomico = detalleAgronomico;
// Expuesta para el arnés: fija el contrato cron ↔ informe sin necesitar red.
module.exports.unidadDeInforme = unidadDeInforme;
module.exports.SIN_DETALLE_AGRONOMICO = SIN_DETALLE_AGRONOMICO;
// Expuestas para el arnés: el informe se escribe en `alerts` solo fuera de
// `?test=1`, así que el agrupamiento y la clave de idempotencia no se pueden
// observar desde la respuesta del handler.
module.exports.agruparUnidadesPorPredio = agruparUnidadesPorPredio;
module.exports.claveInforme = claveInforme;
module.exports.SIN_PREDIO = SIN_PREDIO;
module.exports.COBERTURA_MINIMA = COBERTURA_MINIMA;

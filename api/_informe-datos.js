// ════════════════════════════════════════════════════════════════════════
// api/_informe-datos.js — de los datos crudos al MODELO del informe semanal.
//
// Separado del dibujo a propósito: acá se decide QUÉ dice el informe (a qué
// cuartel hay que ir primero y por qué), y en `_informe-layout.js` se decide
// cómo se ve. Así el modelo se puede inspeccionar, guardar en `weekly_reports` y
// comparar entre semanas sin renderizar nada.
//
// **No inventa ni un umbral.** Todos los cortes salen de donde ya estaban:
//   - severidad de helada/calor/hídrico/térmica → `_riesgo.js` (NIVELES, cortes)
//   - qué nivel amerita aviso                   → medio y alto, como el cron
//   - caída de NDVI que se considera fuerte     → `_umbrales.js` (0,15 = 15 %)
//   - "viene cayendo"                           → `_vigor.js` (misma regla que
//                                                  la tabla "Cuarteles en baja")
//
// Helper con `_`: no consume cupo de funciones serverless.
// ════════════════════════════════════════════════════════════════════════

const { UMBRAL_DEFECTO } = require('./_umbrales');
const { deltasDeCuartel, enBaja, peorDelta, saltoSospechoso } = require('./_vigor');
const { limpiar } = require('./_informe-fuente');

// Mismos dos niveles que disparan notificación en `cron/check-alerts.js:201`.
const NIVEL_AVISA = new Set(['medio', 'alto']);

const PRIORIDADES = ['ALTA', 'MEDIA-ALTA', 'MEDIA-BAJA', 'BAJA'];
const ORDEN_PRIORIDAD = Object.fromEntries(PRIORIDADES.map((p, i) => [p, i]));

function mediana(nums) {
  const xs = nums.filter(n => n != null && Number.isFinite(n)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

// El peor de dos niveles de riesgo, para la columna "riesgo clima".
const ORDEN_NIVEL = { sin_dato: 0, bajo: 1, medio: 2, alto: 3 };
function peorNivel(a, b) {
  return (ORDEN_NIVEL[b] || 0) > (ORDEN_NIVEL[a] || 0) ? (b || 'sin_dato') : (a || 'sin_dato');
}

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// "hoy" / "mañana" / "el martes 9". El asesor lee esto en terreno y lo que
// necesita saber es cuándo salir, no una fecha ISO.
function cuandoCorto(fechaISO, hoyISO) {
  if (!fechaISO) return null;
  const f = new Date(String(fechaISO) + 'T12:00:00Z');
  if (Number.isNaN(f.getTime())) return null;
  if (hoyISO) {
    const hoy = new Date(String(hoyISO) + 'T12:00:00Z');
    if (!Number.isNaN(hoy.getTime())) {
      const dif = Math.round((f - hoy) / 86400000);
      if (dif === 0) return 'hoy';
      if (dif === 1) return 'mañana';
    }
  }
  return `el ${DIAS_SEMANA[f.getUTCDay()]} ${f.getUTCDate()}`;
}

// Cómo se lee una alerta dentro del motivo.
//
// El aviso llega con `valor`, `unidad`, `nivel` y `fechaEvento` desde el cron,
// que es donde se evaluó el umbral. La FRASE se arma acá y no allá a propósito:
// el cron ya redacta su propia versión para WhatsApp, y una segunda redacción
// en ese archivo sería una copia que puede divergir de esta sin que nadie lo
// note. El cron aporta los hechos; el informe decide cómo se leen.
//
// Antes esta función no existía y el motivo mostraba el título crudo ("Aviso de
// helada"), porque la rama que buscaba el detalle miraba `a.detalleInforme`, un
// campo que no se asignaba en ninguna parte del repo.
function fraseDeAlerta(a, hoyISO) {
  const cuando = cuandoCorto(a.fechaEvento, hoyISO);
  const val = a.valor != null && Number.isFinite(Number(a.valor))
    ? String(a.valor).replace('.', ',') : null;
  const unidad = a.unidad || '°C';
  if (a.tipo === 'helada' && val) return `helada: mínima ${val} ${unidad}${cuando ? ` ${cuando}` : ''}`;
  if (a.tipo === 'calor'  && val) return `calor: máxima ${val} ${unidad}${cuando ? ` ${cuando}` : ''}`;
  if (a.detalle) return limpiar(a.detalle);
  return a.titulo ? limpiar(a.titulo) : null;
}

// ── Agregados de la cartera ─────────────────────────────────────────────

// El lunes de la semana a la que pertenece una fecha, como clave de agrupación.
function lunesDe(fechaISO) {
  const d = new Date(String(fechaISO) + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// Curva de vigor de la cartera: la mediana de las lecturas de cada semana.
//
// Se agrupa por SEMANA y no por día porque Sentinel-2 pasa cada ~5 días y la
// nubosidad corre las fechas: una curva diaria dibujaría el calendario de
// pasadas del satélite, no el estado del cultivo. La mediana —y no el
// promedio— porque un cuartel recién plantado o uno en cosecha no tienen que
// arrastrar a toda la cartera.
function serieSemanalDeCartera(unidades) {
  const porSemana = new Map();
  for (const u of (unidades || [])) {
    for (const r of (u.serieNdvi || [])) {
      if (r == null || r.ndvi == null) continue;
      const semana = lunesDe(r.fecha);
      if (!semana) continue;
      if (!porSemana.has(semana)) porSemana.set(semana, []);
      porSemana.get(semana).push(r.ndvi);
    }
  }
  return [...porSemana.entries()]
    .map(([semana, vals]) => ({ semana, ndvi: mediana(vals), n: vals.length }))
    .sort((a, b) => (a.semana < b.semana ? -1 : a.semana > b.semana ? 1 : 0));
}

// Estadísticas descriptivas de la cartera. `sinLectura` y `sinTendencia` no son
// relleno: con la máscara de nubes por píxel, en invierno hay cuarteles sin una
// sola captura limpia, y decir cuántos son evita que el informe se lea como si
// hubiera mirado todo.
function estadisticasDe(filas) {
  const ndvis = filas.map(f => f.ndvi).filter(n => n != null && Number.isFinite(n));
  const porCultivo = new Map();
  for (const f of filas) {
    const k = f.cultivo || 'sin especificar';
    const acc = porCultivo.get(k) || { cultivo: k, cuarteles: 0, ha: 0 };
    acc.cuarteles++;
    acc.ha += f.areaHa || 0;
    porCultivo.set(k, acc);
  }
  const alertasPorTipo = {};
  for (const f of filas) {
    for (const a of (f.alertas || [])) alertasPorTipo[a.tipo] = (alertasPorTipo[a.tipo] || 0) + 1;
  }
  const superficie = filas.reduce((s, f) => s + (f.areaHa || 0), 0);
  return {
    ndviMediana: mediana(ndvis),
    ndviMin: ndvis.length ? Math.min(...ndvis) : null,
    ndviMax: ndvis.length ? Math.max(...ndvis) : null,
    superficieHa: superficie > 0 ? superficie : null,
    cultivos: [...porCultivo.values()].sort((a, b) => b.ha - a.ha || b.cuarteles - a.cuarteles),
    alertasPorTipo,
    sinLectura: filas.filter(f => f.ndvi == null).length,
    sinTendencia: filas.filter(f => f.tendenciaPct == null).length,
  };
}

// Los tres gráficos agroclimáticos son los del cuartel que encabeza la visita,
// por la misma razón que el pronóstico: es donde el asesor va a estar. Además
// `calcularAgroclim` ya agrupa por clima, así que los cuarteles vecinos
// comparten exactamente esta curva — mostrar una por cuartel sería repetir el
// mismo gráfico N veces.
//
// `origen` viene del cómputo y dice con qué cuartel se calculó y cuántos lo
// comparten: sin eso, un asesor con predios a 80 km podría leer la curva de uno
// como si fuera la de todos.
function agroclimDe(conVigor, filas) {
  const primera = filas[0];
  if (!primera) return null;
  const u = conVigor.find(x => x.campo && x.campo.id === primera.fieldId);
  const a = u && u.agroclim;
  if (!a || a.omitido) return null;
  return {
    cuartel: primera.cuartel,
    gdd: a.gdd || null,
    chill: a.chill || null,
    temps: a.temps || null,
    comparacionTemporada: a.comparacionTemporada || null,
    origen: a.origen || null,
  };
}

// El pronóstico que se grafica es el del cuartel que ENCABEZA la visita: es
// donde el asesor va a estar. Un promedio de la cartera no es una temperatura
// que le ocurra a ningún cuartel, y con predios a kilómetros de distancia
// tampoco sería una sola noche de helada.
function pronosticoDe(conVigor, filas) {
  const primera = filas[0];
  if (!primera) return null;
  const u = conVigor.find(x => x.campo && x.campo.id === primera.fieldId);
  const dias = u && u.riesgo ? u.riesgo.dias : null;
  if (!Array.isArray(dias) || dias.length < 2) return null;
  return {
    cuartel: primera.cuartel,
    umbralHelada: u.umbral ? u.umbral.helada ?? null : null,
    umbralCalor: u.umbral ? u.umbral.calor ?? null : null,
    dias: dias
      .filter(d => d && (d.tmin != null || d.tmax != null))
      .map(d => ({ fecha: d.fecha, tmin: d.tmin, tmax: d.tmax })),
  };
}

// ── Prioridad de un cuartel ─────────────────────────────────────────────
//
// ALTA        alerta activa esta semana (nivel medio o alto), o caída de vigor
//             que llega al mismo 15 % con el que dispara `alerta_satelital`.
// MEDIA-ALTA  viene cayendo Y su NDVI está por debajo de la mediana de la
//             cartera: cae desde un nivel ya bajo.
// MEDIA-BAJA  viene cayendo pero su NDVI sigue por encima de la mediana —
//             "caída leve, nivel aún alto, monitoreo de rutina".
// BAJA        ninguna señal.
//
// El corte entre las dos medias es RELATIVO a la cartera, no un umbral absoluto
// nuevo: qué es "NDVI bajo" depende del cultivo y de la época del año, y un
// número fijo acá sería una invención.
function prioridadDe({ alertas, vigor, ndviActual, medianaCartera, riesgoClima }) {
  const conAviso = (alertas || []).some(a => !a.nivel || NIVEL_AVISA.has(a.nivel));
  const caidaFuerte = peorDelta(vigor) != null && peorDelta(vigor) <= -(UMBRAL_DEFECTO.ndvi * 100);
  if (conAviso || caidaFuerte || NIVEL_AVISA.has(riesgoClima)) return 'ALTA';
  if (!enBaja(vigor)) return 'BAJA';
  if (ndviActual != null && medianaCartera != null && ndviActual < medianaCartera) return 'MEDIA-ALTA';
  return 'MEDIA-BAJA';
}

// Por qué está donde está. Frases cortas y concretas: el asesor las lee en
// terreno, no busca una explicación de la metodología.
function motivoDe({ alertas, vigor, riesgo, prioridad, hoyISO }) {
  const partes = [];

  for (const a of (alertas || [])) {
    const frase = fraseDeAlerta(a, hoyISO);
    if (frase) partes.push(frase);
  }

  if (riesgo && NIVEL_AVISA.has(riesgo.nivel)) {
    // Si la alerta de arriba ya nombró el fenómeno ("helada: mínima -2,4 °C"),
    // repetirlo acá da "helada …; riesgo medio de helada …" en la misma línea.
    const yaNombrado = (alertas || []).some(a => a.tipo === riesgo.tipo);
    partes.push(yaNombrado
      ? `riesgo ${riesgo.nivel} en el pronóstico a ${riesgo.dias} días`
      : `riesgo ${riesgo.nivel} de ${riesgo.tipo} en el pronóstico a ${riesgo.dias} días`);
  }

  const peor = peorDelta(vigor);
  if (peor != null) {
    const cuantas = vigor.deltas.findIndex(d => d && d.pct === peor) + 1;
    // Coma decimal: el informe lo lee gente en Chile, y "−14.5%" al lado de
    // "44,64 ha" en la misma fila se ve como un error de formato.
    //
    // Frase corta a propósito: el porcentaje y las capturas ya tienen su propia
    // columna en la tabla, y repetirlos en una oración larga inflaba el alto de
    // cada fila. Con 35 cuarteles, eso son páginas enteras de más.
    // En valor absoluto: "cae" ya dice la dirección, y "cae -7,6%" se lee como
    // una doble negación.
    const pct = String(Math.abs(peor)).replace('.', ',');
    partes.push(`cae ${pct}% en ${cuantas} ${cuantas === 1 ? 'captura' : 'capturas'}`);
  }

  // Un salto atípico hacia arriba en la lectura de referencia hunde la
  // comparación: decirlo evita mandar a alguien al campo por una nube.
  if (saltoSospechoso(vigor)) partes.push('lectura previa atípica: validar en terreno');

  if (!partes.length) {
    return prioridad === 'BAJA'
      ? 'Sin alertas ni caída de vigor detectada esta semana.'
      : 'Sin señales claras esta semana.';
  }
  const txt = partes.join('; ');
  return txt.charAt(0).toUpperCase() + txt.slice(1) + '.';
}

// ── Modelo del informe ──────────────────────────────────────────────────
//
// `unidades` viene del cron con lo que YA calculó dentro de su bucle: clima,
// riesgo a 5 días, NDVI y alertas por cuartel. El informe no agrega ni una
// llamada de red — ese es su presupuesto.
//
//   unidades: [{ campo, alertas, riesgo, serieNdvi, ndviActual, clima }]
function armarModelo({ titular, productor, scope, periodo, semana, generadoEl, hoyISO, unidades }) {
  const conVigor = (unidades || []).map(u => ({
    ...u,
    vigor: deltasDeCuartel(u.serieNdvi || [], 'ndvi'),
    ndviActual: u.ndviActual != null ? u.ndviActual
      : (u.serieNdvi || []).filter(r => r.ndvi != null).slice(-1)[0]?.ndvi ?? null,
  }));

  const med = mediana(conVigor.map(u => u.ndviActual));

  const filas = conVigor.map(u => {
    const riesgoClima = peorNivel(u.riesgo?.helada?.nivel, u.riesgo?.calor?.nivel);
    // `riesgo.dias` NO es el número de días: es la serie diaria del pronóstico,
    // un array de `{fecha, tmin, tmax, helada, calor}` (ver `_sensors.js`). El
    // horizonte se llama `horizonte_dias`. Leer el campo equivocado imprimía
    // "en el pronóstico a [object Object],[object Object],… días" en el PDF, en
    // el correo y en la tabla `alerts` que lee /app. La confusión es entendible:
    // el PARÁMETRO de entrada de `getRiesgoProximosDias` sí se llama `dias`.
    const horizonte = u.riesgo?.horizonte_dias ?? 5;
    const riesgoTop = (ORDEN_NIVEL[u.riesgo?.helada?.nivel] || 0) >= (ORDEN_NIVEL[u.riesgo?.calor?.nivel] || 0)
      ? { tipo: 'helada', nivel: u.riesgo?.helada?.nivel, dias: horizonte }
      : { tipo: 'calor',  nivel: u.riesgo?.calor?.nivel,  dias: horizonte };
    const prioridad = prioridadDe({
      alertas: u.alertas, vigor: u.vigor, ndviActual: u.ndviActual,
      medianaCartera: med, riesgoClima,
    });
    return {
      fieldId: u.campo.id,
      cuartel: limpiar(u.campo.nombre || 'Cuartel'),
      predio: limpiar(u.campo.predio_nombre || ''),
      cultivo: limpiar(u.campo.cultivo || ''),
      areaHa: u.campo.area_ha ?? null,
      prioridad,
      riesgoClima,
      ndvi: u.ndviActual,
      tendenciaPct: u.vigor ? (peorDelta(u.vigor) ?? (u.vigor.deltas[0]?.pct ?? null)) : null,
      capturasAtras: u.vigor ? (u.vigor.deltas.findIndex(d => d && d.pct === peorDelta(u.vigor)) + 1) || null : null,
      saltoRaro: saltoSospechoso(u.vigor),
      precip7d: u.clima ? u.clima.precip7d ?? null : null,
      umbralSequia: u.umbral ? u.umbral.sequia ?? null : null,
      motivo: motivoDe({ alertas: u.alertas, vigor: u.vigor, riesgo: riesgoTop, prioridad, hoyISO }),
      alertas: (u.alertas || []).map(a => ({
        tipo: a.tipo, titulo: limpiar(a.titulo || ''), nivel: a.nivel || null,
        valor: a.valor ?? null, unidad: a.unidad || null, fechaEvento: a.fechaEvento || null,
      })),
    };
  });

  // Orden de visita: primero la prioridad, y dentro de cada nivel la peor caída;
  // a igualdad, el cuartel más grande — es donde más se pierde.
  filas.sort((a, b) =>
    (ORDEN_PRIORIDAD[a.prioridad] - ORDEN_PRIORIDAD[b.prioridad]) ||
    ((a.tendenciaPct ?? 0) - (b.tendenciaPct ?? 0)) ||
    ((b.areaHa ?? 0) - (a.areaHa ?? 0)));
  filas.forEach((f, i) => { f.orden = i + 1; });

  const cuenta = p => filas.filter(f => f.prioridad === p).length;
  const conAlerta = filas.filter(f => f.alertas.length).length;
  const enCaida = filas.filter(f => f.tendenciaPct != null && f.tendenciaPct < 0).length;

  return {
    version: 2,
    scope, periodo, semana, generadoEl,
    titular: limpiar(titular || ''),
    // De quién es el predio. Desde que hay un informe por campo, `titular` es el
    // NOMBRE DEL CAMPO, así que sin esto el PDF no dice a quién pertenece — y un
    // asesor que recibe copia vería tres informes de tres predios sin saber de
    // qué productor son. Vacío cuando coincide con el titular (el caso de la
    // cartera de asesor, donde el titular ya es la persona).
    productor: limpiar(productor || ''),
    resumen: {
      unidades: filas.length,
      conAlerta, enCaida,
      alta: cuenta('ALTA'), mediaAlta: cuenta('MEDIA-ALTA'),
      mediaBaja: cuenta('MEDIA-BAJA'), baja: cuenta('BAJA'),
      // Cuántos cuarteles llegaron SIN serie de NDVI. Existe para que el bug de
      // "el cron nunca pasó `serieNdvi`" no pueda volver a ser invisible: si
      // vale lo mismo que `unidades`, el informe salió sin una sola tendencia y
      // el cron lo dice en su resumen en vez de imprimir "— sin señal" 35 veces.
      sinSerie: conVigor.filter(u => !u.vigor).length,
      texto: textoEjecutivo({ filas, conAlerta, enCaida }),
    },
    estadisticas: estadisticasDe(filas),
    acciones: accionesDe(filas, hoyISO),
    // Lo que alimenta los gráficos. Vive en el modelo y no en el layout porque
    // el modelo es lo que se puede guardar, inspeccionar y comparar entre
    // semanas; el layout solo lo dibuja.
    pronostico: pronosticoDe(conVigor, filas),
    agroclim: agroclimDe(conVigor, filas),
    serieCartera: serieSemanalDeCartera(conVigor),
    filas,
  };
}

// ── Qué hacer esta semana ───────────────────────────────────────────────
//
// El informe respondía "a cuál voy primero" con una tabla, y nada más. Con una
// cartera de un cuartel eso es una fila y media página en blanco. Estas son las
// frases accionables, derivadas de los MISMOS datos de la tabla — no hay
// criterio nuevo acá, hay redacción.
//
// Enumerar cuarteles: hasta tres por nombre, y de ahí en más "y N más". Una
// acción que arranca listando treinta y cinco nombres deja de ser una acción.
function enumerar(nombres) {
  const xs = nombres.filter(Boolean);
  if (!xs.length) return '';
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return `${xs[0]} y ${xs[1]}`;
  if (xs.length === 3) return `${xs[0]}, ${xs[1]} y ${xs[2]}`;
  return `${xs[0]}, ${xs[1]} y ${xs.length - 2} más`;
}

// "antes del miércoles 9" / "hoy mismo" / "antes de mañana". `cuandoCorto`
// devuelve la frase con su propio artículo ("el miércoles 9"), así que
// concatenar "antes de" a secas produce "antes de el miércoles".
function plazo(cuando) {
  if (!cuando) return '';
  if (cuando === 'hoy') return ' hoy mismo';
  if (cuando === 'mañana') return ' antes de mañana';
  return ` antes ${cuando.replace(/^el /, 'del ')}`;
}

function accionesDe(filas, hoyISO) {
  const acciones = [];
  const nombres = fs => fs.map(f => f.cuartel);

  // 1. Clima primero: es lo único con fecha de vencimiento. Una helada que se
  //    avisa el jueves para el miércoles no sirve.
  for (const tipo of ['helada', 'calor']) {
    const conEvento = filas.filter(f => (f.alertas || []).some(a => a.tipo === tipo));
    if (!conEvento.length) continue;
    const alerta = conEvento
      .flatMap(f => (f.alertas || []).filter(a => a.tipo === tipo))
      .find(a => a.valor != null) || {};
    const cuando = cuandoCorto(alerta.fechaEvento, hoyISO);
    const valor = alerta.valor != null ? `${String(alerta.valor).replace('.', ',')} ${alerta.unidad || '°C'}` : null;
    acciones.push({
      tipo,
      texto: tipo === 'helada'
        ? `Protege ${enumerar(nombres(conEvento))}${plazo(cuando)}${valor ? `: se pronostican ${valor}` : ''}.`
        : `Cuida el riego y el estrés térmico en ${enumerar(nombres(conEvento))}${cuando ? ` ${cuando}` : ''}` +
          `${valor ? `: se pronostican ${valor}` : ''}.`,
      cuarteles: nombres(conEvento),
    });
  }

  // 2. Caídas de vigor que llegan al umbral con el que la plataforma alerta.
  const caenFuerte = filas.filter(f => f.tendenciaPct != null && f.tendenciaPct <= -(UMBRAL_DEFECTO.ndvi * 100));
  if (caenFuerte.length) {
    const peor = caenFuerte[0];
    acciones.push({
      tipo: 'vigor',
      texto: `Recorre ${enumerar(nombres(caenFuerte))}: el vigor cae hasta ` +
             `${String(Math.abs(peor.tendenciaPct)).replace('.', ',')}% respecto de las capturas anteriores.`,
      cuarteles: nombres(caenFuerte),
    });
  }

  // 3. La lectura de referencia atípica. Va como acción y no como nota al pie
  //    porque cambia qué hacer: verificar antes de manejar hasta el cuartel.
  const raros = filas.filter(f => f.saltoRaro);
  if (raros.length) {
    acciones.push({
      tipo: 'validar',
      texto: `Valida en terreno ${enumerar(nombres(raros))}: la captura de referencia es atípica ` +
             `y puede estar inflando la caída — suele ser una nube, no el cultivo.`,
      cuarteles: nombres(raros),
    });
  }

  // 4. Más demanda de agua que el año pasado. Era "Revisa el riego en X", y
  //    Stanley lo objetó (2026-09-24): no sabemos si el productor está
  //    regando. Se dice la diferencia, sin recetar.
  const secos = filas.filter(f => (f.alertas || []).some(a => a.tipo === 'sequia'));
  if (secos.length) {
    const alerta = secos.flatMap(f => f.alertas || []).find(a => a.tipo === 'sequia' && a.valor != null);
    acciones.push({
      tipo: 'sequia',
      texto: `Más demanda de agua que el año pasado en ${enumerar(nombres(secos))}` +
             `${alerta ? `: el déficit de 7 días supera en ${String(alerta.valor).replace('.', ',')} mm al de las mismas fechas del año pasado` : ''}.`,
      cuarteles: nombres(secos),
    });
  }

  // 5. Cuarteles sin lectura satelital limpia. Decirlo es parte de la
  //    honestidad del informe: con la máscara de nubes por píxel, en invierno
  //    hay cuarteles que el satélite no vio, y un informe que calla eso se lee
  //    como si los hubiera mirado y estuvieran bien.
  const ciegos = filas.filter(f => f.ndvi == null);
  if (ciegos.length) {
    acciones.push({
      tipo: 'sin_dato',
      texto: `Sin lectura satelital limpia esta semana en ${enumerar(nombres(ciegos))}` +
             `${ciegos.length > 3 ? ` (${ciegos.length} cuarteles)` : ''}: el satélite no pudo ver bajo las nubes, ` +
             `no es una señal de que estén bien ni mal.`,
      cuarteles: nombres(ciegos),
    });
  }

  if (!acciones.length) {
    acciones.push({
      tipo: 'rutina',
      texto: 'Semana de monitoreo de rutina: ninguna unidad requiere visita prioritaria.',
      cuarteles: [],
    });
  }
  return acciones;
}

// El párrafo de arriba del informe: qué mirar primero, en una frase.
function textoEjecutivo({ filas, conAlerta, enCaida }) {
  const n = filas.length;
  if (!n) return 'No hay cuarteles monitoreados en esta cartera.';
  const primero = filas[0];
  // "De tus 1 unidad" no se puede leer: con un solo cuartel la frase cambia.
  const cartera = n === 1 ? 'Tu única unidad monitoreada' : `De tus ${n} unidades`;
  const sinNada = filas.every(f => f.prioridad === 'BAJA');
  if (sinNada) {
    return n === 1
      ? 'Tu única unidad monitoreada no muestra alertas activas ni caída de vigor esta semana. Semana de monitoreo de rutina.'
      : `De tus ${n} unidades, ninguna muestra alertas activas ni caída de vigor esta semana. Semana de monitoreo de rutina.`;
  }
  // Con un solo cuartel el sujeto ya es él, así que no lleva la cuenta adelante:
  // "Tu única unidad monitoreada 1 muestra caída de vigor" no se puede leer.
  const trozos = [];
  if (conAlerta) trozos.push(n === 1 ? 'tiene una alerta climática activa'
    : `${conAlerta} ${conAlerta === 1 ? 'tiene una alerta climática activa' : 'tienen alertas climáticas activas'}`);
  if (enCaida) trozos.push(n === 1 ? 'muestra caída de vigor'
    : `${enCaida} ${enCaida === 1 ? 'muestra' : 'muestran'} caída de vigor`);

  const cola = n === 1 ? '' :
    ` Prioriza esta semana ${primero.cuartel}${primero.predio ? ` (${primero.predio})` : ''}.`;
  return `${cartera}${n === 1 ? '' : ','} ${trozos.join(' y ')}.${cola}`;
}

module.exports = {
  armarModelo, prioridadDe, motivoDe, PRIORIDADES, NIVEL_AVISA, mediana,
  fraseDeAlerta, cuandoCorto, estadisticasDe, serieSemanalDeCartera, pronosticoDe, lunesDe,
  accionesDe, enumerar, agroclimDe,
};

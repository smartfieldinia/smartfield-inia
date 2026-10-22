// ════════════════════════════════════════════════════════════════════════
// api/_informe-graficos.js — los gráficos del informe, como display list.
//
// Cada función recibe sus datos y el ancho disponible, y devuelve `null` o
// `{ alto, dibujar(x, y) → ops[] }`. NO escribe PDF: eso lo hace
// `_informe-pdf.js`. Es la misma separación que ya tiene el informe entre
// datos, maqueta y serialización — un gráfico es maqueta.
//
// **Por qué el alto se sabe ANTES que la posición.** `asegurar(alto)` del
// layout puede cortar página, y cortar página reasigna `y`. Un gráfico al que
// se le pasara su caja completa de entrada obligaría a calcular la `y` antes de
// saber si cabe, y en el caso en que no cabe se dibujaría sobre la cabecera de
// la página siguiente. Con este contrato el layout mide, asegura, y recién
// entonces pide los ops en la `y` definitiva.
//
// **Regla de oro: un gráfico que no puede decir nada no se dibuja.** Cada uno
// declara cuántos datos necesita y, por debajo de eso, devuelve `[]` — no un
// recuadro vacío ni un eje solo. La cartera real más chica del sistema tiene UN
// cuartel: un ranking de caídas de una barra, o un reparto de prioridades con
// el 100 % en un solo color, ocupan espacio sin responder nada. Quien compone
// la página filtra los vacíos y reflowea.
//
// Coordenadas: origen ARRIBA a la izquierda, como el resto del display list.
// La Y se invierte una sola vez, en el serializador.
//
// Helper con `_`: no consume cupo de funciones serverless.
// ════════════════════════════════════════════════════════════════════════

const { medir, recortar } = require('./_informe-fuente');
const { C, COLOR_PRIORIDAD } = require('./_informe-paleta');

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const fmt = (n, dec = 1) =>
  n == null || !Number.isFinite(n) ? '—' : n.toFixed(dec).replace('.', ',');

// ── Andamiaje común ─────────────────────────────────────────────────────

// Título del gráfico + área de dibujo por debajo. Devuelve las ops del rótulo y
// el rectángulo que queda libre, ya descontados los canales de los ejes.
function marco({ x, y, w, h }, { titulo = null, subtitulo = null, izq = 0, abajo = 0 }) {
  const ops = [];
  let cursor = y;
  if (titulo) {
    ops.push({ t: 'texto', x, y: cursor + 8, s: titulo, pt: 8.4, bold: true, fill: C.tinta });
    cursor += 12;
  }
  if (subtitulo) {
    ops.push({ t: 'texto', x, y: cursor + 6, s: subtitulo, pt: 6.6, fill: C.suave });
    cursor += 9;
  }
  const plot = { x: x + izq, y: cursor + 2, w: w - izq, h: y + h - cursor - 2 - abajo };
  return { ops, plot, ejeY: y + h - abajo };
}

// Valores "redondos" para rotular un eje: 0,2 / 0,4 / 0,6 antes que
// 0,183 / 0,447. Un eje con decimales aleatorios obliga a leer cada número en
// vez de reconocer la escala de un vistazo.
function ticks(min, max, cuantos = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max === min) return [min];
  const bruto = (max - min) / Math.max(1, cuantos);
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const paso = [1, 2, 2.5, 5, 10].map(m => m * mag).find(v => v >= bruto) || mag * 10;
  const out = [];
  for (let v = Math.ceil(min / paso) * paso; v <= max + 1e-9; v += paso) {
    out.push(Math.round(v / paso) * paso);
  }
  return out;
}

// Rejilla horizontal + rótulos del eje Y, a la izquierda del área de dibujo.
function ejeVertical(plot, min, max, aY, { dec = 1, sufijo = '' } = {}) {
  const ops = [];
  for (const v of ticks(min, max)) {
    const yy = aY(v);
    if (yy < plot.y - 0.5 || yy > plot.y + plot.h + 0.5) continue;
    ops.push({ t: 'linea', x1: plot.x, y1: yy, x2: plot.x + plot.w, y2: yy, color: C.grid, w: 0.4 });
    const s = fmt(v, dec) + sufijo;
    ops.push({ t: 'texto', x: plot.x - 3 - medir(s, 6), y: yy + 2, s, pt: 6, fill: C.suave });
  }
  return ops;
}

// "12 sep" — el eje X de las series temporales. Con muchos puntos se rotulan
// solo algunos: rótulos encimados no se leen y ensucian el gráfico.
function etiquetaFecha(iso) {
  const d = new Date(String(iso) + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return String(iso || '');
  return `${d.getUTCDate()} ${MESES_CORTOS[d.getUTCMonth()]}`;
}

function saltoDeRotulos(n, anchoDisponible, pt = 6) {
  const porRotulo = medir('30 sep', pt) + 8;
  const caben = Math.max(1, Math.floor(anchoDisponible / porRotulo));
  return Math.max(1, Math.ceil(n / caben));
}

// ── 1. Pronóstico de los próximos días ──────────────────────────────────
//
// Responde "¿voy hoy o puedo esperar?". Es el único gráfico que habla del
// futuro, y por eso va primero: el resto del informe describe lo que ya pasó.
//
// Se grafica el cuartel que encabeza la visita, no un promedio de la cartera:
// una helada le ocurre a un cuartel una noche, y promediar predios que están a
// kilómetros no describe ninguna noche real.
const MIN_DIAS_PRONOSTICO = 2;

const ALTO_PRONOSTICO = 120;

function graficoPronostico(pronostico, { w }) {
  if (!pronostico || !Array.isArray(pronostico.dias)) return null;
  const dias = pronostico.dias.filter(d => d && (d.tmin != null || d.tmax != null));
  if (dias.length < MIN_DIAS_PRONOSTICO) return null;
  return {
    alto: ALTO_PRONOSTICO,
    dibujar: (x, y) => dibujarPronostico({ x, y, w, h: ALTO_PRONOSTICO }, pronostico, dias),
  };
}

function dibujarPronostico(caja, pronostico, dias) {

  const { ops, plot } = marco(caja, {
    subtitulo: `${recortar(pronostico.cuartel || 'cuartel prioritario', 200, 6.6)} · ` +
      `${dias.length} días · mínima y máxima previstas, contra el umbral que dispara la alerta`,
    izq: 22, abajo: 12,
  });

  const vals = [];
  for (const d of dias) { if (d.tmin != null) vals.push(d.tmin); if (d.tmax != null) vals.push(d.tmax); }
  if (pronostico.umbralHelada != null) vals.push(pronostico.umbralHelada);
  let min = Math.min(...vals), max = Math.max(...vals);
  const margen = Math.max(1, (max - min) * 0.15);
  min -= margen; max += margen;

  const aY = v => plot.y + plot.h - ((v - min) / (max - min)) * plot.h;
  const aX = i => plot.x + (dias.length === 1 ? plot.w / 2 : (i / (dias.length - 1)) * plot.w);

  // La banda de helada se pinta ANTES que la rejilla y las curvas: es fondo, y
  // encima tiene que quedar todo lo demás.
  if (pronostico.umbralHelada != null) {
    const yU = aY(pronostico.umbralHelada);
    const yBase = plot.y + plot.h;
    if (yU < yBase) {
      ops.push({ t: 'rect', x: plot.x, y: yU, w: plot.w, h: yBase - yU, fill: C.criticoTinte });
      ops.push({ t: 'linea', x1: plot.x, y1: yU, x2: plot.x + plot.w, y2: yU, color: C.critico, w: 0.6 });
      const rot = `umbral ${fmt(pronostico.umbralHelada, 0)} °C`;
      ops.push({ t: 'texto', x: plot.x + plot.w - medir(rot, 5.6), y: yU - 2, s: rot, pt: 5.6, fill: C.critico });
    }
  }

  ops.push(...ejeVertical(plot, min, max, aY, { dec: 0, sufijo: '°' }));

  for (const [clave, color] of [['tmax', C.ambar], ['tmin', C.frio]]) {
    const pts = dias.map((d, i) => (d[clave] == null ? null : [aX(i), aY(d[clave])])).filter(Boolean);
    if (pts.length < 2) continue;
    ops.push({ t: 'poli', puntos: pts, color, w: 1.3 });
    for (const [px, py] of pts) ops.push({ t: 'rect', x: px - 1.4, y: py - 1.4, w: 2.8, h: 2.8, fill: color });
  }

  const salto = saltoDeRotulos(dias.length, plot.w);
  dias.forEach((d, i) => {
    if (i % salto !== 0 && i !== dias.length - 1) return;
    const s = etiquetaFecha(d.fecha);
    ops.push({ t: 'texto', x: Math.min(aX(i) - medir(s, 6) / 2, plot.x + plot.w - medir(s, 6)),
      y: plot.y + plot.h + 9, s, pt: 6, fill: C.suave });
  });

  // La leyenda va arriba a la derecha, DENTRO del área de dibujo. Al pie
  // chocaba con los rótulos de fecha, que ocupan esa misma franja.
  const entradas = [['máxima', C.ambar], ['mínima', C.frio]];
  const anchoLeyenda = entradas.reduce((a, [rot]) => a + 9 + medir(rot, 6) + 12, 0);
  let lx = plot.x + plot.w - anchoLeyenda;
  for (const [rot, color] of entradas) {
    ops.push({ t: 'rect', x: lx, y: plot.y + 1, w: 7, h: 2, fill: color });
    ops.push({ t: 'texto', x: lx + 9, y: plot.y + 4, s: rot, pt: 6, fill: C.suave });
    lx += 9 + medir(rot, 6) + 12;
  }
  return ops;
}

// ── 2. Reparto de prioridades ───────────────────────────────────────────
//
// Responde "¿cuánta cartera está en rojo?". Una barra apilada al 100 % y no
// cuatro barras sueltas: la pregunta es la proporción, no el conteo — el
// conteo ya está en las tarjetas de arriba y en la tabla.
//
// Con menos de dos cuarteles no se dibuja: una barra de un solo color al 100 %
// es un rectángulo que repite lo que la tabla ya dijo mejor.
//
// Y tampoco basta con contar cuarteles: hace falta que haya **al menos dos
// prioridades distintas**. Con una helada regional los cuatro cuarteles de un
// predio caen todos en ALTA, y el gráfico salía como una barra roja entera con
// un "4" adentro — el mismo rectángulo inútil, pero con más cuarteles. Lo que
// el gráfico contesta es la PROPORCIÓN; sin dos grupos no hay proporción.
const MIN_CUARTELES_REPARTO = 2;
const MIN_TRAMOS_REPARTO = 2;

const ALTO_REPARTO = 62;

function graficoPrioridades(resumen, { w }) {
  const total = resumen ? resumen.unidades : 0;
  if (!total || total < MIN_CUARTELES_REPARTO) return null;
  const tramos = [
    ['ALTA', resumen.alta], ['MEDIA-ALTA', resumen.mediaAlta],
    ['MEDIA-BAJA', resumen.mediaBaja], ['BAJA', resumen.baja],
  ].filter(([, n]) => n > 0);
  if (tramos.length < MIN_TRAMOS_REPARTO) return null;
  return {
    alto: ALTO_REPARTO,
    dibujar: (x, y) => dibujarPrioridades({ x, y, w, h: ALTO_REPARTO }, total, tramos),
  };
}

function dibujarPrioridades(caja, total, tramos) {

  const { ops, plot } = marco(caja, {
    subtitulo: `${total} ${total === 1 ? 'cuartel monitoreado' : 'cuarteles monitoreados'}, por prioridad de visita`,
    abajo: 0,
  });

  const altoBarra = 16;
  let x = plot.x;
  tramos.forEach(([p, n], i) => {
    // El último tramo cierra contra el borde: repartir por redondeo deja una
    // rendija blanca de hasta 3 pt al final de la barra.
    const ancho = i === tramos.length - 1
      ? plot.x + plot.w - x
      : Math.round((n / total) * plot.w * 100) / 100;
    const cp = COLOR_PRIORIDAD[p] || COLOR_PRIORIDAD['BAJA'];
    ops.push({ t: 'rect', x, y: plot.y, w: ancho, h: altoBarra, fill: cp.texto });
    const rot = String(n);
    if (medir(rot, 7, true) + 6 <= ancho) {
      ops.push({ t: 'texto', x: x + ancho / 2 - medir(rot, 7, true) / 2, y: plot.y + 11,
        s: rot, pt: 7, bold: true, fill: C.blanco });
    }
    x += ancho;
  });

  let lx = plot.x, ly = plot.y + altoBarra + 12;
  for (const [p, n] of tramos) {
    const cp = COLOR_PRIORIDAD[p] || COLOR_PRIORIDAD['BAJA'];
    const rot = `${p} ${n}`;
    const ancho = 8 + 3 + medir(rot, 6.2) + 10;
    if (lx + ancho > plot.x + plot.w) { lx = plot.x; ly += 10; }
    ops.push({ t: 'rect', x: lx, y: ly - 4.5, w: 6, h: 6, fill: cp.texto });
    ops.push({ t: 'texto', x: lx + 9, y: ly, s: rot, pt: 6.2, fill: C.suave });
    lx += ancho;
  }
  return ops;
}

// ── 3. Curva de vigor ───────────────────────────────────────────────────
//
// Responde "¿la cartera viene mejorando o cayendo?". La tabla dice cómo está
// cada cuartel HOY; esta curva es lo único del informe que muestra la
// trayectoria, que es lo que separa una caída real de una lectura mala.
//
// Tres puntos es el mínimo honesto: con dos, cualquier par de lecturas es una
// recta y "tendencia" no significa nada.
const MIN_PUNTOS_VIGOR = 3;

const ALTO_VIGOR = 98;

function graficoVigor(serie, { w, subtitulo = null } = {}) {
  const pts = (serie || []).filter(p => p && p.ndvi != null && Number.isFinite(p.ndvi));
  if (pts.length < MIN_PUNTOS_VIGOR) return null;
  return {
    alto: ALTO_VIGOR,
    dibujar: (x, y) => dibujarVigor({ x, y, w, h: ALTO_VIGOR }, pts, subtitulo),
  };
}

function dibujarVigor(caja, pts, subtitulo) {

  const { ops, plot } = marco(caja, {
    subtitulo: subtitulo || 'mediana semanal de las lecturas satelitales limpias',
    izq: 22, abajo: 12,
  });

  const vals = pts.map(p => p.ndvi);
  let min = Math.min(...vals), max = Math.max(...vals);
  // Un rango casi plano estira el ruido hasta que parece una montaña rusa. Se
  // fuerza una ventana mínima para que "no pasó nada" se vea como no pasó nada.
  const RANGO_MINIMO = 0.12;
  if (max - min < RANGO_MINIMO) {
    const centro = (max + min) / 2;
    min = centro - RANGO_MINIMO / 2; max = centro + RANGO_MINIMO / 2;
  }
  min = Math.max(0, min - (max - min) * 0.1);
  max = Math.min(1, max + (max - min) * 0.1);

  const aY = v => plot.y + plot.h - ((v - min) / (max - min)) * plot.h;
  const aX = i => plot.x + (pts.length === 1 ? plot.w / 2 : (i / (pts.length - 1)) * plot.w);

  ops.push(...ejeVertical(plot, min, max, aY, { dec: 2 }));

  const linea = pts.map((p, i) => [aX(i), aY(p.ndvi)]);
  // Área bajo la curva: da la lectura de "cuánto" de un vistazo, sin competir
  // con la línea, que es la que lleva la forma.
  ops.push({ t: 'area', fill: C.tealTinte,
    puntos: [[plot.x, plot.y + plot.h], ...linea, [plot.x + plot.w, plot.y + plot.h]] });
  ops.push({ t: 'poli', puntos: linea, color: C.teal, w: 1.4 });
  for (const [px, py] of linea) ops.push({ t: 'rect', x: px - 1.3, y: py - 1.3, w: 2.6, h: 2.6, fill: C.teal });

  const salto = saltoDeRotulos(pts.length, plot.w);
  pts.forEach((p, i) => {
    if (i % salto !== 0 && i !== pts.length - 1) return;
    const s = etiquetaFecha(p.semana || p.fecha);
    ops.push({ t: 'texto', x: Math.min(Math.max(aX(i) - medir(s, 6) / 2, plot.x), plot.x + plot.w - medir(s, 6)),
      y: plot.y + plot.h + 9, s, pt: 6, fill: C.suave });
  });
  return ops;
}

// ── 4. Ranking de caídas ────────────────────────────────────────────────
//
// Responde "¿a cuáles voy primero?" con la magnitud a la vista. Es la tabla
// ordenada por otra cosa: la tabla ordena por prioridad —que mezcla alertas y
// vigor— y esto aísla la caída de vigor sola.
//
// Solo caídas: un ranking que mezcle subidas y bajadas obliga a leer el signo
// de cada barra. Menos de dos cuarteles cayendo y no hay ranking que hacer.
const MIN_CUARTELES_RANKING = 2;
const TOPE_RANKING = 8;

const ALTO_FILA_RANKING = 14;

function graficoRankingCaidas(filas, { w }) {
  const caen = (filas || [])
    .filter(f => f && f.tendenciaPct != null && f.tendenciaPct < 0)
    .sort((a, b) => a.tendenciaPct - b.tendenciaPct)
    .slice(0, TOPE_RANKING);
  if (caen.length < MIN_CUARTELES_RANKING) return null;
  const total = (filas || []).filter(f => f && f.tendenciaPct != null && f.tendenciaPct < 0).length;
  // El alto lo fija la cantidad de barras, no al revés: apretar ocho cuarteles
  // en una caja fija los deja de 4 pt y sin rótulo legible.
  const alto = 14 + caen.length * ALTO_FILA_RANKING;
  return { alto, dibujar: (x, y) => dibujarRanking({ x, y, w, h: alto }, caen, total) };
}

function dibujarRanking(caja, caen, total) {
  const { ops, plot } = marco(caja, {
    subtitulo: total > caen.length
      ? `los ${caen.length} peores de ${total} cuarteles en baja`
      : `${caen.length} ${caen.length === 1 ? 'cuartel' : 'cuarteles'} en baja`,
    abajo: 0,
  });

  const mayor = Math.abs(caen[0].tendenciaPct) || 1;
  const anchoRotulo = Math.min(96, plot.w * 0.42);
  const anchoValor = 30;
  const anchoBarra = plot.w - anchoRotulo - anchoValor;
  const alto = ALTO_FILA_RANKING - 3;

  caen.forEach((f, i) => {
    const yy = plot.y + i * (alto + 3);
    if (yy + alto > plot.y + plot.h + 1) return;
    const nombre = f.predio ? `${f.predio} · ${f.cuartel}` : f.cuartel;
    ops.push({ t: 'texto', x: plot.x, y: yy + alto - 2,
      s: recortar(nombre, anchoRotulo - 6, 6.6), pt: 6.6, fill: C.tinta });
    const w = Math.max(1, (Math.abs(f.tendenciaPct) / mayor) * anchoBarra);
    const cp = COLOR_PRIORIDAD[f.prioridad] || COLOR_PRIORIDAD['MEDIA-BAJA'];
    ops.push({ t: 'rect', x: plot.x + anchoRotulo, y: yy, w, h: alto, fill: cp.texto });
    const val = `${fmt(Math.abs(f.tendenciaPct), 1)}%`;
    ops.push({ t: 'texto', x: plot.x + anchoRotulo + w + 4, y: yy + alto - 2,
      s: val, pt: 6.6, bold: true, fill: cp.texto });
  });
  return ops;
}

// ── 5-7. Los tres gráficos agroclimáticos del dashboard ─────────────────
//
// Son los mismos que muestra `/app`: grados-día acumulados, horas frío
// acumuladas y temperaturas de la temporada, cada uno contra la temporada
// anterior. Comparten el lenguaje visual de allá —curva llena para la
// temporada en curso, punteada para la anterior— y, sobre todo, comparten los
// DATOS: salen de `calcularAgroclim` de `fields.js`, el mismo cómputo que
// alimenta la pantalla. Recalcularlos acá habría sido una cuarta fuente para el
// mismo número, que es el error que este repo ya pagó dos veces con los rangos
// de temporada escritos a mano en un segundo lugar.

const DIA_MS = 86400000;

// Días corridos entre dos fechas ISO.
function diasEntre(aISO, bISO) {
  const a = Date.parse(String(aISO) + 'T12:00:00Z');
  const b = Date.parse(String(bISO) + 'T12:00:00Z');
  return (Number.isNaN(a) || Number.isNaN(b)) ? null : Math.round((a - b) / DIA_MS);
}

function fechaMas(desdeISO, dias) {
  const t = Date.parse(String(desdeISO) + 'T12:00:00Z');
  return Number.isNaN(t) ? null : new Date(t + dias * DIA_MS).toISOString().slice(0, 10);
}

// Motor común de las dos curvas acumuladas.
//
// **El eje X se fija a la temporada COMPLETA**, no al dato disponible. Es una
// decisión que ya se tomó en el dashboard (2026-08-24) y copiarla no es
// cosmético: con el eje autoescalado el ancho cambia semana a semana y se
// pierde lo único que la curva contesta en septiembre, que es cuánto falta para
// cerrar la temporada. Por eso la curva en curso ocupa el primer tercio y a la
// derecha queda aire: ese aire es información.
function dibujarAcumulado(caja, cfg) {
  // La leyenda va en la MISMA línea del subtítulo, alineada a la derecha, y no
  // dentro del área de dibujo: ahí caía justo a la altura del rótulo del tick
  // superior del eje Y y se dibujaba encima. El subtítulo se recorta a lo que
  // sobra, así que las dos cosas nunca compiten por el mismo espacio.
  const entradas = [[cfg.rotuloActual, cfg.color || C.teal, false],
                    [cfg.rotuloPrevia, C.suave, true]].filter(([r]) => r);
  const anchoLeyenda = entradas.reduce((a, [r]) => a + 11 + medir(r, 6) + 12, 0);
  const { ops, plot } = marco(caja, {
    subtitulo: recortar(cfg.subtitulo, caja.w - anchoLeyenda - 10, 6.6),
    izq: 26, abajo: 12,
  });
  {
    let lx = caja.x + caja.w - anchoLeyenda;
    const ly = caja.y + 6;
    for (const [rot, color, dash] of entradas) {
      ops.push({ t: 'rect', x: lx, y: ly - 2, w: dash ? 3 : 7, h: 1.8, fill: color });
      if (dash) ops.push({ t: 'rect', x: lx + 4.5, y: ly - 2, w: 3, h: 1.8, fill: color });
      ops.push({ t: 'texto', x: lx + 11, y: ly, s: rot, pt: 6, fill: C.suave });
      lx += 11 + medir(rot, 6) + 12;
    }
  }

  const largoTemporada = Math.max(1, diasEntre(cfg.hasta, cfg.desde) || 1);
  const serie = (filas, base) => (filas || [])
    .map(f => ({ x: diasEntre(f.fecha, base), y: f.valor }))
    .filter(p => p.x != null && p.y != null && Number.isFinite(p.y) && p.x >= 0 && p.x <= largoTemporada);

  const actual = serie(cfg.actual, cfg.desde);
  // La temporada anterior se ancla a SU propio día cero, no al de la actual:
  // es lo que permite superponerlas y ver adelanto o atraso.
  const basePrevia = (cfg.previa && cfg.previa.length) ? cfg.previa[0].fecha : cfg.desde;
  const previa = serie(cfg.previa, basePrevia);
  if (actual.length < 2) return null;

  const maxY = Math.max(
    ...actual.map(p => p.y), ...previa.map(p => p.y),
    cfg.objetivo != null ? cfg.objetivo : 0, 1);
  const aX = d => plot.x + (d / largoTemporada) * plot.w;
  const aY = v => plot.y + plot.h - (v / maxY) * plot.h;

  ops.push(...ejeVertical(plot, 0, maxY, aY, { dec: 0 }));

  // La línea de objetivo (requerimiento térmico de INIA para ese cultivo) es lo
  // que convierte la curva en una decisión: dice cuánto falta, no solo cuánto va.
  if (cfg.objetivo != null && cfg.objetivo <= maxY) {
    const yo = aY(cfg.objetivo);
    ops.push({ t: 'linea', x1: plot.x, y1: yo, x2: plot.x + plot.w, y2: yo,
      color: C.verde, w: 0.7, dash: [3, 2] });
    const rot = cfg.rotuloObjetivo || `objetivo ${fmt(cfg.objetivo, 0)}`;
    // Debajo de la línea salvo que no haya lugar: encima chocaba con el rótulo
    // del tick del eje cuando el objetivo queda cerca del tope de la escala,
    // que es el caso normal (un requerimiento se dibuja para verlo alcanzable).
    const cabeAbajo = yo + 8 <= plot.y + plot.h;
    ops.push({ t: 'texto', x: plot.x + plot.w - medir(rot, 5.6),
      y: cabeAbajo ? yo + 7 : yo - 3, s: rot, pt: 5.6, fill: C.verde });
  }

  if (previa.length >= 2) {
    ops.push({ t: 'poli', puntos: previa.map(p => [aX(p.x), aY(p.y)]), color: C.suave, w: 1, dash: [3, 2] });
  }
  const pts = actual.map(p => [aX(p.x), aY(p.y)]);
  ops.push({ t: 'area', fill: cfg.tinte || C.tealTinte,
    puntos: [[pts[0][0], plot.y + plot.h], ...pts, [pts[pts.length - 1][0], plot.y + plot.h]] });
  ops.push({ t: 'poli', puntos: pts, color: cfg.color || C.teal, w: 1.5 });
  // El extremo de la curva en curso, rotulado: es el número que se compara.
  const fin = pts[pts.length - 1];
  ops.push({ t: 'rect', x: fin[0] - 1.8, y: fin[1] - 1.8, w: 3.6, h: 3.6, fill: cfg.color || C.teal });

  // Eje X: fechas reales, no números de día. "día 217 de la temporada" no le
  // dice nada a nadie parado en el campo.
  const saltos = 6;
  for (let i = 0; i <= saltos; i++) {
    const d = Math.round((i / saltos) * largoTemporada);
    const f = fechaMas(cfg.desde, d);
    if (!f) continue;
    const s = etiquetaFecha(f);
    ops.push({ t: 'texto',
      x: Math.min(Math.max(aX(d) - medir(s, 6) / 2, plot.x), plot.x + plot.w - medir(s, 6)),
      y: plot.y + plot.h + 9, s, pt: 6, fill: C.suave });
  }

  return ops;
}

const ALTO_ACUMULADO = 112;

// Grados-día base 10, acumulados desde el 1 de agosto.
function graficoGdd(gdd, { w }) {
  if (!gdd || !Array.isArray(gdd.daily) || gdd.daily.length < 2) return null;
  const req = gdd.requerimiento && gdd.requerimiento.gd10 != null ? gdd.requerimiento.gd10 : null;
  const cmp = gdd.total != null && gdd.total_anio_anterior_a_la_fecha != null
    ? ` · llevas ${fmt(gdd.total, 0)} °D contra ${fmt(gdd.total_anio_anterior_a_la_fecha, 0)} a esta altura de la temporada pasada`
    : '';
  return {
    alto: ALTO_ACUMULADO,
    dibujar: (x, y) => dibujarAcumulado({ x, y, w, h: ALTO_ACUMULADO }, {
      subtitulo: `acumulados base ${fmt(gdd.base_c, 0)} °C desde el inicio de la temporada${cmp}`,
      desde: gdd.desde, hasta: gdd.hasta,
      actual: gdd.daily.map(d => ({ fecha: d.fecha, valor: d.acumulado })),
      previa: (gdd.dailyAnioAnterior || []).map(d => ({ fecha: d.fecha, valor: d.acumulado })),
      objetivo: req,
      rotuloObjetivo: req != null
        ? `requerimiento ${fmt(req, 0)} °D (${gdd.requerimiento.cultivo})` : null,
      rotuloActual: `temporada ${gdd.temporada}`,
      rotuloPrevia: `temporada ${gdd.temporada_previa}`,
      color: C.teal, tinte: C.tealTinte,
    }),
  };
}

// Horas frío acumuladas. Desde el 2026-09-24 la curva y el total salen de la
// MISMA serie diaria (`chill_hours` de la estación INIA, Open-Meteo solo de
// relleno), así que el último punto de la curva ES el total: no hay un
// "total oficial" aparte que pueda contradecirla. Ver `serieFrio` en
// `_agroclim.js`.
function subtituloFrio(chill) {
  // Al cierre de la temporada (31-jul) y, si ya pasó, lo acumulado a la fecha:
  // la comparación entre años es al 31-jul (Stanley, 2026-09-24).
  const total = chill.total != null
    ? `: ${fmt(chill.total, 0)} h al cierre${chill.acumulado_a_la_fecha != null
        ? `, ${fmt(chill.acumulado_a_la_fecha, 0)} h a la fecha` : ''}`
    : '';
  if (chill.fuente_curva === 'inia') {
    return `horas frío diarias de la estación ${chill.estacion || 'INIA'}${total}`;
  }
  // El umbral se escribe con su decimal: con 0 decimales 7,2 °C salía "7 °C",
  // que es el umbral de las tablas por variedad y no el que se usó.
  const umbral = chill.umbral_c != null ? `horas bajo ${fmt(chill.umbral_c, 1)} °C` : 'horas frío';
  return chill.fuente_curva === 'mixto'
    ? `${umbral} — estación ${chill.estacion || 'INIA'} con días rellenados del reanálisis${total}`
    : `${umbral} — estimadas del reanálisis horario${total}`;
}

function graficoHorasFrio(chill, { w }) {
  if (!chill || !Array.isArray(chill.daily) || chill.daily.length < 2) return null;
  const req = chill.requerimiento && chill.requerimiento.hf7 != null ? chill.requerimiento.hf7 : null;
  return {
    alto: ALTO_ACUMULADO,
    dibujar: (x, y) => dibujarAcumulado({ x, y, w, h: ALTO_ACUMULADO }, {
      subtitulo: subtituloFrio(chill),
      desde: chill.desde, hasta: chill.hasta,
      actual: chill.daily.map(d => ({ fecha: d.fecha, valor: d.acumulado })),
      previa: (chill.dailyAnioAnterior || []).map(d => ({ fecha: d.fecha, valor: d.acumulado })),
      objetivo: req,
      rotuloObjetivo: req != null ? `requerimiento ${fmt(req, 0)} h` : null,
      rotuloActual: `temporada ${chill.temporada}`,
      rotuloPrevia: `temporada ${chill.temporada_previa}`,
      color: C.frio, tinte: C.fríoSuave,
    }),
  };
}

// Mínimas y máximas de la temporada, contra las del año pasado.
//
// La temporada anterior se recorta al mismo tramo recorrido: superponer 300
// días de la pasada contra 38 de la actual no compara nada, solo aplasta la
// curva viva contra el margen izquierdo.
const ALTO_TEMPS = 118;
const MIN_DIAS_TEMPS = 5;

function graficoTemperaturas(temps, { w }) {
  if (!temps || !Array.isArray(temps.daily) || temps.daily.length < MIN_DIAS_TEMPS) return null;
  return {
    alto: ALTO_TEMPS,
    dibujar: (x, y) => dibujarTemperaturas({ x, y, w, h: ALTO_TEMPS }, temps),
  };
}

function dibujarTemperaturas(caja, temps) {
  const dias = temps.daily.filter(d => d && (d.tmin != null || d.tmax != null));
  const previa = (temps.dailyAnioAnterior || []).filter(d => d && (d.tmin != null || d.tmax != null))
    .slice(0, dias.length);

  const { ops, plot } = marco(caja, {
    subtitulo: `mínimas y máximas diarias de la temporada, contra el mismo tramo de la anterior (punteado)`,
    izq: 22, abajo: 12,
  });

  const todos = [];
  for (const d of dias.concat(previa)) { if (d.tmin != null) todos.push(d.tmin); if (d.tmax != null) todos.push(d.tmax); }
  let min = Math.min(...todos), max = Math.max(...todos);
  const margen = Math.max(1, (max - min) * 0.1);
  min -= margen; max += margen;

  const n = Math.max(dias.length, previa.length);
  const aX = i => plot.x + (n <= 1 ? plot.w / 2 : (i / (n - 1)) * plot.w);
  const aY = v => plot.y + plot.h - ((v - min) / (max - min)) * plot.h;

  // La línea de 0 °C, cuando entra en el rango: es la referencia con la que se
  // lee una mínima, y sin ella "−1" y "3" se ven igual de lejos del eje.
  if (min < 0 && max > 0) {
    ops.push({ t: 'linea', x1: plot.x, y1: aY(0), x2: plot.x + plot.w, y2: aY(0), color: C.critico, w: 0.5 });
  }
  ops.push(...ejeVertical(plot, min, max, aY, { dec: 0, sufijo: '°' }));

  const curva = (filas, clave, color, dash) => {
    const pts = filas.map((d, i) => (d[clave] == null ? null : [aX(i), aY(d[clave])])).filter(Boolean);
    if (pts.length >= 2) ops.push({ t: 'poli', puntos: pts, color, w: dash ? 0.8 : 1.2, dash: dash || null });
  };
  curva(previa, 'tmax', C.suave, [3, 2]);
  curva(previa, 'tmin', C.suave, [3, 2]);
  curva(dias, 'tmax', C.ambar, null);
  curva(dias, 'tmin', C.frio, null);

  const salto = saltoDeRotulos(dias.length, plot.w);
  let ocupadoHasta = -Infinity;
  dias.forEach((d, i) => {
    if (i % salto !== 0 && i !== dias.length - 1) return;
    const s = etiquetaFecha(d.fecha);
    const x = Math.min(Math.max(aX(i) - medir(s, 6) / 2, plot.x), plot.x + plot.w - medir(s, 6));
    // El último rótulo se forzaba siempre y terminaba impreso encima del
    // anterior cuando el salto no caía justo. Si no hay lugar, no se dibuja:
    // una fecha ilegible es peor que una fecha de menos.
    if (x < ocupadoHasta + 4) return;
    ops.push({ t: 'texto', x, y: plot.y + plot.h + 9, s, pt: 6, fill: C.suave });
    ocupadoHasta = x + medir(s, 6);
  });

  const entradas = [['máxima', C.ambar], ['mínima', C.frio], ['temporada anterior', C.suave]];
  const ancho = entradas.reduce((a, [r]) => a + 9 + medir(r, 6) + 12, 0);
  let lx = plot.x + plot.w - ancho;
  for (const [rot, color] of entradas) {
    ops.push({ t: 'rect', x: lx, y: plot.y + 1, w: 7, h: 2, fill: color });
    ops.push({ t: 'texto', x: lx + 9, y: plot.y + 4, s: rot, pt: 6, fill: C.suave });
    lx += 9 + medir(rot, 6) + 12;
  }
  return ops;
}

module.exports = {
  graficoPronostico, graficoPrioridades, graficoVigor, graficoRankingCaidas,
  graficoGdd, graficoHorasFrio, graficoTemperaturas,
  diasEntre, fechaMas, MIN_DIAS_TEMPS,
  ticks, etiquetaFecha,
  MIN_DIAS_PRONOSTICO, MIN_CUARTELES_REPARTO, MIN_TRAMOS_REPARTO, MIN_PUNTOS_VIGOR, MIN_CUARTELES_RANKING,
};

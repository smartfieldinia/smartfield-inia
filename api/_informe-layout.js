// ════════════════════════════════════════════════════════════════════════
// api/_informe-layout.js — modelo → display list (posiciones absolutas en pt).
//
// Acá vive TODA la maqueta: márgenes, columnas, alturas de fila, cortes de
// página, colores. El resultado es una lista de operaciones de dibujo que
// `_informe-pdf.js` traduce a PDF. Un solo cálculo de layout, un serializador
// tonto: si mañana hace falta una imagen del informe, se agrega otro
// serializador y la maqueta no se toca.
//
// El diseño replica el "Informe de priorización semanal de terreno" que definió
// Stanley: cabecera con la semana, callout con el resumen ejecutivo, tabla de
// orden de visita con badges de prioridad, y una nota metodológica al pie.
//
// Paleta tomada de `eval/informe-riesgo-climatico/build.js`, ya validada para
// impresión.
//
// Helper con `_`: no consume cupo de funciones serverless.
// ════════════════════════════════════════════════════════════════════════

const { medir, partirEnLineas, recortar } = require('./_informe-fuente');
const { A4 } = require('./_informe-pdf');
const G = require('./_informe-graficos');

// La paleta vive en `_informe-paleta.js` desde que los gráficos también la
// necesitan; se re-exporta al final para no romper a quien la importa de acá.
const { C, COLOR_PRIORIDAD } = require('./_informe-paleta');

const MARGEN = { x: 40, arriba: 40, abajo: 46 };
// Proporción del logo embebido (ancho / alto), para que no se deforme.
const LOGO_PROPORCION = (() => { const l = require('./_informe-logo'); return l.ancho / l.alto; })();
const ANCHO_UTIL = A4.ancho - MARGEN.x * 2;

// Columnas de la tabla de visitas, en puntos. Suman ANCHO_UTIL.
const COLS = [
  { k: 'orden',     t: '#',                w: 20 },
  { k: 'prioridad', t: 'PRIORIDAD',        w: 74 },
  { k: 'cuartel',   t: 'PREDIO / CUARTEL', w: 92 },
  { k: 'cultivo',   t: 'CULTIVO · SUP.',   w: 78 },
  { k: 'riesgo',    t: 'RIESGO CLIMA',     w: 60 },
  { k: 'ndvi',      t: 'VIGOR (NDVI)',     w: 52 },
  { k: 'tendencia', t: 'TENDENCIA',        w: 62 },
  { k: 'motivo',    t: 'MOTIVO',           w: ANCHO_UTIL - (20 + 74 + 92 + 78 + 60 + 52 + 62) },
];

function xDeColumna(i) {
  let x = MARGEN.x;
  for (let j = 0; j < i; j++) x += COLS[j].w;
  return x;
}

const fmtNum = (n, dec = 2) =>
  n == null || !Number.isFinite(n) ? '—' : n.toFixed(dec).replace('.', ',');

// ── Construcción ────────────────────────────────────────────────────────
function armarPaginas(modelo) {
  const paginas = [];
  let ops = [];
  let y = 0;
  let numero = 0;

  const nuevaPagina = (conCabecera) => {
    if (ops.length) paginas.push({ ancho: A4.ancho, alto: A4.alto, ops });
    ops = [];
    numero++;
    y = MARGEN.arriba;
    if (conCabecera) cabecera();
  };

  const texto = (s, x, yy, pt, opts = {}) =>
    ops.push({ t: 'texto', x, y: yy, s, pt, bold: !!opts.bold, fill: opts.fill || C.tinta });

  // Cabecera con el logo INIA SmartField (ver `_informe-logo.js`). Mide lo
  // mismo en todas las páginas: los saltos de página dependen de esa altura.
  const LOGO_ALTO = 36;
  const cabecera = () => {
    ops.push({ t: 'imagen', x: MARGEN.x, y: y - 6, w: LOGO_ALTO * LOGO_PROPORCION, h: LOGO_ALTO });
    const der = (s, dy, pt, bold) => {
      const w = medir(s, pt);
      texto(s, A4.ancho - MARGEN.x - w, y + dy, pt, { fill: bold ? C.teal : C.suave, bold });
    };
    der('Informe semanal de terreno', 8, 9, true);
    der(`Semana ${modelo.semana}`, 20, 8);
    der(`Generado el ${modelo.generadoEl}`, 30, 8);
    y += 38;
    // Regla verde INIA con el remate en lima, como el "SMART|FIELD" del logo.
    const corte = A4.ancho - MARGEN.x - 90;
    ops.push({ t: 'linea', x1: MARGEN.x, y1: y, x2: corte, y2: y, color: C.teal, w: 1.6 });
    ops.push({ t: 'linea', x1: corte, y1: y, x2: A4.ancho - MARGEN.x, y2: y, color: C.lima, w: 1.6 });
    y += 22;
  };

  // Espacio que queda antes del pie.
  const disponible = () => A4.alto - MARGEN.abajo - y;
  const asegurar = (alto) => { if (disponible() < alto) { nuevaPagina(true); return true; } return false; };

  // Título de sección, numerado. Antes cada bloque repetía estas tres líneas a
  // mano; con seis secciones eso son seis lugares donde el número, el tamaño o
  // la barrita de acento pueden divergir.
  let nSeccion = 0;
  const seccion = (titulo) => {
    nSeccion++;
    texto(`${nSeccion} · ${titulo}`, MARGEN.x, y + 10, 11.5, { bold: true });
    ops.push({ t: 'rect', x: MARGEN.x - 6, y: y - 1, w: 3, h: 14, fill: C.teal });
    y += 20;
  };

  // Un gráfico: medir → asegurar → dibujar. El orden NO es negociable.
  // `asegurar` puede cortar página, y cortar página reasigna `y`: pedirle los
  // ops al gráfico antes de eso lo dibujaría sobre la cabecera de la página
  // siguiente. Por eso los gráficos declaran su alto sin saber dónde van.
  const bloqueGrafico = (titulo, grafico) => {
    if (!grafico) return false;
    asegurar(grafico.alto + 34);
    seccion(titulo);
    ops.push(...grafico.dibujar(MARGEN.x, y));
    y += grafico.alto + 16;
    return true;
  };

  nuevaPagina(true);

  // ── Título ────────────────────────────────────────────────────────────
  texto('Priorización semanal de terreno', MARGEN.x, y + 14, 19, { bold: true });
  y += 24;
  // `titular` es el predio cuando `scope === 'predio'` (un informe por campo,
  // desde el 2026-09-14) y la persona cuando es la cartera de un asesor. El
  // nombre del productor va aparte: sin él, tres informes de tres predios no
  // dicen de quién son.
  const de = modelo.productor && modelo.productor !== modelo.titular ? ` · ${modelo.productor}` : '';
  const sub = `${modelo.scope === 'asesor' ? 'Cartera del asesor' : 'Predio'}: ${modelo.titular || 'sin nombre'}${de} · ` +
              `${modelo.resumen.unidades} ${modelo.resumen.unidades === 1 ? 'unidad monitoreada' : 'unidades monitoreadas'}`;
  texto(sub, MARGEN.x, y + 9, 9, { fill: C.suave });
  y += 24;

  // ── Tarjetas KPI ──────────────────────────────────────────────────────
  //
  // Los cuatro números que contestan "¿cómo viene la semana?" antes de leer
  // nada. Van arriba del resumen y no abajo: es el orden en que se mira una
  // página, y es el que replican los informes de referencia.
  {
    const est = modelo.estadisticas || {};
    const r = modelo.resumen;
    const gap = 9, n = 4;
    const wCard = (ANCHO_UTIL - gap * (n - 1)) / n;
    const hCard = 54;
    const riesgo = modelo.pronostico && modelo.pronostico.umbralHelada != null
      ? `umbral helada ${fmtNum(modelo.pronostico.umbralHelada, 0)} °C` : 'sin pronóstico';
    const tarjetas = [
      ['CUARTELES', String(r.unidades), est.superficieHa != null ? `${fmtNum(est.superficieHa, 1)} ha en total` : 'sin superficie cargada', C.teal],
      ['PRIORIDAD ALTA', String(r.alta), r.alta ? 'requieren visita esta semana' : 'ninguno urgente', r.alta ? C.critico : C.verde],
      ['EN CAÍDA DE VIGOR', String(r.enCaida), est.ndviMediana != null ? `NDVI mediano ${fmtNum(est.ndviMediana, 3)}` : 'sin lectura satelital', r.enCaida ? C.ambar : C.verde],
      ['CON ALERTA CLIMÁTICA', String(r.conAlerta), riesgo, r.conAlerta ? C.critico : C.suave],
    ];
    tarjetas.forEach(([rot, valor, sub, acento], i) => {
      const cx = MARGEN.x + i * (wCard + gap);
      ops.push({ t: 'rect', x: cx, y, w: wCard, h: hCard, fill: C.fondo });
      ops.push({ t: 'rect', x: cx, y, w: 3, h: hCard, fill: acento });
      texto(recortar(rot, wCard - 16, 6.4, true), cx + 10, y + 14, 6.4, { bold: true, fill: C.suave });
      texto(valor, cx + 10, y + 38, 20, { bold: true, fill: acento });
      texto(recortar(sub, wCard - 16, 6.4), cx + 10, y + 49, 6.4, { fill: C.suave });
    });
    y += hCard + 16;
  }

  // ── Callout con el resumen ejecutivo ──────────────────────────────────
  {
    const pt = 9.5, interlinea = 13, pad = 10;
    const lineas = partirEnLineas(modelo.resumen.texto, ANCHO_UTIL - pad * 2 - 6, pt);
    const alto = lineas.length * interlinea + pad * 2 - 3;
    ops.push({ t: 'rect', x: MARGEN.x, y, w: ANCHO_UTIL, h: alto, fill: C.fondo });
    ops.push({ t: 'rect', x: MARGEN.x, y, w: 3, h: alto, fill: C.teal });
    lineas.forEach((l, i) => texto(l, MARGEN.x + pad + 4, y + pad + i * interlinea + 6, pt, { bold: i === 0 }));
    y += alto + 20;
  }

  // ── Qué hacer esta semana ─────────────────────────────────────────────
  //
  // La tabla dice a cuál ir; esto dice qué hacer al llegar. Es lo que evita
  // que un informe de un cuartel tranquilo sea media página en blanco.
  if ((modelo.acciones || []).length) {
    asegurar(46);
    seccion('Qué hacer esta semana');
    const pt = 8.6, interlinea = 11, sangria = 14;
    modelo.acciones.forEach((a, i) => {
      const lineas = partirEnLineas(a.texto, ANCHO_UTIL - sangria, pt);
      // Se asegura POR ÍTEM y no por bloque: con seis acciones largas, exigir
      // que entre el bloque entero empujaría todo a la página siguiente
      // dejando media página vacía acá.
      asegurar(lineas.length * interlinea + 6);
      const cy = y + 6;
      texto(`${i + 1}.`, MARGEN.x + 2, cy, pt, { bold: true, fill: C.teal });
      lineas.forEach((l, j) => texto(l, MARGEN.x + sangria, cy + j * interlinea, pt));
      y += lineas.length * interlinea + 6;
    });
    y += 12;
  }

  // ── Tabla: orden de visita ────────────────────────────────────────────
  asegurar(60);
  seccion('Orden de visita sugerido');

  const encabezadoTabla = () => {
    ops.push({ t: 'rect', x: MARGEN.x, y, w: ANCHO_UTIL, h: 16, fill: C.teal });
    COLS.forEach((c, i) => texto(c.t, xDeColumna(i) + 4, y + 11, 6.8, { bold: true, fill: C.blanco }));
    y += 16;
  };
  encabezadoTabla();

  const PT_CELDA = 8;
  modelo.filas.forEach((f, idx) => {
    // El motivo es lo que decide el alto de la fila.
    const anchoMotivo = COLS[7].w - 8;
    const lineasMotivo = partirEnLineas(f.motivo, anchoMotivo, PT_CELDA);
    const alto = Math.max(20, lineasMotivo.length * 10 + 9);

    // Una fila NUNCA se parte entre páginas: media fila arriba y media abajo es
    // ilegible en una tabla de decisión.
    if (disponible() < alto + 6) { nuevaPagina(true); encabezadoTabla(); }

    if (idx % 2 === 1) ops.push({ t: 'rect', x: MARGEN.x, y, w: ANCHO_UTIL, h: alto, fill: C.fondo });

    const baseY = y + 13;
    texto(String(f.orden), xDeColumna(0) + 4, baseY, PT_CELDA, { bold: true });

    // Badge de prioridad.
    const cp = COLOR_PRIORIDAD[f.prioridad] || COLOR_PRIORIDAD['BAJA'];
    const wTxt = medir(f.prioridad, 6.6, true);
    ops.push({ t: 'rect', x: xDeColumna(1) + 4, y: y + 5, w: wTxt + 12, h: 12, fill: cp.fondo });
    texto(f.prioridad, xDeColumna(1) + 10, y + 13.5, 6.6, { bold: true, fill: cp.texto });

    const nombre = f.predio ? `${f.predio} · ${f.cuartel}` : f.cuartel;
    texto(recortar(nombre, COLS[2].w - 8, PT_CELDA, true), xDeColumna(2) + 4, baseY, PT_CELDA, { bold: true });

    const cultivo = [f.cultivo || '—', f.areaHa != null ? `${fmtNum(f.areaHa, 2)} ha` : null].filter(Boolean).join(' · ');
    texto(recortar(cultivo, COLS[3].w - 8, PT_CELDA), xDeColumna(3) + 4, baseY, PT_CELDA, { fill: C.suave });

    // Riesgo climático: badge solo cuando hay algo que mirar. "sin dato" en gris
    // y en minúscula, para que no compita con un riesgo real.
    if (f.riesgoClima === 'alto' || f.riesgoClima === 'medio') {
      const et = f.riesgoClima.toUpperCase();
      const cr = f.riesgoClima === 'alto' ? COLOR_PRIORIDAD['ALTA'] : COLOR_PRIORIDAD['MEDIA-ALTA'];
      const w2 = medir(et, 6.6, true);
      ops.push({ t: 'rect', x: xDeColumna(4) + 4, y: y + 5, w: w2 + 12, h: 12, fill: cr.fondo });
      texto(et, xDeColumna(4) + 10, y + 13.5, 6.6, { bold: true, fill: cr.texto });
    } else {
      texto('sin dato', xDeColumna(4) + 4, baseY, PT_CELDA, { fill: C.suave });
    }

    texto(f.ndvi != null ? fmtNum(f.ndvi, 3) : '—', xDeColumna(5) + 4, baseY, PT_CELDA);

    // Tendencia: triángulo dibujado + porcentaje. El signo va con el color.
    if (f.tendenciaPct != null) {
      const sube = f.tendenciaPct > 0;
      const col = sube ? C.verde : C.critico;
      ops.push({ t: 'tri', x: xDeColumna(6) + 4, y: y + 7, dir: sube ? 'up' : 'down', s: 6, fill: col });
      const pct = `${sube ? '+' : ''}${String(f.tendenciaPct).replace('.', ',')}%`;
      texto(pct, xDeColumna(6) + 14, baseY, PT_CELDA, { bold: true, fill: col });
      if (f.capturasAtras) {
        texto(`${f.capturasAtras} ${f.capturasAtras === 1 ? 'lect.' : 'lects.'}`,
          xDeColumna(6) + 14, baseY + 9, 6.4, { fill: C.suave });
      }
    } else {
      texto('— sin señal', xDeColumna(6) + 4, baseY, PT_CELDA, { fill: C.suave });
    }

    lineasMotivo.forEach((l, i) => texto(l, xDeColumna(7) + 4, baseY + i * 10, PT_CELDA, { fill: C.suave }));

    y += alto;
    ops.push({ t: 'linea', x1: MARGEN.x, y1: y, x2: A4.ancho - MARGEN.x, y2: y, color: C.grid, w: 0.5 });
  });

  y += 12;

  // ── Leyenda de prioridades ────────────────────────────────────────────
  {
    asegurar(46);
    const leyenda = [
      ['ALTA', 'alerta activa o caída fuerte'],
      ['MEDIA-ALTA', 'cae y su vigor ya está bajo'],
      ['MEDIA-BAJA', 'caída leve, sin urgencia'],
      ['BAJA', 'sin señales'],
    ];
    texto('Prioridad calculada con las señales disponibles esta semana.', MARGEN.x, y + 8, 7.2, { fill: C.suave });
    y += 14;
    let x = MARGEN.x;
    for (const [p, desc] of leyenda) {
      const cp = COLOR_PRIORIDAD[p];
      const w2 = medir(p, 6.4, true);
      // Si no entra en la línea, se baja: con nombres largos se salía del margen.
      if (x + w2 + 12 + medir(desc, 7, false) + 18 > A4.ancho - MARGEN.x) { x = MARGEN.x; y += 14; }
      ops.push({ t: 'rect', x, y: y - 1, w: w2 + 12, h: 11, fill: cp.fondo });
      texto(p, x + 6, y + 7, 6.4, { bold: true, fill: cp.texto });
      x += w2 + 16;
      texto(desc, x, y + 7, 7, { fill: C.suave });
      x += medir(desc, 7) + 14;
    }
    y += 22;
  }

  // ── La cartera en números ─────────────────────────────────────────────
  //
  // Los descriptivos que la tabla no puede dar porque los tiene repartidos fila
  // por fila. `sin lectura` y `sin tendencia` van acá a propósito: con la
  // máscara de nubes por píxel hay semanas en que el satélite no vio varios
  // cuarteles, y un informe que no lo dice se lee como si los hubiera mirado.
  {
    const e = modelo.estadisticas || {};
    const items = [
      [modelo.resumen.unidades === 1 ? 'NDVI del cuartel' : 'NDVI de la cartera',
        e.ndviMediana == null ? 'sin lecturas limpias'
          : e.ndviMin === e.ndviMax ? fmtNum(e.ndviMediana, 3)
          : `mediana ${fmtNum(e.ndviMediana, 3)} · mín ${fmtNum(e.ndviMin, 3)} · máx ${fmtNum(e.ndviMax, 3)}`],
      ['Superficie monitoreada', e.superficieHa != null ? `${fmtNum(e.superficieHa, 2)} ha` : 'sin superficie cargada'],
      ['Cultivos', (e.cultivos || []).length
        ? e.cultivos.slice(0, 4).map(c => `${c.cultivo} (${c.cuarteles})`).join(' · ') + ((e.cultivos.length > 4) ? ` y ${e.cultivos.length - 4} más` : '')
        : 'sin cultivo cargado'],
      ['Alertas de la semana', Object.keys(e.alertasPorTipo || {}).length
        ? Object.entries(e.alertasPorTipo).map(([t, n]) => `${t} ${n}`).join(' · ')
        : 'ninguna'],
      ['Sin lectura satelital', `${e.sinLectura || 0} de ${modelo.resumen.unidades}`],
      ['Sin tendencia calculable', `${e.sinTendencia || 0} de ${modelo.resumen.unidades}`],
    ];
    asegurar(28 + items.length * 13);
    seccion(modelo.resumen.unidades === 1 ? 'El cuartel en números' : 'La cartera en números');
    const anchoRot = 132;
    items.forEach(([rot, val], i) => {
      if (i % 2 === 1) ops.push({ t: 'rect', x: MARGEN.x, y: y - 2, w: ANCHO_UTIL, h: 13, fill: C.fondo });
      texto(rot, MARGEN.x + 4, y + 7, 7.4, { bold: true });
      texto(recortar(String(val), ANCHO_UTIL - anchoRot - 10, 7.4), MARGEN.x + anchoRot, y + 7, 7.4, { fill: C.suave });
      y += 13;
    });
    y += 14;
  }

  // ── Gráficos ──────────────────────────────────────────────────────────
  //
  // Van después de la tabla porque la tabla es la decisión y esto es el
  // respaldo: el asesor que ya sabe a dónde va no necesita bajar hasta acá.
  // El pronóstico primero: es lo único del informe que habla del futuro.
  bloqueGrafico('Pronóstico de los próximos días',
    G.graficoPronostico(modelo.pronostico, { w: ANCHO_UTIL }));
  bloqueGrafico('Evolución del vigor',
    G.graficoVigor(modelo.serieCartera, {
      w: ANCHO_UTIL,
      // Con un solo cuartel no hay mediana de nada: decir "mediana de la
      // cartera" sobre una sola serie sería una precisión inventada.
      subtitulo: modelo.resumen.unidades === 1
        ? 'lecturas satelitales limpias del cuartel, por semana'
        : 'mediana semanal de las lecturas satelitales limpias de la cartera',
    }));
  bloqueGrafico('Reparto de la cartera',
    G.graficoPrioridades(modelo.resumen, { w: ANCHO_UTIL }));
  bloqueGrafico('Mayores caídas de vigor',
    G.graficoRankingCaidas(modelo.filas, { w: ANCHO_UTIL }));

  // ── Agroclima: los tres gráficos del dashboard ────────────────────────
  //
  // Mismos datos y mismos ejes que `/app` (salen de `calcularAgroclim`), para
  // que el asesor que mira el PDF en el campo y el que mira la pantalla en la
  // oficina no puedan discrepar sobre el mismo número.
  if (modelo.agroclim) {
    const a = modelo.agroclim;
    // Con varios cuarteles la curva es la del clima que comparten, no la de
    // cada uno: decirlo evita que se lea como específica de un solo cuartel.
    const deQuien = a.origen && a.origen.compartido
      ? ` — calculado en ${a.origen.cuartel}, compartido por ${a.origen.cuarteles} cuarteles del mismo clima`
      : a.origen && a.origen.cuartel ? ` — ${a.origen.cuartel}` : '';
    bloqueGrafico(`Grados-día acumulados${deQuien}`, G.graficoGdd(a.gdd, { w: ANCHO_UTIL }));
    bloqueGrafico('Horas frío acumuladas', G.graficoHorasFrio(a.chill, { w: ANCHO_UTIL }));
    bloqueGrafico('Temperaturas de la temporada', G.graficoTemperaturas(a.temps, { w: ANCHO_UTIL }));
  }

  // ── Nota metodológica ─────────────────────────────────────────────────
  {
    const nota = 'La prioridad usa los mismos umbrales con los que la plataforma envía las alertas ' +
      '(helada bajo 2 °C, calor sobre 35 °C, lluvia de 7 días bajo 5 mm, caída de vigor de 15 %) y el ' +
      'mismo criterio de "cuarteles en baja" del panel: la variación de la última lectura satelital ' +
      'contra las 4 capturas anteriores. El nivel de riesgo no distingue etapa fenológica: tómalo como ' +
      'alerta de atención, no como diagnóstico agronómico cerrado.';
    const lineas = partirEnLineas(nota, ANCHO_UTIL, 6.8);
    asegurar(lineas.length * 9 + 12);
    lineas.forEach((l, i) => texto(l, MARGEN.x, y + 8 + i * 9, 6.8, { fill: C.suave }));
    y += lineas.length * 9 + 10;
  }

  if (ops.length) paginas.push({ ancho: A4.ancho, alto: A4.alto, ops });

  // Pie con el número de página, una vez que se sabe cuántas hay.
  paginas.forEach((p, i) => {
    const s = `SmartField INIA — Instituto de Investigaciones Agropecuarias · Plataforma operada por SADATA`;
    const n = `${i + 1} / ${paginas.length}`;
    p.ops.push({ t: 'linea', x1: MARGEN.x, y1: A4.alto - 34, x2: A4.ancho - MARGEN.x, y2: A4.alto - 34, color: C.grid, w: 0.5 });
    p.ops.push({ t: 'texto', x: MARGEN.x, y: A4.alto - 24, s, pt: 6.8, fill: C.suave });
    p.ops.push({ t: 'texto', x: A4.ancho - MARGEN.x - medir(n, 6.8), y: A4.alto - 24, s: n, pt: 6.8, fill: C.suave });
  });

  return paginas;
}

module.exports = { armarPaginas, C, COLOR_PRIORIDAD };

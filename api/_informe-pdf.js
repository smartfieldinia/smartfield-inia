// ════════════════════════════════════════════════════════════════════════
// api/_informe-pdf.js — escribe un PDF a mano, sin librerías.
//
// Por qué a mano: el informe es texto, tablas y filetes. Con las fuentes base-14
// (`/Helvetica`, `/Helvetica-Bold`), que todo lector trae, no hay nada que
// embeber: sale un PDF de 20-40 KB, vectorial, con el texto seleccionable y
// buscable, en unos milisegundos. Las alternativas eran traer `pdfkit` (una
// dependencia para esto) o rasterizar con Chrome headless (~50 MB de bundle y
// varios segundos dentro de un cron que ya está contra su `maxDuration`).
// Es la misma decisión que ya tomó el proyecto al hablarle REST a Supabase en
// vez de usar el SDK.
//
// Entra un display list —posiciones absolutas en puntos, calculadas por
// `_informe-layout.js`— y sale un Buffer. Este archivo no sabe nada del
// informe: solo traduce operaciones de dibujo a operadores PDF.
//
// Sistema de coordenadas: el display list tiene el origen ARRIBA a la izquierda
// (como una pantalla) y el PDF lo tiene ABAJO, así que la Y se invierte acá y en
// un solo lugar.
//
// Helper con `_`: no consume cupo de funciones serverless.
// ════════════════════════════════════════════════════════════════════════

const zlib = require('zlib');
const { aWinAnsi, limpiar } = require('./_informe-fuente');

// A4 en puntos (72 por pulgada).
const A4 = { ancho: 595.28, alto: 841.89 };

// '#0e9384' → '0.055 0.576 0.518'
function rgb(hex) {
  const h = String(hex || '#000').replace('#', '');
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const v = parseInt(n, 16);
  const f = x => (x / 255).toFixed(3);
  return `${f((v >> 16) & 255)} ${f((v >> 8) & 255)} ${f(v & 255)}`;
}

// Escapa lo que en un string PDF es sintaxis: paréntesis y barra invertida.
function escaparPDF(buf) {
  const out = [];
  for (const b of buf) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out.push(0x5c);
    out.push(b);
  }
  return Buffer.from(out);
}

// ── Display list → operadores de contenido ──────────────────────────────
function operadores(pagina) {
  const partes = [];
  const push = s => partes.push(Buffer.from(s, 'latin1'));
  // Y del display list (origen arriba) → Y del PDF (origen abajo).
  const Y = y => (pagina.alto - y).toFixed(2);

  for (const op of pagina.ops) {
    switch (op.t) {
      case 'rect': {
        push(`${rgb(op.fill)} rg\n`);
        push(`${op.x.toFixed(2)} ${Y(op.y + op.h)} ${op.w.toFixed(2)} ${op.h.toFixed(2)} re f\n`);
        break;
      }
      case 'linea': {
        // Con `dash` hay que aislar el estado: el patrón queda activo para todo
        // lo que se dibuje después en la misma página. Sin `dash` se mantiene el
        // camino de siempre, que no lo necesita.
        if (Array.isArray(op.dash) && op.dash.length) {
          push(`q ${rgb(op.color)} RG ${(op.w || 0.6).toFixed(2)} w [${op.dash.join(' ')}] 0 d\n`);
          push(`${op.x1.toFixed(2)} ${Y(op.y1)} m ${op.x2.toFixed(2)} ${Y(op.y2)} l S Q\n`);
          break;
        }
        push(`${rgb(op.color)} RG ${(op.w || 0.6).toFixed(2)} w\n`);
        push(`${op.x1.toFixed(2)} ${Y(op.y1)} m ${op.x2.toFixed(2)} ${Y(op.y2)} l S\n`);
        break;
      }
      // Las flechas de tendencia son triángulos DIBUJADOS, no caracteres:
      // WinAnsi no tiene ▲ ni ▼ y saldrían como interrogantes.
      case 'tri': {
        const s = op.s || 5;
        const y = op.y;
        push(`${rgb(op.fill)} rg\n`);
        if (op.dir === 'up') {
          push(`${op.x.toFixed(2)} ${Y(y + s)} m ${(op.x + s).toFixed(2)} ${Y(y + s)} l ${(op.x + s / 2).toFixed(2)} ${Y(y)} l f\n`);
        } else {
          push(`${op.x.toFixed(2)} ${Y(y)} m ${(op.x + s).toFixed(2)} ${Y(y)} l ${(op.x + s / 2).toFixed(2)} ${Y(y + s)} l f\n`);
        }
        break;
      }
      // Polilínea abierta: la curva de vigor y las dos líneas del pronóstico.
      // Se traza punto a punto porque el display list ya viene resuelto en
      // puntos absolutos — acá no se escala ni se interpola nada.
      case 'poli': {
        const pts = op.puntos || [];
        if (pts.length < 2) break;
        // `q`/`Q` aíslan el estado gráfico. `1 J 1 j` (puntas y uniones
        // redondeadas) es lo que hace legible una curva de pocos puntos, pero
        // NADIE lo reescribe después: sin el `Q`, todos los filetes de la tabla
        // que vengan más abajo en la misma página salen con puntas redondas.
        push(`q ${rgb(op.color)} RG ${(op.w || 1).toFixed(2)} w 1 J 1 j\n`);
        // Trazo discontinuo, para la curva de la temporada ANTERIOR: es el
        // mismo lenguaje visual del dashboard, donde la temporada previa va
        // punteada al lado de la actual. `[on off] fase d` en unidades de
        // usuario. Va dentro del `q`/`Q`, así que no se filtra al resto.
        if (Array.isArray(op.dash) && op.dash.length) push(`[${op.dash.join(' ')}] 0 d\n`);
        push(`${pts[0][0].toFixed(2)} ${Y(pts[0][1])} m\n`);
        for (let i = 1; i < pts.length; i++) push(`${pts[i][0].toFixed(2)} ${Y(pts[i][1])} l\n`);
        push('S Q\n');
        break;
      }
      // Polígono relleno y cerrado: bandas de umbral y el área bajo una curva.
      // `h` cierra el contorno antes de rellenar, así que el llamador no tiene
      // que repetir el primer punto al final.
      case 'area': {
        const pts = op.puntos || [];
        if (pts.length < 3) break;
        push(`q ${rgb(op.fill)} rg\n`);
        push(`${pts[0][0].toFixed(2)} ${Y(pts[0][1])} m\n`);
        for (let i = 1; i < pts.length; i++) push(`${pts[i][0].toFixed(2)} ${Y(pts[i][1])} l\n`);
        push('h f Q\n');
        break;
      }
      // El logo de la cabecera. Una sola imagen posible (`/Logo`), embebida una
      // vez por archivo en `renderPDF`: no hace falta más y así no hay registro
      // de imágenes que mantener. `y` es el borde SUPERIOR, como en `rect`.
      case 'imagen': {
        push(`q ${op.w.toFixed(2)} 0 0 ${op.h.toFixed(2)} ${op.x.toFixed(2)} ${Y(op.y + op.h)} cm /Logo Do Q\n`);
        break;
      }
      case 'texto': {
        const txt = escaparPDF(aWinAnsi(limpiar(op.s)));
        push(`BT /${op.bold ? 'FB' : 'FR'} ${op.pt} Tf ${rgb(op.fill || '#000')} rg\n`);
        // `op.y` es la línea base del texto.
        push(`1 0 0 1 ${op.x.toFixed(2)} ${Y(op.y)} Tm\n(`);
        partes.push(txt);
        push(`) Tj ET\n`);
        break;
      }
      default:
        break;   // un op desconocido se ignora: nunca tumba el informe entero
    }
  }
  return Buffer.concat(partes);
}

// ── Ensamblado del archivo ──────────────────────────────────────────────
function renderPDF(paginas, { titulo = 'Informe', autor = 'SmartField INIA' } = {}) {
  const objetos = [];                       // objetos[i] = Buffer del objeto i+1
  const agregar = buf => { objetos.push(buf); return objetos.length; };
  const b = s => Buffer.from(s, 'latin1');

  // Los ids se reservan antes de escribir: Pages tiene que nombrar a sus hijos y
  // cada Page tiene que nombrar a su padre.
  const idCatalogo = 1, idPages = 2, idFR = 3, idFB = 4;
  objetos.length = 4;

  objetos[idFR - 1] = b('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objetos[idFB - 1] = b('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  // El logo se embebe solo si alguna página lo usa: el PDF sin cabecera (o un
  // fixture) queda byte a byte como antes. Color y alfa ya vienen comprimidos
  // con zlib desde `_informe-logo.js`; el alfa va como /SMask para que el
  // fondo transparente del PNG siga siéndolo.
  let idLogo = null;
  if (paginas.some(p => p.ops.some(op => op.t === 'imagen'))) {
    const logo = require('./_informe-logo');
    const rgbZ = Buffer.from(logo.rgb, 'base64');
    const alfaZ = Buffer.from(logo.alfa, 'base64');
    const comunes = `/Type /XObject /Subtype /Image /Width ${logo.ancho} /Height ${logo.alto} /BitsPerComponent 8 /Filter /FlateDecode`;
    const idAlfa = agregar(Buffer.concat([
      b(`<< ${comunes} /ColorSpace /DeviceGray /Length ${alfaZ.length} >>\nstream\n`), alfaZ, b('\nendstream')]));
    idLogo = agregar(Buffer.concat([
      b(`<< ${comunes} /ColorSpace /DeviceRGB /SMask ${idAlfa} 0 R /Length ${rgbZ.length} >>\nstream\n`), rgbZ, b('\nendstream')]));
  }

  const idsPagina = [];
  for (const pagina of paginas) {
    const contenido = operadores(pagina);
    const comprimido = zlib.deflateSync(contenido);   // `zlib` es de Node, no una dependencia
    const idStream = agregar(Buffer.concat([
      b(`<< /Length ${comprimido.length} /Filter /FlateDecode >>\nstream\n`),
      comprimido,
      b('\nendstream'),
    ]));
    const idPagina = agregar(b(
      `<< /Type /Page /Parent ${idPages} 0 R ` +
      `/MediaBox [0 0 ${pagina.ancho.toFixed(2)} ${pagina.alto.toFixed(2)}] ` +
      `/Resources << /Font << /FR ${idFR} 0 R /FB ${idFB} 0 R >>${idLogo ? ` /XObject << /Logo ${idLogo} 0 R >>` : ''} >> ` +
      `/Contents ${idStream} 0 R >>`));
    idsPagina.push(idPagina);
  }

  objetos[idPages - 1] = b(
    `<< /Type /Pages /Count ${idsPagina.length} /Kids [${idsPagina.map(i => `${i} 0 R`).join(' ')}] >>`);
  objetos[idCatalogo - 1] = b(`<< /Type /Catalog /Pages ${idPages} 0 R >>`);

  const meta = agregar(Buffer.concat([
    b('<< /Title ('), escaparPDF(aWinAnsi(limpiar(titulo))),
    b(') /Author ('), escaparPDF(aWinAnsi(limpiar(autor))),
    b(') /Producer (SmartField INIA) >>'),
  ]));

  // Cuerpo + tabla xref: el lector salta directo al byte de cada objeto, así que
  // los desplazamientos tienen que ser exactos.
  const trozos = [b('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
  let pos = trozos[0].length;
  const offsets = [];
  objetos.forEach((obj, i) => {
    offsets.push(pos);
    const t = Buffer.concat([b(`${i + 1} 0 obj\n`), obj, b('\nendobj\n')]);
    trozos.push(t);
    pos += t.length;
  });

  const inicioXref = pos;
  let xref = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += String(off).padStart(10, '0') + ' 00000 n \n';
  xref += `trailer\n<< /Size ${objetos.length + 1} /Root ${idCatalogo} 0 R /Info ${meta} 0 R >>\n` +
          `startxref\n${inicioXref}\n%%EOF\n`;
  trozos.push(b(xref));

  return Buffer.concat(trozos);
}

module.exports = { renderPDF, operadores, A4, rgb };

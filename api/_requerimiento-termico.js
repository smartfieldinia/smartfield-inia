// ════════════════════════════════════════════════════════════════════════
// api/_requerimiento-termico.js — cuántos grados-día y cuántas horas frío
// necesita cada cultivo, según la tabla oficial de INIA.
//
// Fuente: hoja "Requerimiento Termico Frutales" de la planilla que Stanley
// exportó de agrometeorologia.cl el 13-08-2026. 224 filas, 5 capítulos,
// 45 cultivos. Dos columnas por variedad:
//   GD10 — grados-día base 10 °C que el cultivo necesita acumular desde yema
//          hinchada (salida de dormancia) hasta cosecha.
//   HF7  — horas frío bajo 7 °C que necesita en invierno para romper la
//          dormancia. Solo aplica a especies de hoja caduca: 153 de las 224
//          filas la traen, el resto va en `null` y NO se debe mostrar como 0.
//
// La BASE es siempre 10 °C en toda la tabla — es la de la vid, la mayoría de
// los frutales y el índice de Winkler, y la misma `GDD_BASE` con la que el
// dashboard acumula. Lo que cambia por cultivo es el REQUERIMIENTO, no la base:
// el rótulo de la UI tiene que decirlo así o se lee al revés.
//
// Los `_` del prefijo no son endpoints: este archivo no consume ninguno de los
// 12 cupos de funciones serverless del plan Hobby.
// ════════════════════════════════════════════════════════════════════════

// [capítulo, cultivo, [[variedad, gd10, hf7], ...]]
// "Promedio" y "Valor especie" son filas de la propia fuente, no calculadas
// acá: son el valor de referencia de la especie cuando no se sabe la variedad.
const TABLA = [

  // ── Frutales ──────────────────────────────────────────────────────────
  ['Frutales', 'Almendro', [
    ['Non Pareil', 1337, 392],
    ['Ruby', 1365, 392],
    ['Texas prolific', 1552, 496],
    ['Thompson', 1555, 478],
    ['Merced', 1454, 410],
    ['Promedio', 1453, 434],
  ]],
  ['Frutales', 'Arándano', [
    ['Elliott', 500, 1200],
    ['Bluecrop', 500, 1000],
    ['Keepsake', 500, 1000],
    ['Sensation', 500, 1000],
    ['Duke', 500, 900],
    ['Star', 500, 900],
    ['Brigitta', 500, 900],
    ['Aurora', 500, 900],
    ['Draper', 700, 800],
    ['Liberty', 500, 800],
    ['New Hanover', 500, 800],
    ['Legacy', 500, 700],
    ['Ochlockonee', 500, 700],
    ['Tifblue', 500, 700],
    ['Jubilee', 500, 700],
    ['O\' Neal', 500, 600],
    ['Blue cuinex', 500, 600],
    ['Reveille', 500, 600],
    ['Bluecrisp', 500, 500],
    ['Southmoon', 500, 500],
    ['Corona', 500, 500],
    ['Robust', 500, 500],
    ['Brightwell', 500, 400],
    ['Georgia Gem', 500, 400],
    ['Misty', 500, 400],
    ['Biloxi', 500, 400],
    ['Daybreak', 500, 400],
    ['Prelude', 500, 400],
    ['Jewel', 500, 300],
    ['Emerald', 500, 250],
    ['Rocío', 500, 200],
    ['Sunshine Blue', 500, 150],
    ['Promedio', 506, 628],
  ]],
  ['Frutales', 'Avellano Europeo', [
    ['Barcelona', 1000, 1040],
    ['Fertile de Coutard', 1000, 1040],
    ['Tonda di Giffoni', 1000, 680],
    ['Promedio', 1000, 920],
  ]],
  ['Frutales', 'Caqui', [
    ['Valor especie', 1600, 500],
  ]],
  ['Frutales', 'Cerezo', [
    ['Sylvia', 302, 1200],
    ['Summit', 356, 1081],
    ['Rainier', 330, 800],
    ['Van', 320, 668],
    ['Newstar', 322, 654],
    ['Burlat', 324, 604],
    ['Lapins', 331, 500],
    ['Brooks', 353, 500],
    ['Marvin', 308, 200],
    ['Promedio', 327, 690],
  ]],
  ['Frutales', 'Ciruelo Europeo', [
    ['President', 1465, 634],
    ['Stanley', 1461, 634],
    ['French Improved', 1390, 625],
    ['Imperial', 1118, 625],
    ['Promedio', 1359, 630],
  ]],
  ['Frutales', 'Damasco', [
    ['Imperial', 764, 570],
    ['Royal', 709, 570],
    ['Tilton', 735, 570],
    ['Modesto', 647, 534],
    ['Promedio', 714, 561],
  ]],
  ['Frutales', 'Duraznero', [
    ['Andross', 1026, 850],
    ['O\'Henry', 1165, 642],
    ['Caroline', 1144, 634],
    ['Dixon', 931, 634],
    ['Corona', 1383, 625],
    ['Fortuna', 890, 625],
    ['September Lady', 1553, 625],
    ['Gem free', 659, 607],
    ['Blazing Gold', 581, 539],
    ['Red globe', 874, 534],
    ['Springtime', 399, 429],
    ['FloridaKing', 580, 367],
    ['Flordaprince', 494, 323],
    ['Promedio', 898, 572],
  ]],
  ['Frutales', 'Frambueso', [
    ['Meeker', 500, 1200],
    ['Ruby', 500, 1185],
    ['Autumn Bliss', 500, 1114],
    ['Amity', 500, 1000],
    ['Heritage', 500, 800],
    ['Promedio', 500, 1060],
  ]],
  ['Frutales', 'Frutilla', [
    ['Chilena', 310, 700],
    ['Virginia', 310, 700],
    ['Monterrey', 310, 700],
    ['Camarosa', 310, 700],
    ['Benicia', 310, 700],
    ['Chandler', 310, 700],
    ['Cristal', 310, 700],
    ['Albión', 310, 700],
    ['Promedio', 310, 700],
  ]],
  ['Frutales', 'Grosella', [
    ['Valor especie', 900, 1500],
  ]],
  ['Frutales', 'Guindo', [
    ['BMontmorency', 638, 638],
    ['Stockton Morello', 665, 638],
    ['English Morello', 645, 625],
    ['Meteor', 781, 625],
    ['Promedio', 682, 632],
  ]],
  ['Frutales', 'Manzano', [
    ['Pink Lady', 500, 1750],
    ['Granny Smith', 705, 1610],
    ['Granny Smith Spur', 705, 1581],
    ['Starkrimson', 705, 1466],
    ['Starking Delicious', 714, 1433],
    ['Atwood', 718, 1419],
    ['Red King Oregon', 705, 1414],
    ['Richared Delicious', 714, 1408],
    ['Red Spur', 705, 1404],
    ['Royal Gala', 800, 1400],
    ['Fuji', 800, 1400],
    ['Red Delicious', 800, 1400],
    ['Red Chief Spur', 687, 1356],
    ['Top Red Delicious', 705, 1350],
    ['Black John', 705, 1281],
    ['Golden Spur', 705, 1244],
    ['Double Red MacIntosh', 705, 1182],
    ['Lodi', 705, 781],
    ['Stark Earliest', 665, 678],
    ['Promedio', 708, 1345],
  ]],
  ['Frutales', 'Nectarino', [
    ['Crimson Gold', 701, 616],
    ['Early Sungrand', 688, 616],
    ['Fantasia', 920, 616],
    ['Flavortop', 994, 616],
    ['Sun Grand', 798, 616],
    ['Early Legrand', 858, 611],
    ['Flamekist', 1270, 611],
    ['Armiking', 567, 577],
    ['Late Legrand', 1224, 559],
    ['Mayred', 555, 491],
    ['Sundowner', 655, 359],
    ['Promedio', 839, 572],
  ]],
  ['Frutales', 'Olivo', [
    ['Arbequina', 1476, 350],
    ['Empeltre', 1463, 300],
    ['Liguria', 1468, 300],
    ['Sevillano', 1527, 300],
    ['Promedio', 1484, 313],
  ]],
  ['Frutales', 'Peral', [
    ['Beurre Bosc', 1586, 700],
    ['Doyenne du Comice', 1155, 700],
    ['Bartlett de invierno', 1615, 678],
    ['Beurre D\'Anjou', 1413, 678],
    ['Packham\'s Triumph', 1356, 678],
    ['Bartlett de verano', 1204, 674],
    ['Winter Nellis', 1652, 665],
    ['Duquesa de Angulema', 1236, 660],
    ['Salvador Izquierdo', 1729, 660],
    ['Promedio', 1438, 677],
  ]],
  ['Frutales', 'Pistacho', [
    ['Kerman', 3000, 1000],
    ['Larnaca', 2800, 650],
    ['Promedio', 2900, 825],
  ]],
  ['Frutales', 'Vid', [
    ['País', 1600, 1000],
    ['Cabernet Sauvignon', 1367, 1000],
    ['Promedio', 1484, 1000],
  ]],

  // ── Cereales ──────────────────────────────────────────────────────────
  ['Cereales', 'Arroz', [
    ['Zafiro-INIA', 1242, null],
    ['Cuarzo-INIA', 1264, null],
    ['Promedio', 1253, null],
  ]],
  ['Cereales', 'Avena', [
    ['Valor especie', 1700, null],
  ]],
  ['Cereales', 'Maíz', [
    ['Saccharata cu. Jubilee', 920, null],
    ['Saccharata cu. GH-2757', 970, null],
    ['Promedio', 945, null],
  ]],
  ['Cereales', 'Quinoa', [
    ['Valor especie', 506, 628],
  ]],
  ['Cereales', 'Sorgo', [
    ['Valor especie', 1400, null],
  ]],
  ['Cereales', 'Trigo', [
    ['Lasana-INIA', 1671, null],
    ['Millán-INIA', 1671, null],
    ['Pandora-INIA', 1671, null],
    ['Maxwell', 1626, null],
    ['Kipa-INIA', 1500, null],
    ['Suri-INIA', 1500, null],
    ['Dollinco-INIA', 1408, null],
    ['Pantera-INIA', 1671, null],
    ['Promedio', 1590, null],
  ]],
  ['Cereales', 'Triticale', [
    ['Primaveral', 1000, null],
    ['Invernal', 1300, null],
    ['Promedio', 1150, null],
  ]],

  // ── Hortalizas ────────────────────────────────────────────────────────
  ['Hortalizas', 'Ají', [
    ['Valor especie', 950, null],
  ]],
  ['Hortalizas', 'Ajo', [
    ['Valor especie', 900, null],
  ]],
  ['Hortalizas', 'Alcachofa', [
    ['A-110', 1376, null],
    ['Lorca', 1360, null],
    ['Imperial Star', 1376, null],
    ['Tavor', 1392, null],
    ['Arad', 1486, null],
    ['Promedio', 1398, null],
  ]],
  ['Hortalizas', 'Brócoli', [
    ['Legacy', 909, null],
  ]],
  ['Hortalizas', 'Cebolla', [
    ['Valor especie', 900, null],
  ]],
  ['Hortalizas', 'Espinaca', [
    ['Ballet', 710, null],
    ['Santana', 710, null],
    ['Correnta', 710, null],
    ['Denali', 710, null],
    ['Whitney', 710, null],
    ['Olympia', 710, null],
    ['Condesa', 582, null],
    ['Laska', 497, null],
    ['Viroflay', 416, null],
    ['Quinto', 406, null],
    ['Marimba', 299, null],
    ['Promedio', 587, null],
  ]],
  ['Hortalizas', 'Haba', [
    ['Valor especie', 650, null],
  ]],
  ['Hortalizas', 'Melón', [
    ['Honey Dew Green Flesh', 1213, null],
    ['Winter Dew', 1108, null],
    ['Promedio', 1161, null],
  ]],
  ['Hortalizas', 'Papa', [
    ['Patagonia-INIA', 1291, null],
    ['Porvenir-INIA', 1291, null],
    ['Puyehue-INIA', 1291, null],
    ['Rayún-INIA', 1291, null],
    ['Yagana-INIA', 1291, null],
    ['Yaike-INIA', 1291, null],
    ['Karu-INIA', 1287, null],
    ['Pukará-INIA', 1287, null],
    ['Kuyén-INIA', 1287, null],
    ['Desiree', 1060, null],
    ['Promedio', 1267, null],
  ]],
  ['Hortalizas', 'Pepino Dulce', [
    ['Valor especie', 1100, null],
  ]],
  ['Hortalizas', 'Pimentón', [
    ['Valor especie', 950, null],
  ]],
  ['Hortalizas', 'Sandía', [
    ['Valor especie', 1200, null],
  ]],
  ['Hortalizas', 'Tomate', [
    ['Valor especie', 900, null],
  ]],

  // ── Leguminosas ───────────────────────────────────────────────────────
  ['Leguminosas', 'Arveja', [
    ['Spring', 700, null],
  ]],
  ['Leguminosas', 'Garbanzo', [
    ['Alfa INIA', 995, null],
  ]],
  ['Leguminosas', 'Lenteja', [
    ['Super Araucana INIA', 1006, null],
  ]],
  ['Leguminosas', 'Poroto', [
    ['Zorzal-INIA', 926, null],
    ['Blanco Español-INIA', 877, null],
    ['Curi-INIA', 854, null],
    ['Promedio', 886, null],
  ]],

  // ── Cultivos Industriales ─────────────────────────────────────────────
  ['Cultivos Industriales', 'Achicoria', [
    ['Cadence', 1800, null],
  ]],
  ['Cultivos Industriales', 'Raps', [
    ['Valor especie', 550, null],
  ]],
  ['Cultivos Industriales', 'Remolacha azucarera', [
    ['Valor especie', 1400, null],
  ]],
];

// Los nombres del `<select>` de cuarteles (`public/app.html`) no son los de la
// planilla de INIA. Verificado contra los 49 cuarteles de producción: las dos
// vides son "Vid" en la tabla, y hay tres cultivos ofrecidos por la app que INIA
// simplemente no publica. Devolver `null` para esos es la respuesta correcta —
// inventarles un requerimiento sería peor que no mostrar nada.
const ALIAS = {
  'vid / uva de mesa':  'Vid',
  'vid / uva vinifera': 'Vid',
  'vid / uva vinífera': 'Vid',
  'maiz':               'Maíz',
  'arandano':           'Arándano',
  'avellano':           'Avellano Europeo',
  'ciruelo':            'Ciruelo Europeo',
  'durazno':            'Duraznero',
  'frutilla':           'Frutilla',
};

// Sin requerimiento publicado por INIA: 'Palto', 'Nogal', 'Flores de corte' y
// 'Otro' del selector, más 'Hortalizas' —que en la planilla es un capítulo con
// 13 cultivos adentro, no un cultivo.
function normalizarCultivo(cultivo) {
  if (!cultivo) return null;
  const limpio = String(cultivo).trim();
  const clave = limpio.toLowerCase();
  if (ALIAS[clave]) return ALIAS[clave];
  // Sin tildes, por si el cultivo se guardó tipeado a mano.
  const sinTildes = clave.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [k, v] of Object.entries(ALIAS)) {
    if (k.normalize('NFD').replace(/[\u0300-\u036f]/g, '') === sinTildes) return v;
  }
  const fila = TABLA.find(([, cul]) =>
    cul.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === sinTildes);
  return fila ? fila[1] : null;
}

// Requerimiento de un cuartel. Cascada: variedad exacta → "Promedio"/"Valor
// especie" de la especie → null. Hoy NINGÚN cuartel de producción tiene variedad
// cargada, así que en la práctica siempre cae al valor de especie: el rótulo de
// la UI tiene que decir de cuál de los dos está hablando, y por eso se devuelve
// `origen`.
function requerimiento(cultivo, variedad) {
  const cul = normalizarCultivo(cultivo);
  if (!cul) return null;
  const fila = TABLA.find(([, c]) => c === cul);
  if (!fila) return null;
  const [capitulo, , variedades] = fila;

  if (variedad) {
    const v = String(variedad).trim().toLowerCase();
    const exacta = variedades.find(([nom]) => nom.toLowerCase() === v);
    if (exacta) {
      return { capitulo, cultivo: cul, variedad: exacta[0], gd10: exacta[1], hf7: exacta[2], origen: 'variedad' };
    }
  }

  const especie = variedades.find(([nom]) => nom === 'Promedio' || nom === 'Valor especie');
  if (!especie) return null;
  return { capitulo, cultivo: cul, variedad: especie[0], gd10: especie[1], hf7: especie[2], origen: 'especie' };
}

// Tabla plana para la UI: una fila por variedad, en el orden de la planilla.
function tablaCompleta() {
  const out = [];
  for (const [capitulo, cultivo, variedades] of TABLA) {
    for (const [variedad, gd10, hf7] of variedades) out.push({ capitulo, cultivo, variedad, gd10, hf7 });
  }
  return out;
}

// Para poblar el selector "comparar contra otro cultivo" de la tarjeta: los 36
// cuarteles en cultivo "Otro" no matchean nada, y reclasificarlos a mano no es
// razonable. Devuelve [{ capitulo, cultivos: [...] }].
function catalogo() {
  const porCap = new Map();
  for (const [capitulo, cultivo] of TABLA) {
    if (!porCap.has(capitulo)) porCap.set(capitulo, []);
    porCap.get(capitulo).push(cultivo);
  }
  return [...porCap].map(([capitulo, cultivos]) => ({ capitulo, cultivos }));
}

// Variedades de un cultivo, para el segundo nivel de ese selector.
function variedadesDe(cultivo) {
  const cul = normalizarCultivo(cultivo);
  const fila = cul && TABLA.find(([, c]) => c === cul);
  return fila ? fila[2].map(([variedad, gd10, hf7]) => ({ variedad, gd10, hf7 })) : [];
}

module.exports = { requerimiento, tablaCompleta, catalogo, variedadesDe, normalizarCultivo, TABLA };

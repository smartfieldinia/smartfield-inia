// ════════════════════════════════════════════════════════════════════════
// api/_informe-paleta.js — los colores del informe, en un solo lugar.
//
// Vivían dentro de `_informe-layout.js`. Se mueven acá porque ahora los usan
// también los gráficos (`_informe-graficos.js`), y hacer que ese módulo
// importara al layout —que a su vez lo importa a él— habría creado un ciclo:
// Node lo tolera, pero uno de los dos ve el `module.exports` del otro a medio
// llenar, y el síntoma sería un color `undefined` que `rgb()` pinta de negro.
//
// `_informe-layout.js` los re-exporta para no romper a quien ya los importaba
// de ahí.
//
// Paleta tomada de `eval/informe-riesgo-climatico/build.js`, validada para
// impresión.
//
// Helper con `_`: no consume cupo de funciones serverless.
// ════════════════════════════════════════════════════════════════════════

// Marca INIA SmartField (oct-2026): `teal` es el verde del logo INIA y `lima`
// el de "FIELD". El lima no se lee en texto chico sobre blanco: va solo en
// acentos (reglas, barras); el texto de marca usa `teal`.
const C = {
  teal:    '#007667',
  lima:    '#7FBB00',
  tinta:   '#0f1720',
  suave:   '#5b6b73',
  grid:    '#e3e7eb',
  fondo:   '#f6f8f8',
  blanco:  '#ffffff',
  critico: '#b91c1c',
  ambar:   '#b45309',
  amarillo:'#a16207',
  verde:   '#1a9850',
  // Tintes claros, para rellenos que van DEBAJO de texto o de una línea. Los
  // colores plenos de arriba no sirven ahí: tapan lo que están acompañando.
  fríoSuave:   '#e7f0fb',
  frio:        '#2563a8',
  criticoTinte:'#fde7e7',
  tealTinte:   '#e3f1ee',
};

// Un color por prioridad. El badge se lee antes que el texto: es lo que ordena
// la visita.
const COLOR_PRIORIDAD = {
  'ALTA':       { fondo: '#fde7e7', texto: C.critico },
  'MEDIA-ALTA': { fondo: '#fdf0e0', texto: C.ambar },
  'MEDIA-BAJA': { fondo: '#fdfae0', texto: C.amarillo },
  'BAJA':       { fondo: '#e9f5ec', texto: C.verde },
};

module.exports = { C, COLOR_PRIORIDAD };

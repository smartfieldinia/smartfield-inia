// ════════════════════════════════════════════════════════════════════════
// Reverse geocoding del centroide de un campo → comuna + región, vía
// Nominatim/OSM. El polígono es la fuente de verdad de la ubicación: el
// usuario no elige región a mano, se deriva de lo que dibujó.
//
// Best-effort: nunca lanza; devuelve nulls si falla (timeout, sin resultado,
// rate limit). Lo llaman api/geocode.js (al dibujar, para mostrarle al usuario
// lo detectado) y api/fields.js (al guardar, si el cliente no lo mandó).
// ════════════════════════════════════════════════════════════════════════

// ISO 3166-2:CL → el nombre corto que ya usa la plataforma. Es el mismo valor
// que producía el antiguo <select> de región del registro y el que espera
// `alert_rules.zona` (lo matchea con `eq.` exacto desde cron/check-alerts.js),
// así que NO se puede cambiar de formato sin romper los umbrales de alertas.
//
// Se mapea por código ISO y no por el nombre largo (`address.state`) porque ese
// es irregular: "Región de la Araucanía", "Región del Maule", "Región Aysén del
// General Carlos Ibáñez del Campo". Los 16 códigos están verificados uno por uno
// contra Nominatim.
const REGION_POR_ISO = {
  'CL-AP': 'Arica y Parinacota', 'CL-TA': 'Tarapacá',  'CL-AN': 'Antofagasta',
  'CL-AT': 'Atacama',            'CL-CO': 'Coquimbo',  'CL-VS': 'Valparaíso',
  'CL-RM': 'Metropolitana',      'CL-LI': "O'Higgins", 'CL-ML': 'Maule',
  'CL-NB': 'Ñuble',              'CL-BI': 'Biobío',    'CL-AR': 'La Araucanía',
  'CL-LR': 'Los Ríos',           'CL-LL': 'Los Lagos', 'CL-AI': 'Aysén',
  'CL-MA': 'Magallanes',
};

const SIN_UBICACION = { comuna: null, region: null, regionLarga: null };

function centroidOf(polygon) {
  if (!Array.isArray(polygon) || !polygon.length) return null;
  let sx = 0, sy = 0, n = 0;
  for (const c of polygon) { if (Array.isArray(c) && c.length >= 2) { sx += c[0]; sy += c[1]; n++; } }
  return n ? { lon: sx / n, lat: sy / n } : null;
}

// → { comuna, region, regionLarga } — cualquiera puede venir null.
// `regionLarga` es solo para mostrar; lo que se guarda en BD es `region`.
async function reverseGeocode(polygon) {
  const centroid = centroidOf(polygon);
  if (!centroid) return SIN_UBICACION;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${centroid.lat}&lon=${centroid.lon}&zoom=10&addressdetails=1`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'SmartExtensionINIA/1.0 (contacto@sadata.io)' },
      // Corto a propósito: esto es best-effort y corre dentro del POST que crea
      // el campo. Mejor guardar sin comuna que timeoutear el alta entera.
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return SIN_UBICACION;
    const a = (await r.json()).address || {};
    return {
      // En Chile la comuna viene como city/town/village según el tamaño del
      // lugar. OJO: `county` es la PROVINCIA ("Provincia de Maipo"), no la
      // comuna — no sirve de fallback, devolvería basura.
      comuna:      a.city || a.town || a.village || a.municipality || null,
      region:      REGION_POR_ISO[a['ISO3166-2-lvl4']] || null,
      regionLarga: a.state || null,
    };
  } catch {
    return SIN_UBICACION;
  }
}

module.exports = { reverseGeocode, REGION_POR_ISO, centroidOf };

// ════════════════════════════════════════════════════════════════════════
// Normalización del shape de `preferencias` (jsonb en users_profile y
// user_fields). Shape viejo: 5 booleanos planos {helada,calor,sequia,ndvi,
// boletin}. Shape nuevo: 4 categorías anidadas con subcategorías. Sin
// migración de datos en BD — se normaliza on-read en cada punto que lee
// `preferencias` (check-alerts.js, api/profile.js GET, pantalla de ajustes).
// ════════════════════════════════════════════════════════════════════════

const DEFAULTS = {
  clima:      { helada: true, calor: true, sequia: true, horas_frio: false },
  satelital:  { ndvi_caida: true, comparacion_temporada: false },
  boletin:    { resumen_semanal: true },
  biblioteca: { novedades: false }, // placeholder — sin cron de biblioteca aún
  // Canales de salida (Stanley, 2026-08-05: "por WhatsApp y/o por correo").
  // Los dos en true: el correo es hoy el único canal que puede decir el día de
  // un evento a 2-5 días, porque las plantillas de WhatsApp aprobadas tienen el
  // texto fijo en "esta noche" (ver check-alerts.js).
  canales:    { whatsapp: true, email: true },
};

const OLD_KEYS = ['helada', 'calor', 'sequia', 'ndvi', 'boletin'];

function isOldShape(raw) {
  return OLD_KEYS.some(k => k in raw) && !('clima' in raw) && !('satelital' in raw);
}

// normalizePrefs(raw) → siempre devuelve el shape nuevo completo (4 categorías,
// sin claves faltantes), con defaults para lo que no venga definido.
function normalizePrefs(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};

  if (isOldShape(src)) {
    return {
      clima:      { helada: !!src.helada, calor: !!src.calor, sequia: !!src.sequia, horas_frio: DEFAULTS.clima.horas_frio },
      satelital:  { ndvi_caida: !!src.ndvi, comparacion_temporada: DEFAULTS.satelital.comparacion_temporada },
      boletin:    { resumen_semanal: !!src.boletin },
      biblioteca: { ...DEFAULTS.biblioteca },
      canales:    { ...DEFAULTS.canales },
    };
  }

  return {
    clima:      { ...DEFAULTS.clima, ...(src.clima || {}) },
    satelital:  { ...DEFAULTS.satelital, ...(src.satelital || {}) },
    boletin:    { ...DEFAULTS.boletin, ...(src.boletin || {}) },
    biblioteca: { ...DEFAULTS.biblioteca, ...(src.biblioteca || {}) },
    canales:    { ...DEFAULTS.canales, ...(src.canales || {}) },
  };
}

// Merge shallow por categoría: las subclaves definidas a nivel de campo/cuartel
// pisan las del perfil global; si el campo no define una categoría, hereda
// 100% la del perfil.
function mergePrefs(perfilPrefs, campoPrefs) {
  const base = normalizePrefs(perfilPrefs);
  if (!campoPrefs || typeof campoPrefs !== 'object') return base;
  const overrides = normalizePrefs(campoPrefs); // por si viene shape viejo también a nivel de campo
  const out = {};
  for (const cat of Object.keys(base)) {
    out[cat] = campoPrefs[cat] ? { ...base[cat], ...overrides[cat] } : base[cat];
  }
  return out;
}

module.exports = { normalizePrefs, mergePrefs, DEFAULTS };

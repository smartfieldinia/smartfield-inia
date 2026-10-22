// ════════════════════════════════════════════════════════════════════════
// Backfill satelital histórico (2024→último mes cerrado) — imágenes de los 6
// índices + datos escalares, por campo. Tres usos con el MISMO mecanismo
// idempotente (api/_backfill.js):
//   1. Trigger por campo nuevo: fields.js handlePost lo invoca fire-and-forget
//      con ?field_id= al crear un cuartel.
//   2. Sweep diario (cron 08:30 UTC en vercel.json, sin params): completa
//      backfills interrumpidos, reintenta meses nublados (tope 3), y el día 1+
//      de cada mes agrega el mes recién cerrado a todos los campos.
//   3. Backfill one-off manual de campos existentes (curl en loop hasta
//      done:true).
//   4. Modo legacy ?anchor=YYYY-MM-DD: un solo punto escalar por campo a esa
//      fecha (absorbido del antiguo cron/backfill-ndvi.js, eliminado porque el
//      plan Hobby de Vercel topa en 12 funciones y este mecanismo lo reemplaza).
// Presupuesto: deadline 240s dentro de maxDuration 300 → ~12-18 snapshots
// mensuales por invocación; lo que no alcanza queda done:false y lo termina
// la corrida siguiente.
// Seguridad: exige Authorization: Bearer ${CRON_SECRET} (igual que
// check-alerts.js; Vercel Cron lo manda solo al existir la env var).
// ════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { sbSelect, sbUpsert } = require('../_supabase');
const { getIndices } = require('../_sensors');
const { backfillField } = require('../_backfill');

// Modo legacy: un punto escalar por campo anclado a una fecha arbitraria
// (comportamiento exacto del antiguo backfill-ndvi.js).
async function backfillAnchor(res, anchorDate) {
  const resumen = { campos: 0, insertados: 0, sinDato: 0, errores: [] };
  const campos = await sbSelect('user_fields', { select: 'id,nombre,polygon_coords' });
  resumen.campos = campos.length;
  for (const campo of campos) {
    if (!Array.isArray(campo.polygon_coords) || campo.polygon_coords.length < 3) { resumen.sinDato++; continue; }
    try {
      const { ndvi, ndre, evi, msavi, tcari, ndmi, error } = await getIndices({ polygon: campo.polygon_coords, days: 90, endDate: anchorDate });
      if (ndvi == null) {
        resumen.sinDato++;
        if (error) resumen.errores.push(`${campo.nombre || campo.id}: ${error}`);
        continue;
      }
      await sbUpsert('ndvi_history', [{ field_id: campo.id, fecha: anchorDate, ndvi, ndre, evi, msavi, tcari, ndmi }], 'field_id,fecha');
      resumen.insertados++;
    } catch (e) {
      resumen.errores.push(`${campo.nombre || campo.id}: ${e.message}`);
    }
  }
  return res.status(200).json({ ok: true, anchor: anchorDate, ...resumen });
}

const DEADLINE_MS = 240000;

// Tope por campo dentro de una corrida. Sin esto, un campo recién creado (31
// meses × 7 llamadas a GEE) se come los 240 s enteros y ningún otro avanza.
const MS_POR_CAMPO = 45000;

// El sweep arranca cada día en un campo distinto. Con `order` estable, el
// offset por día hace que cada campo sea el primero una vez cada N corridas:
// el que quedó a mitad ayer sigue hoy, y el del final de la lista no espera
// para siempre. Determinístico, sin cursor persistido ni tabla nueva.
function rotarPorDia(campos) {
  if (campos.length < 2) return campos;
  const off = Math.floor(Date.now() / 86400000) % campos.length;
  return campos.slice(off).concat(campos.slice(0, off));
}

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
  if (!autorizado(req)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const url     = new URL(req.url, 'http://x');
  const fieldId = url.searchParams.get('field_id');
  const userId  = url.searchParams.get('user_id');
  const anchor  = url.searchParams.get('anchor');
  // ?solo=escalar salta las 6 miniaturas por mes y deja solo la fila de
  // ndvi_history: es lo único que necesitan los gráficos y las alertas, y baja
  // el costo de un campo nuevo de ~217 llamadas a GEE a ~31. Sirve para
  // destrabar una cartera entera antes de ponerse con las imágenes.
  const soloEscalar = url.searchParams.get('solo') === 'escalar';
  const deadline = Date.now() + DEADLINE_MS;

  try {
    if (anchor) return await backfillAnchor(res, anchor);
    // `order` explícito: la rotación por día solo reparte bien si el orden base
    // es estable entre corridas (sin `order`, PostgREST no lo garantiza).
    const params = { select: 'id,nombre,polygon_coords', order: 'created_at.asc' };
    if (fieldId) params.id = `eq.${fieldId}`;
    if (userId)  params.user_id = `eq.${userId}`;
    const encontrados = await sbSelect('user_fields', params);
    if (fieldId && !encontrados.length) return res.status(404).json({ error: 'campo no encontrado' });
    const campos = fieldId ? encontrados : rotarPorDia(encontrados);

    const resultados = [];
    let done = true;
    for (const campo of campos) {
      if (Date.now() > deadline) { done = false; break; }
      // El presupuesto del campo es el que venza primero: su tope o el global.
      const tope = Math.min(deadline, Date.now() + MS_POR_CAMPO);
      const r = await backfillField(campo, { deadline: tope, soloEscalar });
      resultados.push(r);
      // Un campo incompleto ya no corta la corrida: se anota y se sigue con el
      // siguiente. Antes, el primero a medias dejaba sin datos a todos los que
      // venían detrás, corrida tras corrida.
      if (!r.done) done = false;
    }

    return res.status(200).json({ ok: true, done, campos: campos.length, resultados });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};

// ════════════════════════════════════════════════════════════════════════
// Motor de backfill satelital histórico por campo — datos escalares (los 6
// índices en ndvi_history) + imágenes PNG por índice (Storage 'field-media',
// tracking en field_media), con granularidad MENSUAL desde 2024-01 hasta el
// último mes CERRADO. Idempotente y reanudable: sabe qué meses/índices ya
// existen y los salta; los meses sin imagen despejada quedan 'sin_dato' con
// tope de 3 intentos para no re-pegarle a GEE eternamente.
// Lo usa api/cron/backfill-field.js (trigger por campo nuevo + sweep diario).
// ════════════════════════════════════════════════════════════════════════

const { sbSelect, sbUpsert } = require('./_supabase');
const { getBands, computeIndices, getIndexThumbnail } = require('./_sensors');
const { stUpload, mediaPath } = require('./_storage');

const INDICES = ['NDVI', 'NDRE', 'EVI', 'MSAVI', 'TCARI', 'NDMI'];
const MAX_INTENTOS = 3;

// Meses 'YYYY-MM' desde 2024-01 hasta el último mes CERRADO (excluye el mes en
// curso: su imagen quedaría incompleta y el sweep del mes siguiente lo agrega).
function monthsSince2024() {
  const now = new Date();
  const meses = [];
  let y = 2024, m = 1;
  const lastY = now.getUTCFullYear();
  const lastM = now.getUTCMonth(); // 0-based → el mes anterior al actual (1-based)
  while (y < lastY || (y === lastY && m <= lastM)) {
    meses.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return meses;
}

// Ventana GEE del mes calendario: endDate = último día del mes, days = días del
// mes — la imagen etiquetada "marzo" muestra marzo, no febrero.
function monthWindow(mes) {
  const [y, m] = mes.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { endDate: `${mes}-${String(lastDay).padStart(2, '0')}`, days: lastDay };
}

// backfillField(field, { deadline, soloEscalar }) — completa lo que falte para
// un campo, meses descendente (recientes primero: lo que el usuario va a
// pedir). Corta al vencer `deadline` (ms epoch) y retorna done:false para que
// otra invocación continúe. field = { id, nombre, polygon_coords }.
// Con `soloEscalar` se salta las 6 miniaturas por mes: la fila de
// ndvi_history es lo único que consumen los gráficos y las alertas, así que
// esta pasada llena de datos una cartera entera 7 veces más rápido. Las
// imágenes (que son para WhatsApp) las completa después el sweep normal.
async function backfillField(field, { deadline, soloEscalar = false }) {
  const resumen = { campo: field.nombre || field.id, done: true, mesesProcesados: 0, escalares: 0, imagenes: 0, sinDato: 0, errores: [] };
  if (!Array.isArray(field.polygon_coords) || field.polygon_coords.length < 3) {
    resumen.errores.push('polígono inválido');
    return resumen;
  }

  const [histRows, mediaRows] = await Promise.all([
    sbSelect('ndvi_history', { select: 'fecha,ndvi', field_id: `eq.${field.id}` }),
    sbSelect('field_media', { select: 'mes,indice,status,intentos', field_id: `eq.${field.id}` }),
  ]);
  const escalarExiste = new Set(histRows.filter(r => r.ndvi != null).map(r => String(r.fecha).slice(0, 7)));
  const mediaByKey = new Map(mediaRows.map(r => [`${r.mes}|${r.indice}`, r]));

  const meses = monthsSince2024().reverse();
  for (const mes of meses) {
    const faltaEscalar = !escalarExiste.has(mes);
    const indicesFaltantes = soloEscalar ? [] : INDICES.filter(ind => {
      const row = mediaByKey.get(`${mes}|${ind.toLowerCase()}`);
      if (!row) return true;
      if (row.status === 'ok') return false;
      return (row.intentos || 0) < MAX_INTENTOS;
    });
    if (!faltaEscalar && !indicesFaltantes.length) continue;

    if (Date.now() > deadline) { resumen.done = false; break; }
    resumen.mesesProcesados++;
    const win = monthWindow(mes);

    if (faltaEscalar) {
      try {
        const bands = await getBands({ polygon: field.polygon_coords, days: win.days, endDate: win.endDate });
        const idx = computeIndices(bands);
        if (idx.ndvi != null) {
          await sbUpsert('ndvi_history', [{ field_id: field.id, fecha: `${mes}-01`, ...idx }], 'field_id,fecha');
          resumen.escalares++;
        }
      } catch (e) {
        resumen.errores.push(`${mes} escalar: ${e.message}`);
      }
    }

    for (const ind of indicesFaltantes) {
      if (Date.now() > deadline) { resumen.done = false; break; }
      const key = ind.toLowerCase();
      const prev = mediaByKey.get(`${mes}|${key}`);
      try {
        const { buffer, error } = await getIndexThumbnail({ polygon: field.polygon_coords, indice: ind, days: win.days, endDate: win.endDate });
        if (error || !buffer || !buffer.length) {
          resumen.sinDato++;
          await sbUpsert('field_media', [{ field_id: field.id, mes, indice: key, status: 'sin_dato', intentos: (prev?.intentos || 0) + 1 }], 'field_id,mes,indice');
          continue;
        }
        const up = await stUpload(mediaPath(field.id, mes, key), buffer);
        if (!up.ok) {
          resumen.errores.push(`${mes} ${key}: ${up.error}`);
          continue;
        }
        await sbUpsert('field_media', [{ field_id: field.id, mes, indice: key, status: 'ok', intentos: (prev?.intentos || 0) + 1, bytes: buffer.length }], 'field_id,mes,indice');
        resumen.imagenes++;
      } catch (e) {
        resumen.errores.push(`${mes} ${key}: ${e.message}`);
      }
    }
    if (!resumen.done) break;
  }

  return resumen;
}

module.exports = { backfillField, monthsSince2024, monthWindow, INDICES };

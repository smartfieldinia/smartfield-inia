// ════════════════════════════════════════════════════════════════════════
// api/_interes.js — formulario de interés (lanzamiento, 2026-10-21). NO es un
// endpoint: el plan Hobby está en su tope de funciones, así que lo despacha
// `api/registro-config.js` cuando llega `?interes=1` (rewrite `/api/interes`).
//
//   POST /api/interes { nombre, email, whatsapp?, rol?, region?, organizacion?,
//                       cultivos?, mensaje?, origen?, sitio? }
//
// Desde el lanzamiento nadie se registra solo: /registro sin sesión es este
// formulario. Guarda el interesado en `leads` (migración v14) y avisa por
// correo a Stanley (`LEADS_EMAIL`, por defecto sbest@inia.cl). Él decide a
// quién invitar desde el panel de administración.
//
// `sitio` es un honeypot: un campo oculto que una persona deja vacío. Si
// viene con algo se responde 200 sin guardar nada (al bot no se le avisa).
// ════════════════════════════════════════════════════════════════════════

const sb = require('./_supabase');
const email = require('./_email');
const ratelimit = require('./_ratelimit');

const DESTINO_DEFECTO = 'sbest@inia.cl';
const CUOTA_INTERES = { tope: 5, ventanaSeg: 60 * 60 };   // por IP y hora
const ROLES_DECLARADOS = ['productor', 'asesor', 'otro'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function leerBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

function texto(v, max) {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function htmlLead(l) {
  const fila = (k, v) => v
    ? `<tr><td style="padding:4px 12px 4px 0;color:#5d6b66;font-size:13px;vertical-align:top">${k}</td><td style="padding:4px 0;font-size:14px;color:#12211d">${esc(v)}</td></tr>`
    : '';
  return `<!doctype html><html lang="es"><body style="margin:0;padding:24px 12px;background:#f4f6f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden">
    <tr><td style="background:#0a7d6e;padding:16px 22px;color:#ffffff;font-size:15px;font-weight:700">Avisa · SmartField INIA</td></tr>
    <tr><td style="padding:22px">
      <h1 style="margin:0 0 14px;font-size:19px;color:#12211d">Nueva solicitud de acceso</h1>
      <table role="presentation" cellpadding="0" cellspacing="0">
        ${fila('Nombre', l.nombre)}${fila('Correo', l.email)}${fila('WhatsApp', l.whatsapp)}
        ${fila('Perfil', l.rol)}${fila('Región', l.region)}${fila('Organización', l.organizacion)}
        ${fila('Cultivos', l.cultivos)}${fila('Mensaje', l.mensaje)}${fila('Origen', l.origen)}
      </table>
      <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#12211d">Para darle acceso, entra al panel de administración → <strong>Interesados</strong> y toca <strong>Invitar</strong>. Le llegará un correo para crear su clave.</p>
      <a href="https://smartfieldinia.cl/app" style="display:inline-block;margin-top:14px;background:#0a7d6e;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:9px;font-size:14px;font-weight:600">Abrir el panel</a>
    </td></tr>
  </table></body></html>`;
}

async function handleInteres(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });
  res.setHeader('Cache-Control', 'no-store');

  let b;
  try { b = leerBody(req); } catch { return res.status(400).json({ error: 'Solicitud no válida.' }); }

  if (texto(b.sitio, 200)) return res.status(200).json({ ok: true });

  const lead = {
    nombre:       texto(b.nombre, 120),
    email:        (texto(b.email, 160) || '').toLowerCase() || null,
    whatsapp:     texto(b.whatsapp, 30),
    rol:          ROLES_DECLARADOS.includes(b.rol) ? b.rol : null,
    region:       texto(b.region, 60),
    organizacion: texto(b.organizacion, 160),
    cultivos:     texto(b.cultivos, 200),
    mensaje:      texto(b.mensaje, 1000),
    origen:       texto(b.origen, 80),
  };
  if (!lead.nombre) return res.status(400).json({ error: 'Escribe tu nombre.' });
  if (!lead.email || !EMAIL_RE.test(lead.email)) return res.status(400).json({ error: 'Escribe un correo válido.' });

  const cuota = await ratelimit.consumir(`interes:ip:${ratelimit.ipDe(req)}`, CUOTA_INTERES);
  if (!cuota.permitido) {
    return res.status(429).json({ error: 'Recibimos varias solicitudes desde esta conexión. Intenta de nuevo en una hora.' });
  }

  try {
    await sb.sbInsert('leads', [lead]);
  } catch (e) {
    // Sin la fila, el correo es lo único que queda: se manda igual.
    console.error('[interes] no se pudo guardar el lead:', e.message);
  }

  const r = await email.sendEmail({
    to: process.env.LEADS_EMAIL || DESTINO_DEFECTO,
    subject: `Avisa: solicitud de acceso de ${lead.nombre}`,
    html: htmlLead(lead),
  });
  if (!r.ok) console.error('[interes] no se pudo avisar por correo:', r.error);

  return res.status(200).json({ ok: true });
}

module.exports = { handleInteres, htmlLead };

// ════════════════════════════════════════════════════════════════════════
// Envío de correo (Resend) — segundo canal de las alertas.
//
// Existe por el pedido de Stanley del 2026-08-05: avisar heladas y golpes de
// calor "por WhatsApp y/o por correo". El correo NO es un lujo redundante acá:
// WhatsApp solo admite plantillas pre-aprobadas por Meta para mensajes que
// inicia el negocio, y esas plantillas tienen el texto fijo ("...esta noche"),
// así que un aviso a 3 días no se puede expresar con las que hay hoy. Por
// correo el texto es libre y el aviso puede decir el día y el nivel.
//
// Dominio: `sadata.io` es el ÚNICO verificado en la cuenta Resend de INIA
// (verificado contra la API el 2026-08-05). Mandar desde smartfieldinia.cl
// fallaría en silencio — el mismo problema que tiene femai-landing hoy.
//
// El email del usuario NO está en `users_profile`: vive en auth.users, así que
// se resuelve por la Admin API de Supabase (misma vía que usa advisor-links).
// ════════════════════════════════════════════════════════════════════════

const FROM_DEFECTO = 'SmartField INIA <alertas@sadata.io>';

// sendEmail({ to, subject, html, attachments }) → { ok, id } | { ok:false, error }
// Best-effort y nunca lanza: una alerta que no se pudo mandar por correo no
// debe voltear la corrida del cron ni impedir el envío por WhatsApp.
//
// `attachments`: `[{ filename, content: Buffer|base64, contentType }]`. El
// correo es el único canal capaz de entregar el informe semanal en PDF: por
// WhatsApp, un mensaje iniciado por el negocio exige una plantilla aprobada, y
// ninguna de las cinco que tiene el proyecto lleva header de documento.
//
// Nota del contrato de Resend: es la REST API, no el SDK — el campo es
// `content_type` en snake_case, y `content` va en base64.
async function sendEmail({ to, subject, html, from = FROM_DEFECTO, attachments = null }) {
  const key = process.env.RESEND_INIA_KEY;
  if (!key) return { ok: false, error: 'RESEND_INIA_KEY no configurada' };
  if (!to)  return { ok: false, error: 'sin destinatario' };
  try {
    const cuerpo = { from, to: [to], subject, html };
    if (attachments && attachments.length) {
      cuerpo.attachments = attachments.map(a => ({
        filename: a.filename,
        content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content,
        content_type: a.contentType || 'application/octet-stream',
      }));
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(cuerpo),
      // Con adjunto el POST pasa de ~4 KB a cientos: 12 s se quedan cortos en
      // un arranque en frío.
      signal: AbortSignal.timeout(attachments?.length ? 25000 : 12000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.message || `Resend ${res.status}` };
    return { ok: true, id: data?.id || null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Email de un usuario por su id (auth.users). Devuelve null si no se puede
// resolver: sin service key, sin usuario, o si la Admin API falla.
async function emailDeUsuario(userId) {
  const url = process.env.SUPABASE_URL;
  // Mismo par de nombres que _supabase.js: SUPABASE_SERVICE_KEY con fallback.
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  if (!url || !key || !userId) return null;
  try {
    const res = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const u = await res.json();
    return u?.email || null;
  } catch (_) {
    return null;
  }
}

// Cuerpo HTML de un aviso. Todo el CSS va inline: Gmail descarta el <style>
// del <head> (misma lección que las plantillas de email-templates/).
// `cuarteles` (opcional) es la lista de nombres cuando el aviso abarca varios
// cuarteles del mismo campo: el clima no se detiene en el deslinde, así que un
// mismo evento se manda en UN correo y la línea de contexto lo dice en plural.
// El detalle por cuartel (valor y nivel) viaja en `cuerpo`, no acá: con 30
// cuarteles, listar los nombres arriba tapa el aviso.
//
// `campo` (2026-09-10) es el nombre del predio. Cuando existe encabeza el
// contexto: el aviso es del campo entero y así se lee de una. Sin campo
// —cuarteles sueltos, sin `predio_id`— se mantiene la línea anterior.
function htmlAviso({ titulo, cuerpo, cuartel, cuarteles = null, campo = null, pie }) {
  const cuantos = cuarteles ? cuarteles.length : 1;
  const contexto = campo
    ? `Campo <strong>${campo}</strong> · ${cuantos} ${cuantos === 1 ? 'cuartel' : 'cuarteles'}`
    : (cuarteles && cuarteles.length > 1
      ? `<strong>${cuarteles.length} cuarteles</strong> de tu predio`
      : `Cuartel <strong>${cuartel || (cuarteles && cuarteles[0]) || ''}</strong>`);
  return `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#f4f6f5">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f5;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
        <tr><td style="background:#0a7d6e;padding:16px 22px;color:#ffffff;font-size:15px;font-weight:700">SmartField INIA</td></tr>
        <tr><td style="padding:22px">
          <h1 style="margin:0 0 6px;font-size:19px;color:#12211d">${titulo}</h1>
          <p style="margin:0 0 14px;font-size:13px;color:#5d6b66">${contexto}</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#12211d">${cuerpo}</p>
          <a href="https://smartfieldinia.cl/app" style="display:inline-block;background:#0a7d6e;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:9px;font-size:14px;font-weight:600">Ver en la plataforma</a>
        </td></tr>
        <tr><td style="padding:0 22px 20px;font-size:12px;line-height:1.5;color:#8b9793">${pie}</td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

module.exports = { sendEmail, emailDeUsuario, htmlAviso, FROM_DEFECTO };

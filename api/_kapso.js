// ════════════════════════════════════════════════════════════════════════
// Helper Kapso WhatsApp — envío de mensajes vía la API de Kapso
// (https://docs.kapso.ai), que es espejo de la Meta WhatsApp Cloud API.
// Sin SDK: fetch nativo + API key. Mismo patrón que los demás helpers.
//
// Env vars requeridas (Vercel):
//   KAPSO_API_KEY          — API key del proyecto en app.kapso.ai
//   KAPSO_PHONE_NUMBER_ID  — phone_number_id del número emisor (sandbox o prod)
//   KAPSO_WEBHOOK_SECRET   — secret para validar webhooks entrantes (la usa
//                            whatsapp-webhook.js, no este helper)
// ════════════════════════════════════════════════════════════════════════

const API_KEY  = process.env.KAPSO_API_KEY;
const PHONE_ID = process.env.KAPSO_PHONE_NUMBER_ID;

function isConfigured() {
  return Boolean(API_KEY && PHONE_ID);
}

// Normaliza un teléfono al formato que espera Meta/Kapso: solo dígitos con
// código de país, sin "+" ni "whatsapp:" (ej. "56912345678")
function toMetaPhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

// Envía un WhatsApp de texto. Devuelve { ok: true, sid } o { ok: false, error }.
async function sendWhatsApp(toPhone, body) {
  if (!isConfigured()) return { ok: false, error: 'Kapso no configurado (faltan env vars)' };
  const to = toMetaPhone(toPhone);
  if (!to) return { ok: false, error: 'Falta el número de destino' };

  try {
    const res = await fetch(
      `https://api.kapso.ai/meta/whatsapp/v24.0/${PHONE_ID}/messages`,
      {
        method:  'POST',
        headers: {
          'X-API-Key':    API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type:    'individual',
          to,
          type: 'text',
          text: { body: String(body || '').slice(0, 1500) },
        }),
        signal: AbortSignal.timeout(12000),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Kapso devuelve {"error":"..."} (string) o formato Meta {"error":{message,code}}
      const err = data.error;
      const msg = typeof err === 'string' ? err : err?.message;
      return { ok: false, error: msg || `Kapso ${res.status}`, code: err?.code };
    }
    return { ok: true, sid: data.messages?.[0]?.id, status: 'sent' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Envía un mensaje de PLANTILLA (template) pre-aprobada por Meta. Necesario
// para mensajes que el negocio inicia FUERA de la ventana de 24 h (p.ej. el
// cron de alertas): Meta prohíbe texto libre ahí y exige una plantilla
// categoría Utility aprobada. `bodyParams` son los valores de las variables
// {{1}},{{2}},... del cuerpo, en orden. Mismo contrato de retorno que
// sendWhatsApp. Los parámetros no pueden llevar saltos de línea (Meta los
// rechaza) — se aplanan y recortan por las dudas.
async function sendTemplate(toPhone, templateName, langCode, bodyParams = []) {
  if (!isConfigured()) return { ok: false, error: 'Kapso no configurado (faltan env vars)' };
  const to = toMetaPhone(toPhone);
  if (!to) return { ok: false, error: 'Falta el número de destino' };

  const parameters = bodyParams.map((t) => ({
    type: 'text',
    text: String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, 300) || '-',
  }));

  try {
    const res = await fetch(
      `https://api.kapso.ai/meta/whatsapp/v24.0/${PHONE_ID}/messages`,
      {
        method:  'POST',
        headers: {
          'X-API-Key':    API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type:    'individual',
          to,
          type: 'template',
          template: {
            name:     templateName,
            language: { code: langCode },
            components: parameters.length
              ? [{ type: 'body', parameters }]
              : [],
          },
        }),
        signal: AbortSignal.timeout(12000),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = data.error;
      const msg = typeof err === 'string' ? err : err?.message;
      return { ok: false, error: msg || `Kapso ${res.status}`, code: err?.code };
    }
    return { ok: true, sid: data.messages?.[0]?.id, status: 'sent' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Sube un archivo a Kapso como media de WhatsApp (multipart/form-data) y
// devuelve el media_id que después se referencia al enviar el mensaje —
// evita tener que hostear el archivo en una URL pública propia (el proyecto
// no tiene infraestructura de Blob/Storage para esto). Reusado por
// sendWhatsAppImage() y, a futuro, por el envío de imagen en las alertas
// automáticas (plantilla con header de imagen).
// `maxBytes` es parámetro porque el límite de Meta NO es uno solo: 5 MB para
// imagen, 100 MB para documento. Estaba fijo en 5 MB, así que un PDF
// perfectamente válido habría sido rechazado por este helper y no por Meta.
async function uploadWhatsAppMedia(buffer, { filename = 'imagen.png', contentType = 'image/png', maxBytes = 5 * 1024 * 1024 } = {}) {
  if (!isConfigured()) return { ok: false, error: 'Kapso no configurado (faltan env vars)' };
  if (!buffer || !buffer.length) return { ok: false, error: 'Archivo vacío' };
  if (buffer.length > maxBytes) {
    return { ok: false, error: `Archivo de ${(buffer.length / 1048576).toFixed(1)} MB supera el límite de ${(maxBytes / 1048576).toFixed(0)} MB de Meta` };
  }

  try {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', new Blob([buffer], { type: contentType }), filename);

    const res = await fetch(
      `https://api.kapso.ai/meta/whatsapp/v24.0/${PHONE_ID}/media`,
      { method: 'POST', headers: { 'X-API-Key': API_KEY }, body: form, signal: AbortSignal.timeout(20000) }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) {
      const err = data.error;
      const msg = typeof err === 'string' ? err : err?.message;
      return { ok: false, error: msg || `Kapso upload ${res.status}` };
    }
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Envía una imagen por WhatsApp (sube el archivo y lo referencia por id — ver
// uploadWhatsAppMedia). Solo válido DENTRO de la ventana de 24h, igual que
// sendWhatsApp de texto (para envíos fuera de esa ventana hace falta una
// plantilla con header de imagen aprobada por Meta, no este helper).
async function sendWhatsAppImage(toPhone, pngBuffer, caption = '') {
  if (!isConfigured()) return { ok: false, error: 'Kapso no configurado (faltan env vars)' };
  const to = toMetaPhone(toPhone);
  if (!to) return { ok: false, error: 'Falta el número de destino' };

  const uploaded = await uploadWhatsAppMedia(pngBuffer, { filename: 'ndvi.png', contentType: 'image/png' });
  if (!uploaded.ok) return uploaded;

  try {
    const res = await fetch(
      `https://api.kapso.ai/meta/whatsapp/v24.0/${PHONE_ID}/messages`,
      {
        method:  'POST',
        headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type:    'individual',
          to,
          type: 'image',
          image: { id: uploaded.id, caption: String(caption || '').slice(0, 1024) },
        }),
        signal: AbortSignal.timeout(12000),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = data.error;
      const msg = typeof err === 'string' ? err : err?.message;
      return { ok: false, error: msg || `Kapso ${res.status}`, code: err?.code };
    }
    return { ok: true, sid: data.messages?.[0]?.id, status: 'sent' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Envía un documento (PDF) por WhatsApp. Calca de `sendWhatsAppImage`, con dos
// diferencias que importan: el tipo es `document` —lo que hace que el archivo
// llegue con nombre visible y descargable, en vez de como imagen— y el límite
// de Meta es 100 MB, no 5.
//
// ⚠️ Igual que `sendWhatsApp` y `sendWhatsAppImage`, solo vale DENTRO de la
// ventana de 24 h. El informe semanal es un mensaje iniciado por el negocio, así
// que hoy este helper solo puede usarse cuando el productor escribió primero.
// Para el envío proactivo hace falta una plantilla con `HEADER type=DOCUMENT`
// aprobada por Meta — bloqueada por el método de pago faltante en el WhatsApp
// Manager (ver CLAUDE.md). El código queda listo para ese día.
async function sendWhatsAppDocument(toPhone, buffer, { filename = 'informe.pdf', contentType = 'application/pdf', caption = '' } = {}) {
  if (!isConfigured()) return { ok: false, error: 'Kapso no configurado (faltan env vars)' };
  const to = toMetaPhone(toPhone);
  if (!to) return { ok: false, error: 'Falta el número de destino' };

  const uploaded = await uploadWhatsAppMedia(buffer, { filename, contentType, maxBytes: 100 * 1024 * 1024 });
  if (!uploaded.ok) return uploaded;

  try {
    const res = await fetch(
      `https://api.kapso.ai/meta/whatsapp/v24.0/${PHONE_ID}/messages`,
      {
        method:  'POST',
        headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type:    'individual',
          to,
          type: 'document',
          document: { id: uploaded.id, filename, caption: String(caption || '').slice(0, 1024) },
        }),
        signal: AbortSignal.timeout(15000),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = data.error;
      const msg = typeof err === 'string' ? err : err?.message;
      return { ok: false, error: msg || `Kapso ${res.status}`, code: err?.code };
    }
    return { ok: true, sid: data.messages?.[0]?.id, status: 'sent' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { sendWhatsApp, sendTemplate, sendWhatsAppImage, sendWhatsAppDocument, uploadWhatsAppMedia, toMetaPhone, isConfigured };

// ════════════════════════════════════════════════════════════════════════
// Webhook entrante de WhatsApp (Kapso) — el agricultor escribe y la IA de
// INIA le responde, igual que en /app. Con memoria por número y respuestas
// personalizadas según el campo registrado del agricultor.
//
// Configurar en Kapso: Dashboard → Integrations → Webhooks →
//   URL: https://smartfield-blue.vercel.app/api/whatsapp-webhook
//   Evento: whatsapp.message.received — copiar el secret a KAPSO_WEBHOOK_SECRET
// ════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { runAgent } = require('./_agent');
const { sendWhatsApp, sendWhatsAppImage } = require('./_kapso');
const { sbSelect, sbInsert, sbUpdate } = require('./_supabase');
const { consumirCupoAnonimo, CUPO_ANONIMO } = require('./_ratelimit');

const WEBHOOK_SECRET = process.env.KAPSO_WEBHOOK_SECRET;

// Kapso reintenta el webhook si no respondemos 200 en 10 s (10s/40s/90s) y el
// agente IA puede tardar más: dedupe por wamid dentro de la instancia caliente.
const seenMessages = new Set();

// Quita acentos y normaliza para comparar comandos
function normalizar(s) {
  return s.toLowerCase().replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i').replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').trim();
}
const RESET_CMDS = ['reiniciar', 'reset', 'borrar', 'empezar de nuevo', 'nueva conversacion', 'limpiar'];

// Lee el body crudo (necesario para validar la firma HMAC byte a byte).
// En Vercel Functions el stream sigue disponible aunque exista req.body.
async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.readable) {
    const chunks = [];
    for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    if (chunks.length) return Buffer.concat(chunks).toString('utf8');
  }
  return null; // stream ya consumido por los helpers: no hay body crudo fiable
}

// Valida X-Webhook-Signature = HMAC-SHA256(rawBody, secret), timing-safe
function validSignature(rawBody, signature) {
  if (!signature || !rawBody) return false;
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature).trim(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).send('SmartField INIA WhatsApp webhook OK');
  if (req.method !== 'POST') return res.status(405).end();

  // ── Body crudo + firma ───────────────────────────────────────────────────
  const rawBody = await readRawBody(req);
  if (WEBHOOK_SECRET) {
    const toVerify = rawBody ?? JSON.stringify(req.body || {});
    if (rawBody == null) console.warn('[whatsapp-webhook] sin body crudo; validando firma sobre JSON re-serializado');
    if (!validSignature(toVerify, req.headers['x-webhook-signature'])) {
      console.warn('[whatsapp-webhook] firma inválida — request rechazado');
      return res.status(401).json({ ok: false, error: 'invalid signature' });
    }
  } else if (process.env.VERCEL_ENV === 'production') {
    // Fail-closed en producción: sin secret no hay forma de distinguir a Kapso de
    // cualquiera que conozca la URL, y este endpoint invoca al agente (costo LLM),
    // escribe en `conversations` y manda WhatsApp. Antes procesaba igual con un
    // console.warn. En preview/local sigue abierto para poder probar sin el secret.
    console.error('[whatsapp-webhook] KAPSO_WEBHOOK_SECRET no configurado en producción — request rechazado');
    return res.status(503).json({ ok: false, error: 'webhook no configurado' });
  } else {
    console.warn('[whatsapp-webhook] KAPSO_WEBHOOK_SECRET no configurado: firma NO validada (no-producción)');
  }

  // Kapso envía JSON (evento whatsapp.message.received)
  let body = req.body;
  if (rawBody != null) { try { body = JSON.parse(rawBody); } catch (_) {} }
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  body = body || {};

  const msg = body.message || {};
  const direction = msg.kapso?.direction || 'inbound';
  // Las notas de voz llegan sin `text.body`: Kapso las transcribe y deja el texto
  // limpio en `kapso.transcript.text`. `kapso.content` trae esa misma
  // transcripción pero envuelta en metadatos del archivo (nombre, tamaño, MIME y
  // una URL firmada de ~200 caracteres en base64), y eso era lo que venía
  // recibiendo el agente: ruido que gasta contexto y degrada la respuesta.
  // Verificado el 2026-08-21: los dos "No pude redactar la respuesta" del
  // historial fueron ambos contra audios. Preferir siempre la transcripción.
  const text = (msg.text?.body || msg.kapso?.transcript?.text || msg.kapso?.content || '').toString().trim();
  const digits = String(msg.from || '').replace(/\D/g, '');
  const phone = digits ? `+${digits}` : ''; // en BD los números van con "+" (registro.html)

  // Confirmaciones de entrega de Meta (sent → delivered → read → failed).
  // Antes se descartaban con un 200 mudo, así que una alerta "enviada" nunca
  // pasaba de ahí aunque el teléfono la hubiera recibido —o aunque Meta la
  // hubiera rechazado después de aceptarla. Ahora cierran el ciclo de
  // notification_deliveries (§11.3 del PRD).
  const estados = extraerEstados(body);
  if (estados.length) {
    const actualizados = await aplicarEstadosDeEntrega(estados);
    return res.status(200).json({ ok: true, estados: actualizados });
  }

  // Solo mensajes de texto entrantes; ecos salientes → 200 y listo
  if (direction !== 'inbound' || !phone || !text) return res.status(200).json({ ok: true });

  // Dedupe de reintentos de Kapso por id de mensaje (wamid)
  if (msg.id) {
    if (seenMessages.has(msg.id)) return res.status(200).json({ ok: true, dedup: true });
    seenMessages.add(msg.id);
    if (seenMessages.size > 500) seenMessages.clear();
  }

  // ── Comando de reinicio: limpia el hilo y no invoca al agente ──────────
  if (RESET_CMDS.includes(normalizar(text))) {
    try {
      const perfiles = await sbSelect('users_profile', { select: 'id', whatsapp_phone: `eq.${phone}`, limit: 1 });
      const u = perfiles[0];
      if (u) {
        const convos = await sbSelect('conversations', { select: 'id', user_id: `eq.${u.id}`, carpeta: 'eq.whatsapp', limit: 1 });
        if (convos[0]) await sbUpdate('conversations', { id: `eq.${convos[0].id}` }, { mensajes: [], updated_at: new Date().toISOString() });
      }
    } catch (_) {}
    try { await sendWhatsApp(phone, 'Listo, partamos de cero 🌱 ¿En qué te ayudo?'); } catch (_) {}
    return res.status(200).json({ ok: true });
  }

  try {
    // ── Identificar al agricultor por su número ──────────────────────────
    let user = null, userContext = null, convoRow = null, history = [], cupo = null;
    try {
      // Con `limit: 1` y sin `order`, dos perfiles que declaren el mismo número
      // hacían que PostgREST devolviera uno cualquiera: el mismo agricultor
      // recibía respuestas sobre los cuarteles de una cuenta o de la otra según
      // la corrida, y su mensaje quedaba guardado en un hilo distinto cada vez.
      //
      // Y no es hipotético: hoy en producción hay dos cuentas del piloto con el
      // mismo número (la misma persona, una como productor y otra como
      // extensionista). Por eso acá NO se atiende como anónimo ante la
      // ambigüedad —eso le sacaría sus cuarteles y su memoria a alguien que sí
      // está registrado—: se elige el perfil MÁS RECIENTE, que es el que la
      // persona está usando, y se deja constancia en el log. La solución de
      // fondo es el índice único de la migración v11, que exige resolver a mano
      // cuál cuenta se queda con el número.
      const perfiles = await sbSelect('users_profile', {
        select: 'id,nombre,rol', whatsapp_phone: `eq.${phone}`,
        order: 'created_at.desc', limit: 2,
      });
      if (perfiles.length > 1) {
        console.error(`[whatsapp-webhook] ${perfiles.length} perfiles comparten el número ${phone}; se usa el más reciente (${perfiles[0].id}). Resolver con la migración v11.`);
      }
      user = perfiles[0] || null;
    } catch (_) {}

    if (user) {
      // Campos y memoria se piden a la vez: son dos tablas distintas y ninguna
      // depende de la otra, pero en serie sumaban su latencia al tiempo que el
      // agricultor pasa mirando "escribiendo…".
      const [pedidoCampos, pedidoConvos] = await Promise.allSettled([
        sbSelect('user_fields', {
          select: 'id,nombre,predio_id,predio_nombre,es_cuartel,polygon_coords,cultivo,variedad,comuna,area_ha',
          user_id: `eq.${user.id}`, order: 'predio_nombre.asc.nullslast,nombre.asc',
        }),
        sbSelect('conversations', {
          select: 'id,mensajes', user_id: `eq.${user.id}`, carpeta: 'eq.whatsapp',
          order: 'updated_at.desc', limit: 1,
        }),
      ]);

      // Sus campos (para personalizar clima/satélite)
      const fields = (pedidoCampos.status === 'fulfilled' ? pedidoCampos.value : [])
        .map(r => ({
          id: r.id, nombre: r.nombre, polygon: r.polygon_coords,
          predio_id: r.predio_id || null, predio_nombre: r.predio_nombre || null, es_cuartel: r.es_cuartel !== false,
          cultivo: r.cultivo || null, variedad: r.variedad || null,
          comuna: r.comuna || null, area_ha: r.area_ha || null,
        })).filter(f => f.polygon);
      userContext = { nombre: user.nombre, rol: user.rol, fields, canal: 'whatsapp' };

      // Memoria: conversación de WhatsApp del usuario
      try {
        const convos = pedidoConvos.status === 'fulfilled' ? pedidoConvos.value : [];
        convoRow = convos[0] || null;
        const prev = Array.isArray(convoRow?.mensajes) ? convoRow.mensajes : [];

        // ── Dedupe PERSISTENTE por wamid ─────────────────────────────────
        // El Set en memoria solo cubre la instancia caliente: generar una
        // imagen NDVI (GEE + upload) tarda >10s, Kapso reintenta a los
        // 10s/40s/90s y el retry puede caer en OTRA instancia → respuesta y
        // foto duplicadas (visto en producción, 2026-07-18). Los mensajes
        // guardados llevan su wamid: si este ya está en el hilo, es un retry.
        if (msg.id && prev.some(m => m.wamid === msg.id)) {
          return res.status(200).json({ ok: true, dedup: 'persistente' });
        }
        // Marca temprana: guarda el mensaje del usuario (con wamid) ANTES de
        // pensar la respuesta, para que el retry de los 10s ya lo encuentre.
        // La respuesta del asistente se agrega al final, como siempre.
        if (msg.id) {
          const marcado = [...prev, { role: 'user', content: text, ts: new Date().toISOString(), wamid: msg.id }].slice(-20);
          try {
            if (convoRow) {
              await sbUpdate('conversations', { id: `eq.${convoRow.id}` }, { mensajes: marcado, updated_at: new Date().toISOString() });
            } else {
              const inserted = await sbInsert('conversations', { user_id: user.id, titulo: 'WhatsApp', carpeta: 'whatsapp', mensajes: marcado });
              if (inserted?.[0]?.id) convoRow = { id: inserted[0].id, mensajes: [] };
            }
          } catch (_) {}
        }

        history = prev.slice(-6).map(m => ({ role: m.role, content: m.content }));
        if (convoRow) convoRow = { ...convoRow, mensajes: prev }; // el guardado final recompone desde prev
      } catch (_) {}
    } else {
      // Anónimo (no registrado): igual está en WhatsApp — sin esto, el tool de
      // imagen NDVI declinaría por canal aunque el mensaje sí venga de acá.
      userContext = { canal: 'whatsapp' };

      // Sin cuenta hay CUPO_ANONIMO mensajes gratis de por vida por número
      // (lanzamiento, 2026-10-21: las cuentas son solo por invitación). Agotado
      // el cupo no se llama al agente: se responde la invitación a pedir acceso.
      cupo = await consumirCupoAnonimo(`wa:${phone}`);
      if (!cupo.permitido) {
        await sendWhatsApp(phone,
          `Ya usaste tus ${CUPO_ANONIMO} mensajes gratis de Avisa 🌱\n\n` +
          'Para seguir conversando y recibir avisos de clima y satélite de *tu* campo, ' +
          'pide acceso en smartfieldinia.cl/registro y el equipo de INIA te enviará una invitación.');
        return res.status(200).json({ ok: true, cupo_agotado: true });
      }
    }

    // ── Pensar la respuesta con la IA ────────────────────────────────────
    const { text: answer, media = [] } = await runAgent({ message: text, history, userContext });

    // ── Guardar memoria (solo usuarios registrados) ──────────────────────
    if (user) {
      const nowISO = new Date().toISOString();
      const prev = Array.isArray(convoRow?.mensajes) ? convoRow.mensajes : [];
      const nuevos = [...prev,
        // wamid persistido: es la marca del dedupe anti-reintentos de Kapso
        { role: 'user', content: text, ts: nowISO, wamid: msg.id || undefined },
        { role: 'assistant', content: answer, ts: nowISO },
      ].slice(-20);
      try {
        if (convoRow) {
          await sbUpdate('conversations', { id: `eq.${convoRow.id}` }, { mensajes: nuevos, updated_at: nowISO });
        } else {
          await sbInsert('conversations', { user_id: user.id, titulo: 'WhatsApp', carpeta: 'whatsapp', mensajes: nuevos });
        }
      } catch (_) {}
    }

    // ── Responder por WhatsApp ───────────────────────────────────────────
    let finalAnswer = answer;
    if (!user) {
      const r = cupo?.restantes;
      const quedan = r == null ? ''
        : r === 0 ? 'Este fue tu último mensaje gratis. '
        : `Te ${r === 1 ? 'queda 1 mensaje gratis' : `quedan ${r} mensajes gratis`}. `;
      finalAnswer += `\n\n💚 ${quedan}Pide acceso en smartfieldinia.cl/registro y te aviso del clima y el satélite de *tu* campo.`;
    }
    await sendWhatsApp(phone, finalAnswer);

    // ── Imágenes generadas por alguna tool (NDVI actual, mapa de cambio) ────
    // Un fallo acá no debe tumbar la respuesta de texto, que ya se mandó — pero
    // tampoco puede quedar mudo: el texto ya dijo "ahí va el mapa", y sin este
    // aviso el productor se queda esperando una foto que nunca llega (era
    // indistinguible de "el bot no manda mapas").
    const fallidas = [];
    for (const m of media) {
      const t0 = Date.now();
      let r;
      try { r = await sendWhatsAppImage(phone, m.buffer, m.caption); }
      catch (e) { r = { ok: false, error: e.message }; }
      const bytes = m.buffer ? m.buffer.length : 0;
      if (r.ok) console.log(`[whatsapp-webhook] imagen ok campo="${m.campo || ''}" caption="${m.caption}" bytes=${bytes} ms=${Date.now() - t0}`);
      else { console.error(`[whatsapp-webhook] imagen FALLO campo="${m.campo || ''}" caption="${m.caption}" bytes=${bytes} ms=${Date.now() - t0} motivo=${r.error}`); fallidas.push(m); }
    }
    if (fallidas.length) {
      const nombres = [...new Set(fallidas.map(m => m.campo || 'el cuartel'))].join(', ');
      const que = fallidas.length === 1 ? 'la imagen' : 'las imágenes';
      try { await sendWhatsApp(phone, `No pude adjuntar ${que} de ${nombres} 😕. Pídemela de nuevo en un rato.`); } catch (_) {}
    }
  } catch (err) {
    console.error('[whatsapp-webhook] error:', err.message);
    try { await sendWhatsApp(phone, 'Tuve un problema para responder 😕. Inténtalo de nuevo en un momento.'); } catch (_) {}
  }

  return res.status(200).json({ ok: true });
};

// ════════════════════════════════════════════════════════════════════════
// Estados de entrega (§11.3 del PRD)
// ════════════════════════════════════════════════════════════════════════

// Meta manda los estados en `statuses[]` (formato Cloud API). Kapso reenvía el
// payload tal cual, pero según el evento puede venir anidado de dos formas, así
// que se aceptan ambas en vez de asumir una — el costo de equivocarse es
// perder confirmaciones en silencio, que es justo lo que se quiere evitar.
function extraerEstados(body) {
  const crudos = [
    ...(Array.isArray(body?.statuses) ? body.statuses : []),
    ...(Array.isArray(body?.entry?.[0]?.changes?.[0]?.value?.statuses)
      ? body.entry[0].changes[0].value.statuses : []),
    // Kapso también publica el estado de un mensaje saliente como evento suelto.
    ...(body?.message?.kapso?.direction === 'outbound' && body?.message?.status
      ? [{ id: body.message.id, status: body.message.status, errors: body.message.errors }] : []),
  ];

  const VALIDOS = new Set(['sent', 'delivered', 'read', 'failed']);
  return crudos
    .filter(s => s && s.id && VALIDOS.has(String(s.status || '').toLowerCase()))
    .map(s => ({
      wamid: String(s.id),
      estado: String(s.status).toLowerCase(),
      error: s.errors?.[0]?.title || s.errors?.[0]?.message || null,
    }));
}

// Orden de avance: un 'delivered' que llega tarde no debe pisar un 'read' que
// ya se registró (Meta no garantiza el orden de los webhooks).
const RANGO_ESTADO = { queued: 0, not_requested: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

async function aplicarEstadosDeEntrega(estados) {
  let aplicados = 0;
  for (const e of estados) {
    try {
      const filas = await sbSelect('notification_deliveries', {
        select: 'id,estado', proveedor_id: `eq.${e.wamid}`, limit: 1,
      });
      const fila = filas[0];
      if (!fila) continue;   // no es una alerta nuestra (p. ej. respuesta del bot)

      // 'failed' siempre se registra: es información nueva aunque llegue tarde.
      if (e.estado !== 'failed' && RANGO_ESTADO[e.estado] <= RANGO_ESTADO[fila.estado]) continue;

      await sbUpdate('notification_deliveries', { id: `eq.${fila.id}` }, {
        estado: e.estado,
        ...(e.error ? { error: String(e.error).slice(0, 500) } : {}),
      });
      aplicados++;
    } catch (err) {
      // Sin la migración v9 la tabla no existe: no es un error del webhook.
      if (!/notification_deliveries/.test(err.message)) {
        console.error('[whatsapp-webhook] estado de entrega:', err.message);
      }
      break;
    }
  }
  return aplicados;
}

module.exports.config = { maxDuration: 180 };

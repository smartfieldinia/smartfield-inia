/**
 * INIA-CHAT — Streaming Chat Endpoint (Vercel Serverless)
 * POST /api/chat-stream  (alias: POST /api/chat/stream)
 *
 * Acepta: { messages: [{role,content},...], message: string }
 * Retorna: text/event-stream SSE
 * Eventos: { type: "text"|"tool_start"|"tool_end"|"done"|"error", ... }
 *
 * Adaptador delgado sobre el cerebro único (api/_agent.js, runAgent) — mismo
 * prompt/tools/estilo que el bot de WhatsApp. Este endpoint solo agrega
 * transporte: llama a runAgent (no-streaming) y retransmite el texto final
 * al cliente chunkeado por palabras vía SSE, más los eventos tool_start/
 * tool_end para los badges que ya muestra la UI.
 */

const { runAgent } = require('./_agent');
const { getUser } = require('./_auth');
const { resolveActingUser } = require('./_authz');
const { permitirChatAnonimo, consumirCupoAnonimo, ipDe, CUPO_ANONIMO } = require('./_ratelimit');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const { sbSelect } = require('./_supabase');

// ── MODO DEMO (sin API key válida — último fallback si Cerebras falla) ──

const DEMO_RESPONSES = {
  'riego en vid': `**INIA recomienda el riego deficitario controlado (RDI)** en vides durante la temporada seca, aplicando entre el 40–60% de la evapotranspiración de referencia (ET₀) en la fase de envero. Esta estrategia mejora la concentración de azúcares y antocianinas sin comprometer el rendimiento en variedades tintas.

Para goteo, se recomienda un caudal de **1,0–1,6 L/h** con emisores a 0,5–1,0 m, activando el riego cuando el potencial hídrico del tallo al mediodía supera los **-1,0 MPa** (medido con cámara de presión).

INIA Intihuasi (Coquimbo) e INIA Rayentué (O'Higgins) tienen ensayos publicados en Syrah, Malbec y Chardonnay bajo condiciones del valle del Choapa y Colchagua. Puedes explorar estas publicaciones en [biblioteca.inia.cl](https://biblioteca.inia.cl).

> El asistente con acceso completo a las **19.000+ publicaciones INIA** y búsqueda semántica estará disponible públicamente muy pronto.`,

  'fertilización del trigo': `INIA recomienda fraccionar la fertilización nitrogenada del trigo en **dos a tres aplicaciones**: una basal al momento de la siembra (20–30% del total) y el resto en macollaje temprano (estadio Z21–Z25), con una tercera opción en encañado si el análisis foliar lo indica.

Las dosis varían según zona: en la **Región de Ñuble y Biobío** (INIA Quilamapu), se recomiendan **80–120 kg N/ha** en suelos de trumao, con ajuste según potencial de rendimiento. En suelos arcillosos del secano interior, la dosis puede reducirse a 60–80 kg N/ha para evitar acame.

La fuente preferida es urea (46-0-0) o urea inhibida (NBPT) para reducir pérdidas por volatilización. INIA también ha evaluado mezclas con fosfato diamónico (DAP) en la siembra.

> El asistente con acceso completo a las **19.000+ publicaciones INIA** y búsqueda semántica estará disponible públicamente muy pronto.`,

  'plagas en arándano': `El **Manejo Integrado de Plagas (MIP)** en arándano según INIA considera tres ejes principales:

**1. Monitoreo:** Uso de trampas cromotrópicas y feromonas para Lobesia botrana, Frankliniella occidentalis (trips) y Brevipalpus chilensis (ácaro rojo). Umbral de acción: 1–2 adultos/trampa/semana en prefloración.

**2. Control biológico:** Liberaciones de Amblyseius swirskii para trips y ácaros; Trichogramma para lepidópteros. INIA Carillanca ha validado estas liberaciones en las regiones de Los Ríos y La Araucanía.

**3. Control químico selectivo:** Solo ante superación de umbrales. Productos registrados: azadiractina, spinosad, spirotetramat. Respetar períodos de carencia para exportación.

INIA también ha evaluado el uso de caolín (Surround WP) como barrera física contra thrips en floración.

> El asistente con acceso completo a las **19.000+ publicaciones INIA** y búsqueda semántica estará disponible públicamente muy pronto.`,

  'variedades de palto': `Para la **Región de O'Higgins**, INIA Rayentué recomienda las siguientes variedades de palto según condición:

| Variedad | Tipo flor | Época cosecha | Observaciones |
|---|---|---|---|
| **Hass** | A | Jul–Sep | Estándar de exportación, requiere polinizador |
| **Lamb Hass** | A | Ago–Oct | Mayor calibre que Hass, buen comportamiento en secano |
| **Sir Prize** | B | Jun–Jul | Temprana, piel verde, buena tolerancia al frío |
| **Méndez** | B | Sep–Nov | Tardía, alta producción, origen INIA Chile |

Para el valle de Cachapoal (alturas 300–600 msnm), INIA recomienda portainjertos tolerantes a Phytophthora: **Duke 7** en suelos bien drenados y **Dusa** en suelos con mayor humedad.

> El asistente con acceso completo a las **19.000+ publicaciones INIA** y búsqueda semántica estará disponible públicamente muy pronto.`,

  'salinidad': `Las recomendaciones de INIA para suelos con **salinidad alta (CE > 4 dS/m)** se centran en:

**Diagnóstico:** Análisis de conductividad eléctrica del extracto de saturación (CEe), RAS (relación de adsorción de sodio) y pH. INIA Intihuasi tiene protocolos de muestreo para el norte de Chile.

**Enmiendas:** Aplicación de **yeso agrícola (CaSO₄)** a razón de 2–8 t/ha según el RAS. El yeso desplaza el Na⁺ del complejo de intercambio, mejorando la permeabilidad.

**Lavado:** Láminas de lavado de 400–800 mm en suelos con CEe 4–8 dS/m, aplicadas en un solo evento o fraccionadas en 2–3 riegos, según textura. INIA Ururi (Arica) ha documentado este manejo en valles costeros del norte.

**Cultivos tolerantes validados por INIA:** remolacha forrajera, cebada, quínoa (variedades Villarrica y Cahuil), espárrago y tomate industrial.

> El asistente con acceso completo a las **19.000+ publicaciones INIA** y búsqueda semántica estará disponible públicamente muy pronto.`,

  'viticultura de precisión': `INIA Rayentué (Región de O'Higgins, que incluye el valle de Colchagua) ha liderado investigación en **viticultura de precisión** con foco en:

**Teledetección:** Uso de imágenes Sentinel-2 y drones multiespectrales para mapear variabilidad intra-viñedo mediante índices NDVI, NDRE y NDWI. Los mapas de vigor se usan para zonificar el viñedo en 3–5 zonas de manejo diferenciado.

**Sensores de suelo:** Redes de TDR y sondas capacitivas para monitoreo continuo de humedad volumétrica. INIA ha evaluado sensores Sentek EnviroScan y Decagon 5TM en Cabernet Sauvignon de secano.

**Vendimia selectiva:** Cosecha por zonas según índice de madurez (Brix/acidez) y color de baya. INIA ha documentado diferencias de hasta 2° Brix entre zonas de alto y bajo vigor en el mismo cuartel.

**Software:** INIA ha colaborado con el desarrollo de plataformas de análisis espacial para la exportación de capas GIS al tractor de aplicación variable.

> El asistente con acceso completo a las **19.000+ publicaciones INIA** y búsqueda semántica estará disponible públicamente muy pronto.`,
};

const DEMO_FALLBACK = `Gracias por tu consulta. El asistente inteligente de la Plataforma Smart Extension INIA, con acceso a más de **19.000 publicaciones técnicas** de la Biblioteca Digital INIA y búsqueda semántica avanzada, estará disponible al público **próximamente**.

Mientras tanto puedes:
- Explorar la [Biblioteca Digital INIA](https://biblioteca.inia.cl) directamente
- Consultar la [Red Agrometeorológica INIA](https://agrometeorologia.cl)
- Visitar [INIA Chile](https://www.inia.cl) para acceder a publicaciones y recursos técnicos

El servicio estará disponible **24/7** para productores, extensionistas e investigadores de todo Chile. ¡Pronto!`;

function getDemoResponse(msg) {
  const m = (msg || '').toLowerCase();
  for (const [key, resp] of Object.entries(DEMO_RESPONSES)) {
    if (m.includes(key)) return resp;
  }
  return DEMO_FALLBACK;
}

async function streamDemo(res, msg) {
  const text = getDemoResponse(msg);
  // Enviar en trozos de ~4 palabras para simular streaming
  const words = text.split(' ');
  for (let i = 0; i < words.length; i += 4) {
    const chunk = words.slice(i, i + 4).join(' ') + (i + 4 < words.length ? ' ' : '');
    sse(res, { type: 'text', content: chunk });
    await new Promise(r => setTimeout(r, 25));
  }
  sse(res, { type: 'done', tools_used: [] });
  res.end();
}

// ── SSE HELPER ─────────────────────────────────────────────────────────────────
function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

// Transmite un texto ya generado, chunkeado por palabras (misma cadencia que streamDemo)
async function streamText(res, text) {
  const words = (text || '').split(' ');
  for (let i = 0; i < words.length; i += 5) {
    const chunk = words.slice(i, i + 5).join(' ') + (i + 5 < words.length ? ' ' : '');
    sse(res, { type: 'text', content: chunk });
    await new Promise(r => setTimeout(r, 25));
  }
}

// ── MAIN HANDLER ────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method Not Allowed' });

  // ── Identificar al usuario real (opcional: sin token válido → modo anónimo) ──
  let userContext = null;
  let autenticado = false;
  // Token presente pero inválido/vencido: NO es un anónimo. Seguir en modo
  // anónimo lo deja conversando con los cuarteles de EJEMPLO (visto en
  // producción el 2026-09-13: le ofreció "C1, C3, C4" a un usuario con 41
  // cuarteles propios, indistinguible de "el bot no reconoce mis cuarteles").
  // Mejor decirle que su sesión venció.
  const traeToken = /^Bearer\s+.+/i.test(req.headers.authorization || '');
  try {
    const caller = await getUser(req); // no responde 401; null si no hay token válido
    if (!caller && traeToken) {
      console.warn('[chat-stream] token presente pero inválido: no se atiende como anónimo');
      return res.status(401).json({ error: 'Tu sesión expiró. Vuelve a iniciar sesión para seguir conversando.' });
    }
    if (caller) {
      autenticado = true;
      const targetId = await resolveActingUser(req, res, caller.id);
      if (!targetId) return; // resolveActingUser ya respondió (403) — no iniciar el stream
      const [perfiles, rows] = await Promise.all([
        sbSelect('users_profile', { select: 'nombre,rol', id: `eq.${targetId}`, limit: 1 }),
        sbSelect('user_fields', {
          select: 'id,nombre,predio_id,predio_nombre,es_cuartel,polygon_coords,cultivo,variedad,comuna,area_ha',
          user_id: `eq.${targetId}`, order: 'predio_nombre.asc.nullslast,nombre.asc',
        }),
      ]);
      const fields = rows
        .map(r => ({
          id: r.id, nombre: r.nombre, polygon: r.polygon_coords,
          predio_id: r.predio_id || null, predio_nombre: r.predio_nombre || null, es_cuartel: r.es_cuartel !== false,
          cultivo: r.cultivo || null, variedad: r.variedad || null,
          comuna: r.comuna || null, area_ha: r.area_ha || null,
        }))
        .filter(f => f.polygon);
      userContext = { nombre: perfiles[0]?.nombre || null, rol: perfiles[0]?.rol || null, fields };
    }
  } catch (e) {
    console.error('[chat-stream] no se pudo resolver contexto de usuario:', e.message);
    // seguimos en modo anónimo, no rompemos el chat por un error de Supabase
  }

  // ── Cuota del demo anónimo ──────────────────────────────────────────────
  //
  // Va acá, antes de `flushHeaders()`: una vez abiertas las cabeceras del SSE ya
  // no se puede responder un 429. El límite de 4 mensajes que había en
  // `app.html` vive en el localStorage del visitante, o sea que no limita nada
  // fuera del navegador; cada mensaje que pasa cuesta una llamada a Groq o
  // Cerebras. Los usuarios con sesión no pasan por el contador.
  //
  // Desde el lanzamiento (2026-10-21) las cuentas son solo por invitación y sin
  // cuenta hay CUPO_ANONIMO mensajes en total por navegador: `X-Anon-Id` es un
  // uuid que `app.html` guarda en localStorage. Sin ese header (un script) el
  // cupo se cuenta por IP. Borrar el localStorage regala otros 5, pero el tope
  // por IP de arriba sigue frenando el abuso; el cupo es para la persona.
  if (!autenticado) {
    const cuota = await permitirChatAnonimo(req);
    if (!cuota.permitido) {
      return res.status(429).json({
        error: cuota.motivo === 'global'
          ? 'La prueba sin cuenta alcanzó su límite de consultas por hoy. Solicita acceso para seguir conversando.'
          : 'Llegaste al límite de mensajes de prueba por ahora. Solicita acceso para seguir conversando y guardar tu historial.',
        registro: '/registro',
        retry_after: cuota.reintentarEn,
      });
    }
    const anonId = String(req.headers['x-anon-id'] || '');
    const cupo = await consumirCupoAnonimo(UUID_RE.test(anonId) ? `web:${anonId.toLowerCase()}` : `web:ip:${ipDe(req)}`);
    if (!cupo.permitido) {
      return res.status(429).json({
        error: `Ya usaste tus ${CUPO_ANONIMO} mensajes gratis. Para seguir usando Avisa, solicita acceso: el equipo de INIA te enviará una invitación.`,
        registro: '/registro',
        cupo_agotado: true,
      });
    }
    if (cupo.restantes != null) res.setHeader('X-Cupo-Restante', String(cupo.restantes));
  }

  res.setHeader('Content-Type',       'text/event-stream');
  res.setHeader('Cache-Control',      'no-cache');
  res.setHeader('X-Accel-Buffering',  'no');
  res.flushHeaders();

  const { messages: clientHistory = [], message } = req.body || {};
  if (!message) {
    sse(res, { type: 'error', content: 'Falta el campo "message"' });
    return res.end();
  }

  try {
    const history = clientHistory.map(m => ({ role: m.role, content: m.content }));

    const toolsStarted = [];
    const { text, toolsUsed } = await runAgent({
      message,
      history,
      userContext,
      onTool: name => { toolsStarted.push(name); sse(res, { type: 'tool_start', tool: name }); },
    });

    // Si no hubo proveedor disponible (Cerebras caído/sin key), runAgent ya
    // devuelve un texto de aviso — pero si además no hay key configurada, usamos
    // el modo demo con respuestas más ricas para no mostrar un aviso de error.
    // (Groq salió de PROVIDERS el 2026-10-19: su key ya no cuenta.)
    if (!process.env.CEREBRAS_API_KEY) {
      return streamDemo(res, message);
    }

    for (const name of toolsStarted) sse(res, { type: 'tool_end', tool: name });
    await streamText(res, text);
    sse(res, { type: 'done', tools_used: toolsUsed });
    res.end();

  } catch (err) {
    console.error('[inia-chat] error:', err.message);
    sse(res, { type: 'error', content: `Error: ${err.message}` });
    res.end();
  }
};

module.exports.config = { maxDuration: 60 };

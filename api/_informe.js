// ════════════════════════════════════════════════════════════════════════
// api/_informe.js — orquesta el informe semanal de terreno.
//
// Junta las piezas: datos (`_informe-datos`), maqueta (`_informe-layout`),
// PDF (`_informe-pdf`), y lo entrega por los canales que hoy funcionan.
//
// **Por qué la entrega es la que es.** Un informe semanal es, por definición, un
// mensaje iniciado por el negocio: fuera de la ventana de 24 h WhatsApp solo
// admite plantillas aprobadas, y ninguna de las cinco que tiene el proyecto
// lleva header de documento. Aprobar una nueva está bloqueado por el método de
// pago faltante en el WhatsApp Manager (ver CLAUDE.md). Así que:
//   · el PDF va por CORREO, que sí admite adjuntos y no depende de Meta;
//   · el resumen queda en `alerts`, visible en /app;
//   · por WhatsApp sigue saliendo la plantilla de texto ya aprobada;
//   · `sendWhatsAppDocument` queda escrito y listo en `_kapso.js`, apagado
//     detrás de `INFORME_WA_TEMPLATE`, para el día que Meta apruebe la
//     plantilla con header. Ese día se prende una env var, no se escribe código.
//
// Helper con `_`: no consume cupo de funciones serverless.
// ════════════════════════════════════════════════════════════════════════

const { sbSelect } = require('./_supabase');
const { calcularAgroclim, resolverEstaciones } = require('./fields');
const { requerimiento } = require('./_requerimiento-termico');
const { ayerEnChile } = require('./_agroclim');
const { armarModelo } = require('./_informe-datos');
const { armarPaginas } = require('./_informe-layout');
const { renderPDF } = require('./_informe-pdf');
const { sendEmail, emailDeUsuario } = require('./_email');
const { limpiar } = require('./_informe-fuente');
const { COLOR_PRIORIDAD } = require('./_informe-paleta');

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

// ── Series de NDVI para el informe ──────────────────────────────────────
//
// El cron NUNCA pasó `serieNdvi`, aunque el modelo lo declaraba en su contrato.
// Sin ella, `deltasDeCuartel([])` devuelve `null` y el informe salía con la
// columna TENDENCIA en "— sin señal" para todos los cuarteles, con `enCaida` en
// cero y sin poder asignar jamás una prioridad MEDIA-ALTA ni MEDIA-BAJA. El
// arnés no lo veía porque sus fixtures arman las unidades a mano, con la serie
// puesta: el shape del test no era el shape del llamador real.
//
// Se carga acá y no dentro del bucle de cuarteles del cron por dos razones:
// seis de cada siete días este código ni se ejecuta (el informe es de los
// lunes), y en lote son ~5 requests en vez de 35.
const VENTANA_DIAS = 180;

// Cuántos cuarteles por request. **No es un número arbitrario**: PostgREST
// entrega como mucho 1.000 filas y no avisa cuando recorta. Medido contra
// producción, un cuartel acumula hasta 47 filas en 90 días (el cron escribe una
// por día), o sea ~95 en 180. Con 8 cuarteles el peor caso son ~760 filas, con
// margen; con 12 ya se rozaría el tope y la serie llegaría cortada en silencio.
const LOTE_CUARTELES = 8;

// ── Agroclima: grados-día, horas frío y temperaturas ────────────────────
//
// Los tres gráficos agroclimáticos del informe salen del MISMO cómputo que
// alimenta el dashboard (`calcularAgroclim` de `fields.js`). Recalcularlos acá
// habría sido una cuarta fuente para el mismo número: este repo ya pagó dos
// veces el precio de tener un rango de temporada escrito a mano en un segundo
// lugar, y las dos veces el síntoma fue un eje corrido que nadie vio porque no
// da error.
//
// `calcularAgroclim` agrupa por CLIMA, no por cuartel: los 37 cuarteles de
// Santa Rosa son 3 grupos, no 37 series. Medido contra producción: 1,5 s para
// esos 37 y 2,6 s para una cartera de uno (ahí pesa resolver la estación con la
// caché fría). Corre después del bucle de alertas, así que no compite con GEE
// por el presupuesto del cron.
const MS_AGROCLIM = 60000;

// `tope`: cuántos CLIMAS distintos se calculan. El default de `calcularAgroclim`
// es 3 y protege al dashboard, que tiene 24 s. Acá se pide explícitamente uno
// por predio del usuario: desde que hay un informe por predio, con el tope en 3
// el cuarto se quedaba sin sus tres gráficos agroclimáticos.
async function cargarAgroclim(campos, hasta, { tope } = {}) {
  const conGeometria = (campos || []).filter(c => c && c.polygon_coords);
  if (!conGeometria.length) return new Map();
  const deadline = Date.now() + MS_AGROCLIM;
  // El corte es AYER en Chile, como el dashboard (`fields.js`). El cron pasa la
  // fecha UTC de hoy, un día incompleto que se rellenaba con Open-Meteo: el PDF
  // decía 47,9 °D "atrasada ~6 días" con fuente mixta mientras la pantalla
  // decía 46,3 °D "atrasada ~5 días" con fuente INIA (2026-09-24).
  const ayer = ayerEnChile();
  const corte = hasta && hasta < ayer ? hasta : ayer;
  const desdeHistorial = new Date(Date.parse(corte) - 400 * 86400000).toISOString().slice(0, 10);
  const estaciones = await resolverEstaciones(conGeometria, desdeHistorial, deadline).catch(() => new Map());
  const { porCampo } = await calcularAgroclim(conGeometria, estaciones, corte, deadline,
    tope != null ? { tope } : undefined);

  // El requerimiento térmico depende del CULTIVO, que es de cada cuartel, así
  // que no puede salir del cómputo por clima: se pega al repartir, igual que
  // hace el handler de `fields.js`.
  for (const campo of conGeometria) {
    const e = porCampo.get(campo.id);
    if (!e) continue;
    const req = requerimiento(campo.cultivo, campo.variedad);
    if (!req) continue;
    // Cada curva por separado: la guarda era `if (!e.gdd) continue`, y un grupo
    // con horas frío pero sin grados-día se quedaba sin su línea de objetivo.
    if (e.gdd)   e.gdd   = { ...e.gdd,   requerimiento: req };
    if (e.chill) e.chill = { ...e.chill, requerimiento: req };
  }
  return porCampo;
}

// fieldIds → Map<fieldId, [{fecha, ndvi}]> en orden ascendente, que es como lo
// espera `_vigor.js`. Nunca lanza: un informe sin series sale igual, con la
// tendencia vacía, y eso es mejor que tumbar la corrida de alertas.
async function cargarSeriesNdvi(fieldIds, { hasta, dias = VENTANA_DIAS } = {}) {
  const ids = [...new Set((fieldIds || []).filter(Boolean))];
  const mapa = new Map(ids.map(id => [id, []]));
  if (!ids.length) return mapa;

  const desde = new Date(Date.parse(hasta) - dias * 86400000).toISOString().slice(0, 10);
  const lotes = [];
  for (let i = 0; i < ids.length; i += LOTE_CUARTELES) lotes.push(ids.slice(i, i + LOTE_CUARTELES));

  const respuestas = await Promise.all(lotes.map(lote =>
    sbSelect('ndvi_history', {
      select: 'field_id,fecha,ndvi',
      field_id: `in.(${lote.join(',')})`,
      and: `(fecha.gte.${desde},fecha.lte.${hasta})`,
      // DESC a propósito: si aun así el tope recortara, se pierden los días más
      // VIEJOS de todos los cuarteles por igual —lo menos importante para una
      // tendencia— y no los cuarteles del final de la lista, que se quedarían
      // sin ninguna serie.
      order: 'fecha.desc',
      limit: 1000,
    }).catch(err => {
      console.warn(`[informe] no se pudo leer ndvi_history de un lote: ${err.message}`);
      return [];
    })));

  for (const filas of respuestas) {
    for (const r of filas) {
      const s = mapa.get(r.field_id);
      if (s) s.push({ fecha: r.fecha, ndvi: r.ndvi });
    }
  }
  for (const serie of mapa.values()) serie.reverse();
  return mapa;
}

// "del 18 al 24 de agosto de 2026" — el rango de la semana ISO que se informa.
function rotularSemana(hasta) {
  const fin = new Date(hasta + 'T12:00:00Z');
  const ini = new Date(fin.getTime() - 6 * 86400000);
  const d = f => f.getUTCDate();
  const mes = f => MESES[f.getUTCMonth()];
  if (ini.getUTCMonth() === fin.getUTCMonth()) {
    return `del ${d(ini)} al ${d(fin)} de ${mes(fin)} de ${fin.getUTCFullYear()}`;
  }
  return `del ${d(ini)} de ${mes(ini)} al ${d(fin)} de ${mes(fin)} de ${fin.getUTCFullYear()}`;
}

function fechaCorta(iso) {
  const [a, m, d] = iso.split('-');
  return `${d}-${m}-${a}`;
}

// Genera el informe de un usuario. No lanza: un informe que falla no puede
// tumbar la corrida de alertas, que es lo que de verdad importa.
// Carga lo que el informe necesita de red, UNA vez por usuario. Se expone
// aparte porque desde el 2026-09-14 sale un informe por predio: si cada uno
// pidiera lo suyo, un usuario con tres campos pagaría tres veces las series de
// NDVI (que van en lotes de 8 justamente para no pasarse del tope de 1.000 filas
// de PostgREST — partirlas por predio rompe ese razonamiento) y tres resoluciones
// de estación.
//
// El agroclima es un extra: si falla o tarda, el informe sale sin sus tres
// gráficos, no se cae.
async function precargarInforme(unidades, hasta, { topeClimas } = {}) {
  const campos = (unidades || []).map(u => u.campo).filter(Boolean);
  const [series, agroclim] = await Promise.all([
    cargarSeriesNdvi(campos.map(c => c.id), { hasta }).catch(() => new Map()),
    cargarAgroclim(campos, hasta, { tope: topeClimas }).catch(err => {
      console.warn(`[informe] sin agroclima: ${err.message}`);
      return new Map();
    }),
  ]);
  return { series, agroclim };
}

// `titular` es de quién es el informe (el predio, desde que hay uno por predio);
// `scope` decide si el subtítulo del PDF dice "Predio" o "Cartera del asesor".
// `precargado` evita repetir las dos cargas de red cuando se emiten varios
// informes del mismo usuario.
async function generarInformeSemanal({ userId, titular, productor, scope = 'asesor', periodo, hasta, unidades, precargado }) {
  try {
    if (!unidades || !unidades.length) return { ok: false, motivo: 'sin cuarteles' };

    // Las series se piden acá y no en el cron para que quien llame al informe
    // no tenga que acordarse: era exactamente el olvido que dejó la columna de
    // tendencia vacía durante semanas. Quien ya las tiene las pasa en
    // `precargado` y no se vuelven a pedir.
    const { series, agroclim } = precargado || await precargarInforme(unidades, hasta);
    const conSerie = unidades.map(u => ({
      ...u,
      serieNdvi: u.serieNdvi && u.serieNdvi.length ? u.serieNdvi : (series.get(u.campo && u.campo.id) || []),
      agroclim: agroclim.get(u.campo && u.campo.id) || null,
    }));

    const modelo = armarModelo({
      titular, productor, scope, periodo,
      semana: rotularSemana(hasta),
      generadoEl: fechaCorta(hasta),
      hoyISO: hasta,
      unidades: conSerie,
    });

    const pdf = renderPDF(armarPaginas(modelo), {
      titulo: `Priorización semanal de terreno — ${modelo.titular}`,
      autor: 'SmartField INIA',
    });

    // El nombre lleva el predio: tres adjuntos llamados igual en la misma
    // bandeja de entrada el mismo lunes son indistinguibles.
    return { ok: true, modelo, pdf, nombreArchivo: `informe-${slug(titular)}-${periodo}.pdf` };
  } catch (err) {
    console.warn(`[informe] no se pudo generar para ${userId}: ${err.message}`);
    return { ok: false, motivo: err.message };
  }
}

// El cuerpo del correo.
//
// Antes era una carta de presentación del adjunto: resumen, tres filas y "el
// resto va en el PDF". Con la cartera real más chica —UN cuartel— esa frase
// prometía un resto que no existe, y el correo entero decía menos que su propio
// asunto. Ahora se sostiene solo: los cuatro números, qué hacer, y los
// cuarteles que piden visita. El PDF es el detalle, no el contenido.
//
// Todo el CSS va inline y la maqueta es con `<table>`: Gmail descarta `<style>`
// y Outlook rompe flex y grid.
function htmlInforme(modelo) {
  const est = modelo.estadisticas || {};
  const r = modelo.resumen;

  const kpi = (rot, valor, sub, color) => `<td style="width:25%;padding:10px 8px;background:#f6f8f8;border-left:3px solid ${color};vertical-align:top">
      <div style="font:600 10px system-ui,sans-serif;color:#5b6b73;letter-spacing:.3px">${esc(rot)}</div>
      <div style="font:700 22px system-ui,sans-serif;color:${color};margin:2px 0">${esc(valor)}</div>
      <div style="font-size:10px;color:#5b6b73">${esc(sub)}</div></td>`;

  const tarjetas = [
    kpi('CUARTELES', String(r.unidades),
      est.superficieHa != null ? `${fmtHa(est.superficieHa)} ha` : 'sin superficie', '#007667'),
    kpi('PRIORIDAD ALTA', String(r.alta),
      r.alta ? 'requieren visita' : 'ninguno urgente', r.alta ? '#b91c1c' : '#1a9850'),
    kpi('EN CAÍDA', String(r.enCaida),
      est.ndviMediana != null ? `NDVI ${est.ndviMediana.toFixed(3).replace('.', ',')}` : 'sin lectura',
      r.enCaida ? '#b45309' : '#1a9850'),
    kpi('CON ALERTA', String(r.conAlerta),
      r.conAlerta ? 'climática activa' : 'sin alertas', r.conAlerta ? '#b91c1c' : '#1a9850'),
  ].join('<td style="width:8px"></td>');

  const acciones = (modelo.acciones || []).map(a =>
    `<li style="margin:0 0 7px">${esc(a.texto)}</li>`).join('');

  // Se muestran los cuarteles que piden acción, no los tres primeros de una
  // lista arbitraria. El tope existe porque Gmail recorta los correos largos y
  // esconde justamente el final.
  const TOPE_FILAS = 8;
  const prioritarios = modelo.filas.filter(f => f.prioridad === 'ALTA' || f.prioridad === 'MEDIA-ALTA');
  const top = (prioritarios.length ? prioritarios : modelo.filas).slice(0, TOPE_FILAS);
  const restantes = modelo.resumen.unidades - top.length;

  const fila = f => {
    const col = (COLOR_PRIORIDAD[f.prioridad] || COLOR_PRIORIDAD['BAJA']).texto;
    const tend = f.tendenciaPct == null ? '—'
      : `${f.tendenciaPct > 0 ? '+' : ''}${String(f.tendenciaPct).replace('.', ',')}%`;
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e3e7eb;font:600 12px system-ui,sans-serif;color:${col};white-space:nowrap">${esc(f.prioridad)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e3e7eb;font:600 13px system-ui,sans-serif;color:#0f1720">${esc(f.cuartel)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e3e7eb;font:13px system-ui,sans-serif;color:${f.tendenciaPct < 0 ? '#b91c1c' : '#5b6b73'};white-space:nowrap">${esc(tend)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e3e7eb;font:13px system-ui,sans-serif;color:#5b6b73">${esc(f.motivo)}</td>
    </tr>`;
  };

  // Con una cartera chica la tabla YA es todo: prometer "el orden completo en
  // el adjunto" sería prometer filas que no existen. Lo que el PDF agrega en
  // ese caso no son más cuarteles, son los gráficos.
  const cierre = restantes > 0
    ? `Los ${restantes} ${restantes === 1 ? 'cuartel restante va' : 'cuarteles restantes van'} en el PDF adjunto, junto con el pronóstico de los próximos días y la evolución del vigor.`
    : 'El PDF adjunto trae además el pronóstico de los próximos días, la evolución del vigor y las estadísticas de la cartera.';

  const th = t => `<th style="text-align:left;padding:6px 10px;font:600 11px system-ui,sans-serif;color:#5b6b73;text-transform:uppercase;border-bottom:2px solid #007667">${t}</th>`;

  return `<div style="max-width:640px;margin:0 auto;font:14px/1.55 system-ui,-apple-system,sans-serif;color:#0f1720">
    <div style="background:#fff;padding:16px 20px 12px;border:1px solid #e3e7eb;border-bottom:0;border-radius:10px 10px 0 0">
      <img src="https://smartfieldinia.cl/logo-inia-smartfield.png" alt="SmartField INIA" width="150" style="display:block;width:150px;height:auto;border:0">
      <div style="font:600 13px system-ui,sans-serif;color:#007667;margin-top:10px">Informe semanal de terreno · semana ${esc(modelo.semana)}</div>
    </div>
    <div style="height:3px;background:linear-gradient(90deg,#007667 0%,#007667 70%,#7FBB00 100%);background-color:#007667"></div>
    <div style="border:1px solid #e3e7eb;border-top:0;border-radius:0 0 10px 10px;padding:20px">
      <table style="width:100%;border-collapse:separate;border-spacing:0;margin-bottom:18px"><tr>${tarjetas}</tr></table>
      <p style="margin:0 0 16px">${esc(modelo.resumen.texto)}</p>
      ${acciones ? `<div style="font:600 13px system-ui,sans-serif;color:#0f1720;margin:0 0 6px">Qué hacer esta semana</div>
      <ol style="margin:0 0 18px;padding-left:20px;font-size:13px;color:#0f1720">${acciones}</ol>` : ''}
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
        <thead><tr>${th('Prioridad')}${th('Cuartel')}${th('Vigor')}${th('Motivo')}</tr></thead>
        <tbody>${top.map(fila).join('')}</tbody>
      </table>
      <p style="margin:0 0 16px;font-size:13px;color:#5b6b73">${esc(cierre)}</p>
      <a href="https://smartfieldinia.cl/app"
         style="display:inline-block;background:#007667;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font:600 14px system-ui,sans-serif">
        Ver en la plataforma</a>
    </div>
    <p style="font-size:11px;color:#8a9aa0;text-align:center;margin-top:14px">
      SmartField INIA — Instituto de Investigaciones Agropecuarias · Plataforma operada por SADATA
    </p>
  </div>`;
}

const fmtHa = n => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// 'Santa Rosa' → 'santa-rosa'. Para el nombre del archivo adjunto.
function slug(texto) {
  return String(texto || 'terreno').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'terreno';
}

// Manda el informe por correo con el PDF adjunto. Devuelve el resultado, sin
// lanzar.
//
// `email`: quien ya lo resolvió lo pasa. `emailDeUsuario` pega a la Admin API de
// Supabase, y con un informe por predio se llamaría una vez por predio para
// traer siempre el mismo dato.
async function enviarInformePorCorreo({ userId, modelo, pdf, nombreArchivo, email }) {
  const destino = email || await emailDeUsuario(userId);
  if (!destino) return { ok: false, error: 'el usuario no tiene correo' };
  // El predio va en el asunto: con un informe por campo, tres asuntos idénticos
  // el mismo lunes no se distinguen ni en la lista ni en el buscador del correo.
  const dondeEsta = modelo.scope === 'predio' && modelo.titular ? ` — ${modelo.titular}` : '';
  return sendEmail({
    to: destino,
    subject: modelo.resumen.alta
      ? `Informe semanal${dondeEsta} — ${modelo.resumen.alta} ${modelo.resumen.alta === 1 ? 'cuartel' : 'cuarteles'} en prioridad ALTA (semana ${modelo.semana})`
      : `Informe semanal${dondeEsta} — sin prioridades altas (semana ${modelo.semana})`,
    html: htmlInforme(modelo),
    attachments: [{ filename: nombreArchivo, content: pdf, contentType: 'application/pdf' }],
  });
}

// Texto para la app y para WhatsApp si algún día cabe. Corto: es un resumen, no
// el informe.
function textoInforme(modelo) {
  const top = modelo.filas.slice(0, 3)
    .map(f => `${f.orden}. ${f.cuartel} (${f.prioridad}) — ${f.motivo}`)
    .join('\n');
  // Las acciones también van acá: es el mismo cuerpo conceptual del correo y
  // del PDF, en su tercera presentación. Sin ellas, quien abre /app veía una
  // lista de cuarteles y ninguna recomendación.
  const acciones = (modelo.acciones || []).map(a => `- ${limpiar(a.texto)}`).join('\n');
  return limpiar(`Informe semanal de terreno — semana ${modelo.semana}. ${modelo.resumen.texto}`) +
         (acciones ? `\n\n${acciones}` : '') +
         (top ? `\n\n${top}` : '');
}

module.exports = {
  generarInformeSemanal, enviarInformePorCorreo, htmlInforme, textoInforme, rotularSemana,
  precargarInforme, cargarSeriesNdvi, cargarAgroclim, slug, VENTANA_DIAS, LOTE_CUARTELES,
};

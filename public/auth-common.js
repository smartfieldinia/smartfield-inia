/* ════════════════════════════════════════════════════════════════════════
   Helpers compartidos por /login, /recuperar y /nueva-clave.
   Extraídos de login.html cuando se agregó la recuperación de contraseña.

   Cada página define su propio `supabaseClient` (lo crea tras pedir
   /api/registro-config); estas funciones lo leen de la variable global.

   ⚠️ /registro tiene su propia copia de val/require/btnLoading/showToast
   dentro del archivo (su wizard es autocontenido y carga Leaflet/JSZip).
   Si cambias el texto de un error acá, mira si el mismo texto está allá.
   ════════════════════════════════════════════════════════════════════════ */

// Número productivo de WhatsApp de INIA (Kapso, +1 208-203-5994).
// Mismo valor que INIA_WA en registro.html — si cambia, cambia en los dos.
const INIA_WA = '12082035994';

// ── Tema claro / oscuro ────────────────────────────────────
const ICON_SUN  = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
const ICON_MOON = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}
function updateThemeIcon() {
  const icon = document.getElementById('theme-icon');
  if (icon) icon.innerHTML = currentTheme() === 'dark' ? ICON_SUN : ICON_MOON;
}
function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('sf-theme', next); } catch (e) {}
  updateThemeIcon();
}

// ── Mostrar / ocultar contraseña ───────────────────────────
const EYE_OPEN   = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
const EYE_CLOSED = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';

// inputId → id del <button> y del <svg> que lo acompañan.
function togglePassword(inputId, toggleId, eyeId) {
  const inp    = document.getElementById(inputId || 'password');
  const toggle = document.getElementById(toggleId || 'pwd-toggle');
  const eye    = document.getElementById(eyeId || 'pwd-eye');
  if (!inp) return;
  const hidden = inp.type === 'password';
  inp.type = hidden ? 'text' : 'password';
  if (eye) eye.innerHTML = hidden ? EYE_CLOSED : EYE_OPEN;
  if (toggle) toggle.setAttribute('aria-label', hidden ? 'Ocultar contraseña' : 'Mostrar contraseña');
}

// ── Formularios ────────────────────────────────────────────
function val(id) {
  return (document.getElementById(id)?.value || '').trim();
}
function require(id, value, msg) {
  const wrapper = document.getElementById(`f-${id}`);
  const errEl = wrapper?.querySelector('.error-msg');
  if (!value) {
    if (wrapper) wrapper.classList.add('field-error');
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    return false;
  }
  if (wrapper) wrapper.classList.remove('field-error');
  if (errEl) errEl.style.display = 'none';
  return true;
}
function btnLoading(btn, on, loadingText) {
  if (!btn) return;
  if (on) {
    btn.dataset.html = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-spinner"></span> ${loadingText || 'Procesando…'}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.html !== undefined) { btn.innerHTML = btn.dataset.html; delete btn.dataset.html; }
  }
}

let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// Mensajes de Supabase traducidos a algo que un agricultor entienda.
function translateError(msg) {
  const map = {
    'Invalid login credentials': 'El correo o la contraseña no son correctos. Revísalos e inténtalo de nuevo.',
    'Email rate limit exceeded': 'Lo intentaste muchas veces. Espera unos minutos y vuelve a probar.',
    'Unable to validate email address: invalid format': 'El correo no parece válido. Revísalo (ejemplo: juan@gmail.com).',
    'Email not confirmed': 'Todavía no confirmaste tu correo. Ábrelo y aprieta el enlace que te enviamos.',
    'New password should be different from the old password': 'La contraseña nueva tiene que ser distinta a la anterior.',
    'Auth session missing!': 'El enlace ya no es válido. Pide uno nuevo para crear tu contraseña.',
    'Password should be at least 6 characters': 'La contraseña debe tener al menos 8 caracteres.',
    'User already registered': 'Ese correo ya tiene cuenta. Inicia sesión o recupera tu contraseña.',
    // Registro cerrado (solo por invitación, 2026-10-21): quien entra con
    // Google o Microsoft sin cuenta previa recibe esto de Supabase.
    'Signups not allowed for this instance': 'Tu correo todavía no tiene acceso a Avisa. Las cuentas son solo por invitación: solicítala en smartfieldinia.cl/registro.',
    'Signups not allowed for otp': 'Tu correo todavía no tiene acceso a Avisa. Las cuentas son solo por invitación: solicítala en smartfieldinia.cl/registro.',
    'Error sending recovery email': 'No pudimos enviar el correo en este momento. Inténtalo más tarde o escríbenos por WhatsApp.',
  };
  if (map[msg]) return map[msg];
  // Rate limit de Supabase: "For security purposes, you can only request this after N seconds."
  if (/security purposes/i.test(msg)) return 'Espera unos segundos antes de volver a intentarlo.';
  if (/rate limit/i.test(msg))        return 'Lo intentaste muchas veces. Espera unos minutos y vuelve a probar.';
  return msg;
}

// Limpia el resaltado de error apenas el usuario corrige el campo.
document.addEventListener('input', e => {
  const field = e.target.closest('.field-error');
  if (field) {
    field.classList.remove('field-error');
    const err = field.querySelector('.error-msg');
    if (err) err.style.display = 'none';
  }
});

// Rellena los enlaces "¿Necesitas ayuda?" con el WhatsApp de INIA.
function fillHelpLinks(mensaje) {
  const msg = encodeURIComponent(mensaje || 'Hola, necesito ayuda para entrar a mi cuenta de Avisa INIA 🙏');
  document.querySelectorAll('#help-link, .help-link').forEach(a => {
    a.href = `https://wa.me/${INIA_WA}?text=${msg}`;
  });
}

// ── Entrar con Google / Microsoft ──────────────────────────
// Logos oficiales, inline: un CDN caído no debe dejar el botón sin marca.
const LOGO_GOOGLE = `
  <svg viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>`;

const LOGO_MICROSOFT = `
  <svg viewBox="0 0 23 23" aria-hidden="true">
    <path fill="#f35325" d="M1 1h10v10H1z"/>
    <path fill="#81bc06" d="M12 1h10v10H12z"/>
    <path fill="#05a6f0" d="M1 12h10v10H1z"/>
    <path fill="#ffba08" d="M12 12h10v10H12z"/>
  </svg>`;

// ── Cliente Supabase: listo o no ───────────────────────────
/* Cada página crea su `supabaseClient` recién cuando responde
   /api/registro-config. Hasta ese momento vale null y cualquier `.auth`
   revienta con "Cannot read properties of null" (le pasó a un usuario el
   2026-08-27 en /recuperar). Los botones que dependen del cliente arrancan
   con `disabled data-needs-auth` en el HTML y los suelta authReady();
   getAuthClient() es el cinturón por si una acción se dispara igual —
   Enter en un input, por ejemplo. */

// Devuelve el cliente, o null avisándole al usuario que recargue.
function getAuthClient() {
  const client = window.supabaseClient
    || (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
  if (!client) {
    showToast('Configuración no disponible. Recarga la página e inténtalo de nuevo.');
    return null;
  }
  return client;
}

// La página ya tiene cliente: habilita lo que estaba esperándolo.
function authReady() {
  document.querySelectorAll('[data-needs-auth]').forEach(b => { b.disabled = false; });
}

/**
 * Manda al usuario al proveedor. Al volver, Supabase deja la sesión en el
 * hash de la URL y el SDK la levanta solo (detectSessionInUrl, por defecto).
 *
 * @param {'google'|'azure'} provider
 * @param {string} redirectPath  ruta propia a la que volver, ej. '/app'
 * @param {HTMLElement} btn      botón que disparó la acción (para el spinner)
 */
async function signInWithProvider(provider, redirectPath, btn) {
  const client = getAuthClient();
  if (!client) return;
  btnLoading(btn, true, 'Conectando…');
  try {
    const { error } = await client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}${redirectPath}`,
        // Azure necesita los scopes explícitos para devolver el correo;
        // Google los da igual, pero pedirlos no molesta.
        scopes: 'email profile openid',
      },
    });
    // Si no hubo error, el navegador ya está navegando al proveedor: no
    // quitamos el spinner para que el botón no "parpadee" antes de salir.
    if (error) {
      btnLoading(btn, false);
      // El error típico acá es que el proveedor no esté habilitado en Supabase.
      const nombre = provider === 'azure' ? 'Microsoft' : 'Google';
      showToast(/not enabled|unsupported provider/i.test(error.message)
        ? `Entrar con ${nombre} todavía no está disponible. Usa tu correo y contraseña.`
        : translateError(error.message));
    }
  } catch (err) {
    btnLoading(btn, false);
    showToast('Error inesperado: ' + err.message);
  }
}

// Pinta los logos dentro de los botones que los declaran por data-provider.
function renderProviderButtons() {
  document.querySelectorAll('[data-provider]').forEach(btn => {
    const p = btn.dataset.provider;
    const logo = p === 'azure' ? LOGO_MICROSOFT : LOGO_GOOGLE;
    const nombre = p === 'azure' ? 'Microsoft' : 'Google';
    btn.innerHTML = `${logo}<span>Continuar con ${nombre}</span>`;
  });
}

/**
 * Muestra los botones de proveedor SOLO si Supabase los tiene habilitados.
 *
 * `/auth/v1/settings` es público (solo pide la anon key) y devuelve
 * `external: { google: bool, azure: bool, ... }`. Partimos con la fila oculta
 * en el HTML y la encendemos acá, de modo que:
 *   - mientras Google/Azure no estén configurados, nadie ve un botón que
 *     fallaría al apretarlo;
 *   - el día que se habiliten en el panel de Supabase, aparecen solos, sin
 *     tener que volver a desplegar el sitio.
 * Si la consulta falla, se quedan ocultos: el correo y la contraseña siguen
 * siendo un camino completo para entrar.
 */
async function aplicarProveedoresDisponibles(supabaseUrl, anonKey) {
  const fila = document.getElementById('oauth-row');
  const sep  = document.getElementById('oauth-sep');
  if (!fila) return;
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: anonKey },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return;
    const { external = {} } = await res.json();

    let algunoVisible = false;
    fila.querySelectorAll('[data-provider]').forEach(btn => {
      const habilitado = external[btn.dataset.provider] === true;
      btn.style.display = habilitado ? '' : 'none';
      if (habilitado) algunoVisible = true;
    });

    if (algunoVisible) {
      fila.style.display = '';
      if (sep) sep.style.display = '';
    }
  } catch (e) {
    console.warn('No se pudo consultar los proveedores de inicio de sesión:', e.message);
  }
}

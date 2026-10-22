# Plantillas de correo de SmartField INIA

Los correos que manda Supabase Auth (recuperar contraseña, confirmar cuenta) vienen
**en inglés y con la marca de Supabase** por defecto. Estas plantillas los reemplazan
por versiones en español, escritas para agricultores, con la identidad del sitio.

## Cómo aplicarlas

**Por script** (recomendado: aplica cuerpo y asunto juntos, y deja registro):

```bash
SUPABASE_PAT=sbp_xxx node scripts/configurar-auth.js --plantilla
```

`scripts/configurar-auth.js --ver` muestra el estado actual sin tocar nada, e
incluye si el cuerpo quedó en español. El mismo script configura el SMTP y los
proveedores Google/Microsoft.

**A mano**: Supabase → proyecto `smartfield-inia` (cuenta `contacto@activalab.cl`) →
**Authentication → Email Templates** → elegir la plantilla → pegar el HTML →
**Save**.

| Archivo | Plantilla de Supabase | Asunto a poner |
|---|---|---|
| `recovery.html` | **Reset Password** | `Recupera tu contraseña de SmartField INIA` |

El asunto se edita en el campo *Subject heading*, arriba del cuerpo. **También está en
inglés por defecto** (`Reset Password`) — cambiarlo es tan importante como el cuerpo:
es lo primero que se ve en la bandeja.

## De quién salen los correos

Cambiar la plantilla arregla el idioma y el diseño, **pero no el remitente**. Mientras
el proyecto use el SMTP interno de Supabase, el correo sale desde
`noreply@mail.app.supabase.io` y **solo se entrega a miembros del equipo del proyecto**
(2 mensajes por hora, sin SLA). Por eso a un agricultor no le llega nada.

Para que salga desde un dominio propio hay que configurar SMTP en
**Authentication → SMTP Settings**:

```
Host:          smtp.resend.com
Puerto:        465
Usuario:       resend
Contraseña:    (API key de Resend)
Sender email:  smartfield@sadata.io
Sender name:   SmartField INIA
```

El *Sender name* es lo que la gente ve como remitente en su bandeja: aparecerá
**"SmartField INIA"**, no la dirección. Requiere verificar el dominio en Resend primero
(ver la sección de este trabajo en `../CLAUDE.md`).

## Reglas al editar el HTML

No son las mismas que en la web, y romperlas rompe el render:

- **Todo el CSS va inline.** Gmail descarta el `<style>` del `<head>`, y no entiende
  variables CSS, flexbox ni grid. Por eso el layout va con `<table>`, que es lo único
  que se comporta igual en todos los clientes.
- **Colores literales**, no `var(--lime)`: en un correo no existen los tokens del sitio.
- **El correo tiene que entenderse sin imágenes.** Muchos clientes las bloquean por
  defecto, así que "SmartField INIA" va como texto, nunca dentro de una imagen.
- **Siempre repetir el enlace en texto plano** además del botón: varios clientes
  corporativos e institucionales desactivan los botones.
- Variable de Supabase: `{{ .ConfirmationURL }}` es el enlace de un solo uso. Otras
  disponibles: `{{ .Token }}`, `{{ .TokenHash }}`, `{{ .SiteURL }}`, `{{ .Email }}`.

## Plantillas que siguen en inglés

Solo se tradujo la de recuperar contraseña, que es la única que la plataforma usa hoy.
Las demás (*Confirm signup*, *Magic Link*, *Change Email Address*, *Invite user*) siguen
con el texto por defecto de Supabase. **Confirm signup importa si algún día se vuelve a
encender "Confirm email"** (hoy está apagado, ver `../CLAUDE.md`): ese día hay que
traducirla antes, o los usuarios nuevos recibirán un correo en inglés.

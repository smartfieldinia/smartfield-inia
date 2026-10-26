# SmartField INIA

SmartField INIA: landing, web app de asistencia técnica con el asistente **AVISA INIA** (chat web + WhatsApp), onboarding de predios y alertas de clima/NDVI. Producción: [smartfieldinia.cl](https://smartfieldinia.cl).

## Stack

- Next.js (App Router) + páginas estáticas en `public/` (`app.html`, `registro.html`, `login.html`).
- Vercel Functions en `api/` (chat, WhatsApp vía Kapso, crons de alertas, informes PDF, panel admin).
- Supabase (auth + datos), Cerebras (LLM), Google Earth Engine (NDVI), Resend (correo).

## Desarrollo

```bash
npm install
npm run dev
```

## Variables de entorno

Se configuran en Vercel; nunca se versionan (`.env*` está en `.gitignore`).

| Servicio | Variables |
|---|---|
| Supabase | `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_RAG_URL`, `SUPABASE_RAG_KEY` |
| LLM | `CEREBRAS_API_KEY` |
| WhatsApp (Kapso) | `KAPSO_API_KEY`, `KAPSO_PHONE_NUMBER_ID`, `KAPSO_WEBHOOK_SECRET` |
| Earth Engine | `GEE_PROJECT_ID`, `GEE_CLIENT_EMAIL`, `GEE_PRIVATE_KEY_B64` (o `GEE_PRIVATE_KEY`) |
| Correo | `RESEND_INIA_KEY`, `LEADS_EMAIL` |
| Boletín riesgo climático INIA | `BOLETIN_API_URL`, `BOLETIN_API_KEY` |
| Crons | `CRON_SECRET` |

El esquema de la base de datos de búsqueda está en `db/`.

-- ─────────────────────────────────────────────────────────────────────────
-- Búsqueda en texto completo del corpus INIA, SIN embeddings (2026-10-20)
--
-- Se aplica en la Supabase de **AgrAgent** (cuenta shemoves), donde viven
-- inia_documents (1.488 publicaciones) e inia_chunks (57.561 fragmentos).
-- SQL Editor → pegar → Run. Es aditivo: no toca filas, no agrega columnas.
--
-- Por qué: match_inia_chunks necesita vectorizar la pregunta con OpenAI
-- (text-embedding-3-small), y OpenAI no tiene saldo. Cerebras no ofrece
-- embeddings. La búsqueda de texto de Postgres en español (raíces + ranking)
-- no necesita a nadie; el LLM razona sobre los fragmentos que devuelve.
-- La usa SmartField INIA (api/_agent.js → searchIniaRag).
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Índice por expresión (sin columna nueva: la tabla no se reescribe).
--    Bloquea escrituras a inia_chunks mientras se construye (segundos); las
--    lecturas siguen. Nadie escribe ahí fuera de la ingesta.
create index if not exists idx_inia_chunks_fts
  on public.inia_chunks using gin (to_tsvector('spanish', content));

-- 2) RPC. La consulta se arma en OR sobre las raíces: con AND (lo que hace
--    plainto/websearch) una pregunta natural de cinco palabras casi nunca
--    encuentra un fragmento que las tenga todas. El ranking (ts_rank_cd)
--    premia a los fragmentos que juntan más términos y más cerca.
create or replace function public.buscar_inia_chunks(consulta text, match_count int default 20)
returns table (
  document_uuid text,
  chunk_index   int,
  content       text,
  title         text,
  year          text,
  link          text,
  rank          real
)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select nullif(replace(plainto_tsquery('spanish', consulta)::text, '&', '|'), '')::tsquery as tsq
  )
  select c.document_uuid, c.chunk_index, c.content, d.title, d.year, d.link,
         ts_rank_cd(to_tsvector('spanish', c.content), q.tsq) as rank
  from q, public.inia_chunks c
  join public.inia_documents d on d.uuid = c.document_uuid
  where q.tsq is not null
    and to_tsvector('spanish', c.content) @@ q.tsq
  order by rank desc
  limit least(greatest(match_count, 1), 50);
$$;

grant execute on function public.buscar_inia_chunks(text, int) to anon, authenticated, service_role;

-- Prueba: select title, year, rank from buscar_inia_chunks('heladas en cerezo', 5);

-- ─────────────────────────────────────────────────────────────────────────
-- Texto completo INIA, v3 (2026-10-20) — solo reemplaza la función. Va DESPUÉS
-- de la v2 (que creó inia_chunks_fts), en la Supabase de AgrAgent.
--
-- Por qué: con la v2 el paso "cualquier palabra" (OR) seguía pasando los 3 s del
-- rol anon cuando la pregunta trae una palabra común. Medido: "manejo" calza en
-- 12.093 de 57.561 fragmentos; ordenar eso por relevancia no entra en 3 s.
-- "Al menos dos de las palabras" calza 21 en 0,13 s y son los que importan.
--
-- Búsqueda escalonada; cada paso corre solo si el anterior no llenó el cupo:
--   1. todas las palabras          (AND)
--   2. al menos dos de ellas       (OR de pares)
--   3. cualquiera, con tope de 1.000 candidatos antes de ordenar (último recurso)
-- ─────────────────────────────────────────────────────────────────────────

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
  with lex as (
    -- Raíces en español, sin repetidas (tsvector_to_array ya deduplica).
    select tsvector_to_array(to_tsvector('spanish', consulta)) as l
  ),
  q as (
    select
      case when cardinality(l) > 0
        then to_tsquery('simple', array_to_string(array(select quote_literal(x) from unnest(l) x), ' & ')) end as todas,
      case when cardinality(l) > 1
        then to_tsquery('simple', array_to_string(array(
               select '(' || quote_literal(a) || ' & ' || quote_literal(b) || ')'
               from unnest(l) a, unnest(l) b where a < b), ' | ')) end as dos,
      case when cardinality(l) > 0
        then to_tsquery('simple', array_to_string(array(select quote_literal(x) from unnest(l) x), ' | ')) end as alguna,
      least(greatest(match_count, 1), 50) as n
    from lex
  ),
  p1 as (
    select f.id, ts_rank(f.fts, q.todas) + 2 as rank
    from q, public.inia_chunks_fts f
    where q.todas is not null and f.fts @@ q.todas
    order by rank desc limit 50
  ),
  p2 as (
    select f.id, ts_rank(f.fts, q.dos) + 1 as rank
    from q, public.inia_chunks_fts f
    where q.dos is not null and (select count(*) from p1) < q.n and f.fts @@ q.dos
    order by rank desc limit 50
  ),
  p3_candidatos as (
    select f.id, f.fts
    from q, public.inia_chunks_fts f
    where q.alguna is not null
      and (select count(*) from p1) + (select count(*) from p2) < q.n
      and f.fts @@ q.alguna
    limit 1000
  ),
  p3 as (
    select c.id, ts_rank(c.fts, q.alguna) as rank
    from q, p3_candidatos c
    order by rank desc limit 50
  ),
  mejores as (
    select id, max(rank) as rank
    from (select * from p1 union all select * from p2 union all select * from p3) u
    group by id
  )
  select c.document_uuid, c.chunk_index, c.content, d.title, d.year, d.link, m.rank::real
  from mejores m
  join public.inia_chunks c on c.id = m.id
  join public.inia_documents d on d.uuid = c.document_uuid
  order by m.rank desc
  limit (select n from q);
$$;

grant execute on function public.buscar_inia_chunks(text, int) to anon, authenticated, service_role;

-- Prueba: select title, year, rank from buscar_inia_chunks('frambuesa Meeker manejo primavera', 5);

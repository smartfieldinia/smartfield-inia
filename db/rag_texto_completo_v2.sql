-- ─────────────────────────────────────────────────────────────────────────
-- Texto completo INIA, v2 (2026-10-20) — se aplica DESPUÉS de rag_texto_completo.sql,
-- en la misma Supabase de AgrAgent (SQL Editor → pegar → Run).
--
-- Por qué la v2: la v1 recalculaba to_tsvector de cada fragmento que calzaba para
-- ordenarlo. Con palabras comunes ("riego", "manejo") son miles de fragmentos y la
-- consulta pasaba los 3 s que la base le da al rol anon → error 57014 (timeout).
--
-- Ahora el vector de texto queda PRECALCULADO en una tabla aparte, inia_chunks_fts
-- (id → fts). Tabla aparte y no columna nueva: agregar una columna generada
-- reescribiría inia_chunks entera (con sus embeddings) bloqueando las lecturas.
-- Un trigger la mantiene al día si la ingesta agrega o cambia fragmentos.
--
-- Y la búsqueda va en dos pasos: primero fragmentos con TODAS las palabras (AND,
-- pocos y precisos); solo si no alcanzan, con cualquiera (OR).
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.inia_chunks_fts (
  id  bigint primary key references public.inia_chunks(id) on delete cascade,
  fts tsvector not null
);

insert into public.inia_chunks_fts (id, fts)
select id, to_tsvector('spanish', content) from public.inia_chunks
on conflict (id) do update set fts = excluded.fts;

create index if not exists idx_inia_chunks_fts_gin on public.inia_chunks_fts using gin (fts);

-- El índice por expresión de la v1 ya no se usa.
drop index if exists public.idx_inia_chunks_fts;

-- Misma política de lectura que inia_chunks (migración 2026-10-01_c_rls.sql).
alter table public.inia_chunks_fts enable row level security;
drop policy if exists inia_chunks_fts_read on public.inia_chunks_fts;
create policy inia_chunks_fts_read on public.inia_chunks_fts for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.inia_chunks_fts from anon, authenticated;

create or replace function public.inia_chunks_fts_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.inia_chunks_fts (id, fts) values (new.id, to_tsvector('spanish', new.content))
  on conflict (id) do update set fts = excluded.fts;
  return new;
end $$;

drop trigger if exists trg_inia_chunks_fts on public.inia_chunks;
create trigger trg_inia_chunks_fts after insert or update of content on public.inia_chunks
  for each row execute function public.inia_chunks_fts_sync();

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
    select plainto_tsquery('spanish', consulta) as todas,
           nullif(replace(plainto_tsquery('spanish', consulta)::text, '&', '|'), '')::tsquery as alguna
  ),
  con_todas as (
    select f.id, ts_rank(f.fts, q.todas) + 1 as rank
    from q, public.inia_chunks_fts f
    where q.alguna is not null and f.fts @@ q.todas
    order by rank desc
    limit 50
  ),
  con_alguna as (
    select f.id, ts_rank(f.fts, q.alguna) as rank
    from q, public.inia_chunks_fts f
    where q.alguna is not null
      and (select count(*) from con_todas) < least(greatest(match_count, 1), 50)
      and f.fts @@ q.alguna
    order by rank desc
    limit 50
  ),
  mejores as (
    select id, max(rank) as rank from (select * from con_todas union all select * from con_alguna) u
    group by id
  )
  select c.document_uuid, c.chunk_index, c.content, d.title, d.year, d.link, m.rank::real
  from mejores m
  join public.inia_chunks c on c.id = m.id
  join public.inia_documents d on d.uuid = c.document_uuid
  order by m.rank desc
  limit least(greatest(match_count, 1), 50);
$$;

grant execute on function public.buscar_inia_chunks(text, int) to anon, authenticated, service_role;

-- Prueba: select title, year, rank from buscar_inia_chunks('riego arándano', 5);

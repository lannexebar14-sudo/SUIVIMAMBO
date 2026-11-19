-- Migrated quiz functions call extensions.digest, while pgcrypto is installed in public on Neon.
create schema if not exists extensions;

create or replace function extensions.digest(bytea, text)
returns bytea
language sql
immutable strict parallel safe
set search_path = pg_catalog
as $$ select public.digest($1, $2) $$;

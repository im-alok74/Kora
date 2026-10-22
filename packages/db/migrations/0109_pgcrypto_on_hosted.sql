-- Hosted Postgres (Supabase) keeps pgcrypto in the "extensions" schema. Functions here run with
-- search_path = public, so digest() was not found there, which broke share links and the quote page.
-- Where digest() is already in public (a plain Postgres), this does nothing.
do $$
begin
  if to_regprocedure('public.digest(text,text)') is null and to_regprocedure('extensions.digest(text,text)') is not null then
    create function public.digest(text, text) returns bytea
      language sql immutable strict parallel safe as 'select extensions.digest($1, $2)';
    create function public.digest(bytea, text) returns bytea
      language sql immutable strict parallel safe as 'select extensions.digest($1, $2)';
  end if;
end
$$;

-- Audit findings A-05 and A-06, defence in depth for a hosted Postgres that exposes a REST layer (Supabase's Data API).
--
-- Such a platform creates the roles anon and authenticated and, through default privileges, gives them every privilege on
-- everything created in the public schema. Kora only ever reaches the database over a direct connection as kora_web, so those
-- two roles have no business here, and 13 tables (sessions, one-time codes, authenticator secrets) have no row level security
-- to fall back on. This removes what the two roles hold today and what they would be given for new objects.
--
-- Nothing happens where the roles do not exist (a plain Postgres, the local one). Safe to run again. service_role is left alone:
-- it is the platform's own administrative key. The default privileges that the platform's own role (postgres) holds can only be
-- changed by that role; if this runs as someone else the notice below says so and it should be run once as postgres.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
      execute format('alter default privileges in schema public revoke all on functions from %I', r);
      begin
        execute format('alter default privileges for role postgres in schema public revoke all on tables from %I', r);
        execute format('alter default privileges for role postgres in schema public revoke all on sequences from %I', r);
        execute format('alter default privileges for role postgres in schema public revoke all on functions from %I', r);
      exception when insufficient_privilege or undefined_object then
        raise notice 'could not change the default privileges of role postgres for %; run this migration once as postgres', r;
      end;
    end if;
  end loop;
end
$$;

-- Audit finding A-06. A function is executable by PUBLIC unless that is revoked, and four security definer functions never had it
-- revoked: create_business, public_document and the two trigger functions audit_row and network_on_document. create_business and
-- public_document are granted to the application role on purpose (0001); everything else about them stays as it was.
--
-- This revokes PUBLIC from every security definer function in the public schema and gives the application role back exactly what
-- it had. It is safe to run again. Rolling back: grant execute on function <name> to public (not recommended).
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public', f);
  end loop;
end
$$;

grant execute on function create_business(uuid, text, text, char, text) to kora_app;
grant execute on function public_document(text) to kora_app;

-- Faster search, and closing a person's account.

-- Trigram indexes make the "contains" searches (name, number, title) fast on large tables.
create extension if not exists pg_trgm;
create index if not exists party_name_trgm on party using gin (name gin_trgm_ops);
create index if not exists item_name_trgm on item using gin (name gin_trgm_ops);
create index if not exists document_number_trgm on document using gin (number gin_trgm_ops);
create index if not exists matter_title_trgm on matter using gin (title gin_trgm_ops);
create index if not exists expense_vendor_trgm on expense using gin (vendor gin_trgm_ops);

-- A closed account keeps its id, because the audit log and the records it created refer to it, but holds no personal details.
alter table app_user add column deleted_at timestamptz;
alter table app_user drop constraint app_user_check;
alter table app_user add constraint app_user_has_identifier check (phone is not null or email is not null or deleted_at is not null);

-- Closes an account in one step. Returns the names of businesses it is the only owner of (and changes nothing), or nothing on success.
-- Runs with the owner's rights because it reaches across tables the application role cannot touch directly.
create or replace function close_account(p_user uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare blocking text[]; ph text; em text;
begin
  select coalesce(array_agg(b.legal_name order by b.legal_name), '{}') into blocking
    from member m join business b on b.id = m.business_id
   where m.user_id = p_user and m.role = 'owner'
     and not exists (select 1 from member o where o.business_id = m.business_id and o.role = 'owner' and o.user_id <> p_user);
  if cardinality(blocking) > 0 then return blocking; end if;
  select phone, email into ph, em from app_user where id = p_user and deleted_at is null;
  if not found then return null; end if;
  delete from matter_access where user_id = p_user;
  delete from member where user_id = p_user;
  delete from app_session where user_id = p_user;
  delete from mfa_challenge where user_id = p_user;
  delete from user_totp where user_id = p_user;
  delete from user_recovery_code where user_id = p_user;
  delete from security_event where user_id = p_user;
  delete from otp_challenge where identifier in (coalesce(ph, ''), coalesce(em, ''));
  update app_user set phone = null, email = null, display_name = null, deleted_at = now() where id = p_user;
  return '{}';
end $$;
revoke all on function close_account(uuid) from public;
grant execute on function close_account(uuid) to kora_app;

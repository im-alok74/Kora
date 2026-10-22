-- Night 4: "Try it with sample data" makes a separate, clearly labelled demo business for the person.
--
-- A demo business is flagged so the app can show a banner on every screen and so it can never be mistaken for the real one.
-- Issued invoices cannot be deleted by design, so removing a demo business does not delete rows. remove_demo_business takes the
-- person (and anyone else) off the business: it disappears from their list and nothing can reach it. It refuses anything that
-- is not a demo business, and anyone who is not an owner of it.
-- Additive only: one column and one function.

alter table business add column is_demo boolean not null default false;

create or replace function remove_demo_business(p_user uuid, p_business uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  select exists (select 1 from business b join member m on m.business_id = b.id
                  where b.id = p_business and b.is_demo and m.user_id = p_user and m.role = 'owner') into ok;
  if not ok then return false; end if;
  -- A business must keep an owner, which is right for a real one and in the way here. The guard is switched off for this one
  -- statement, inside this transaction: if anything fails, it is back on.
  set local lock_timeout = '3s';
  alter table member disable trigger member_owner_guard;
  delete from member where business_id = p_business;
  alter table member enable trigger member_owner_guard;
  return true;
end $$;
revoke all on function remove_demo_business(uuid, uuid) from public;
grant execute on function remove_demo_business(uuid, uuid) to kora_app;

-- Which of the person's businesses are demos, for the banner and for the list in the business switcher.
create or replace function business_is_demo(p_business uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_demo from business where id = p_business), false)
$$;
revoke all on function business_is_demo(uuid) from public;
grant execute on function business_is_demo(uuid) to kora_app;

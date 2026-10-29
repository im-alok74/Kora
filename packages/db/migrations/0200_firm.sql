-- A CA firm as its own tenant, separate from any client's business.
--   firm          the practice
--   firm_member   who works there and in which role (partner, manager, preparer, reviewer)
-- Row level security is on app.firm_id. Being a firm member gives NO access to any client's books; that needs a business-side role.
-- Changes to who belongs to a firm go through the functions below, which check the caller's role.
-- Safe to run twice.

create or replace function current_firm() returns uuid
language sql stable as $$ select nullif(current_setting('app.firm_id', true), '')::uuid $$;

create table if not exists firm (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  plan text not null default 'firm' check (plan in ('starter', 'business', 'firm')),
  created_by uuid not null references app_user(id),
  created_at timestamptz not null default now()
);

create table if not exists firm_member (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firm(id) on delete cascade,
  user_id uuid not null references app_user(id),
  role text not null check (role in ('partner', 'manager', 'preparer', 'reviewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (firm_id, user_id)
);
create index if not exists firm_member_user on firm_member (user_id) where active;

alter table firm enable row level security;
alter table firm force row level security;
drop policy if exists firm_tenant on firm;
create policy firm_tenant on firm for all to kora_app using (id = current_firm()) with check (id = current_firm());

alter table firm_member enable row level security;
alter table firm_member force row level security;
drop policy if exists firm_member_tenant on firm_member;
create policy firm_member_tenant on firm_member for all to kora_app
  using (firm_id = current_firm()) with check (firm_id = current_firm());

grant select on firm, firm_member to kora_app;

-- The signed-in user's firms, for the firm switcher.
create or replace function my_firms(p_user uuid) returns table (firm_id uuid, name text, role text)
language sql stable security definer set search_path = public as $$
  select f.id, f.name, m.role from firm_member m join firm f on f.id = m.firm_id
   where m.user_id = p_user and m.active order by f.name
$$;

-- Role of a user in a firm, or null when not an active member. Used once per request.
create or replace function firm_member_role(p_user uuid, p_firm uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from firm_member where user_id = p_user and firm_id = p_firm and active
$$;

create or replace function create_firm(p_user uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  insert into firm (name, created_by) values (btrim(p_name), p_user) returning id into fid;
  insert into firm_member (firm_id, user_id, role) values (fid, p_user, 'partner');
  return fid;
end $$;

-- Only a partner can add or change a member. Re-adding a removed member turns them back on with the new role.
create or replace function add_firm_member(p_actor uuid, p_firm uuid, p_user uuid, p_role text) returns uuid
language plpgsql security definer set search_path = public as $$
declare mid uuid;
begin
  if coalesce(firm_member_role(p_actor, p_firm), '') <> 'partner' then
    raise exception 'only a partner can add members' using errcode = 'insufficient_privilege';
  end if;
  insert into firm_member (firm_id, user_id, role) values (p_firm, p_user, p_role)
  on conflict (firm_id, user_id) do update set role = excluded.role, active = true
  returning id into mid;
  return mid;
end $$;

-- Turns a member off rather than deleting, so past work keeps its author. The last partner cannot be removed.
create or replace function remove_firm_member(p_actor uuid, p_firm uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(firm_member_role(p_actor, p_firm), '') <> 'partner' then
    raise exception 'only a partner can remove members' using errcode = 'insufficient_privilege';
  end if;
  if firm_member_role(p_user, p_firm) = 'partner'
     and (select count(*) from firm_member where firm_id = p_firm and role = 'partner' and active) <= 1 then
    raise exception 'a firm needs at least one partner' using errcode = 'check_violation';
  end if;
  update firm_member set active = false where firm_id = p_firm and user_id = p_user;
end $$;

revoke all on function my_firms(uuid), firm_member_role(uuid, uuid), create_firm(uuid, text),
       add_firm_member(uuid, uuid, uuid, text), remove_firm_member(uuid, uuid, uuid) from public;
grant execute on function my_firms(uuid), firm_member_role(uuid, uuid), create_firm(uuid, text),
       add_firm_member(uuid, uuid, uuid, text), remove_firm_member(uuid, uuid, uuid) to kora_app;

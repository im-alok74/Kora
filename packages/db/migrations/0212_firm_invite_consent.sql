-- A person added to a firm by a partner now has to accept before they belong to it. Until then they are "invited": they see the invitation,
-- but my_firms() and firm_member_role() do not count them, so the firm's data stays closed to them. Declining switches the membership off.
-- add_firm_member (used by code that already has the person's consent, and by tests) still adds at once. Safe to run twice.

alter table firm_member add column if not exists accepted_at timestamptz;
update firm_member set accepted_at = created_at where accepted_at is null;

create or replace function my_firms(p_user uuid) returns table (firm_id uuid, name text, role text)
language sql stable security definer set search_path = public as $$
  select f.id, f.name, m.role from firm_member m join firm f on f.id = m.firm_id
   where m.user_id = p_user and m.active and m.accepted_at is not null order by f.name
$$;

create or replace function firm_member_role(p_user uuid, p_firm uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from firm_member where user_id = p_user and firm_id = p_firm and active and accepted_at is not null
$$;

create or replace function create_firm(p_user uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  insert into firm (name, created_by) values (btrim(p_name), p_user) returning id into fid;
  insert into firm_member (firm_id, user_id, role, accepted_at) values (fid, p_user, 'partner', now());
  return fid;
end $$;

create or replace function add_firm_member(p_actor uuid, p_firm uuid, p_user uuid, p_role text) returns uuid
language plpgsql security definer set search_path = public as $$
declare mid uuid;
begin
  if coalesce(firm_member_role(p_actor, p_firm), '') <> 'partner' then
    raise exception 'only a partner can add members' using errcode = 'insufficient_privilege';
  end if;
  if p_role <> 'partner' and firm_member_role(p_user, p_firm) = 'partner'
     and (select count(*) from firm_member where firm_id = p_firm and role = 'partner' and active and accepted_at is not null) <= 1 then
    raise exception 'a firm needs at least one partner' using errcode = 'check_violation';
  end if;
  insert into firm_member (firm_id, user_id, role, accepted_at) values (p_firm, p_user, p_role, now())
  on conflict (firm_id, user_id) do update set role = excluded.role, active = true, accepted_at = coalesce(firm_member.accepted_at, now())
  returning id into mid;
  return mid;
end $$;

-- A partner invites someone. A person already in the firm only has their role changed; anyone else (new, or removed before) is invited and must accept.
create or replace function invite_firm_member(p_actor uuid, p_firm uuid, p_user uuid, p_role text) returns uuid
language plpgsql security definer set search_path = public as $$
declare mid uuid;
begin
  if coalesce(firm_member_role(p_actor, p_firm), '') <> 'partner' then
    raise exception 'only a partner can add members' using errcode = 'insufficient_privilege';
  end if;
  if p_role <> 'partner' and firm_member_role(p_user, p_firm) = 'partner'
     and (select count(*) from firm_member where firm_id = p_firm and role = 'partner' and active and accepted_at is not null) <= 1 then
    raise exception 'a firm needs at least one partner' using errcode = 'check_violation';
  end if;
  insert into firm_member (firm_id, user_id, role, accepted_at) values (p_firm, p_user, p_role, null)
  on conflict (firm_id, user_id) do update set role = excluded.role,
    accepted_at = case when firm_member.active and firm_member.accepted_at is not null then firm_member.accepted_at else null end,
    active = true
  returning id into mid;
  return mid;
end $$;

create or replace function remove_firm_member(p_actor uuid, p_firm uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(firm_member_role(p_actor, p_firm), '') <> 'partner' then
    raise exception 'only a partner can remove members' using errcode = 'insufficient_privilege';
  end if;
  if firm_member_role(p_user, p_firm) = 'partner'
     and (select count(*) from firm_member where firm_id = p_firm and role = 'partner' and active and accepted_at is not null) <= 1 then
    raise exception 'a firm needs at least one partner' using errcode = 'check_violation';
  end if;
  update firm_member set active = false where firm_id = p_firm and user_id = p_user;
end $$;

-- The invitations waiting for this person, and their answer.
create or replace function my_firm_invites(p_user uuid) returns table (firm_id uuid, name text, role text)
language sql stable security definer set search_path = public as $$
  select f.id, f.name, m.role from firm_member m join firm f on f.id = m.firm_id
   where m.user_id = p_user and m.active and m.accepted_at is null order by f.name
$$;

create or replace function answer_firm_invite(p_user uuid, p_firm uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_accept then
    update firm_member set accepted_at = now() where firm_id = p_firm and user_id = p_user and active and accepted_at is null;
  else
    update firm_member set active = false where firm_id = p_firm and user_id = p_user and active and accepted_at is null;
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'there is no invitation to answer' using errcode = 'check_violation'; end if;
end $$;

revoke all on function my_firm_invites(uuid), answer_firm_invite(uuid, uuid, boolean), invite_firm_member(uuid, uuid, uuid, text) from public;
grant execute on function my_firm_invites(uuid), answer_firm_invite(uuid, uuid, boolean), invite_firm_member(uuid, uuid, uuid, text) to kora_app;

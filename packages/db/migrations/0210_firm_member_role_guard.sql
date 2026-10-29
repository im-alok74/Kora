-- Changing a member's role through add_firm_member must not leave a firm with no partner. 0200 guarded removal only;
-- this adds the same guard for a demotion. Safe to run twice.

create or replace function add_firm_member(p_actor uuid, p_firm uuid, p_user uuid, p_role text) returns uuid
language plpgsql security definer set search_path = public as $$
declare mid uuid;
begin
  if coalesce(firm_member_role(p_actor, p_firm), '') <> 'partner' then
    raise exception 'only a partner can add members' using errcode = 'insufficient_privilege';
  end if;
  if p_role <> 'partner' and firm_member_role(p_user, p_firm) = 'partner'
     and (select count(*) from firm_member where firm_id = p_firm and role = 'partner' and active) <= 1 then
    raise exception 'a firm needs at least one partner' using errcode = 'check_violation';
  end if;
  insert into firm_member (firm_id, user_id, role) values (p_firm, p_user, p_role)
  on conflict (firm_id, user_id) do update set role = excluded.role, active = true
  returning id into mid;
  return mid;
end $$;

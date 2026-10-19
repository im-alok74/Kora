-- Team: listing members with their contact details, and changing roles. Both check the caller's business.

-- Members of the current business, with the contact details of each. Cross-table, so it is a function.
create or replace function list_members()
returns table (user_id uuid, role text, phone text, email text, display_name text, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.role, u.phone, u.email, u.display_name, m.created_at
    from member m join app_user u on u.id = m.user_id
   where m.business_id = current_business()
   order by case m.role when 'owner' then 0 when 'staff' then 1 else 2 end, m.created_at
$$;
revoke all on function list_members() from public;
grant execute on function list_members() to kora_app;

-- Only an owner can change a role. The last owner cannot be demoted (member_owner_guard).
create or replace function set_member_role(p_actor uuid, p_business uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(member_role(p_actor, p_business), '') <> 'owner' then
    raise exception 'only an owner can change roles' using errcode = 'insufficient_privilege';
  end if;
  update member set role = p_role where business_id = p_business and user_id = p_user;
  if not found then raise exception 'that person is not a member' using errcode = 'no_data_found'; end if;
end $$;
revoke all on function set_member_role(uuid, uuid, uuid, text) from public;
grant execute on function set_member_role(uuid, uuid, uuid, text) to kora_app;

-- Actor names for the audit log viewer.
create or replace function audit_with_actors(p_limit int, p_table text, p_row text)
returns table (id bigint, at timestamptz, actor_id uuid, actor text, table_name text, row_id text, action text, before jsonb, after jsonb)
language sql stable security definer set search_path = public as $$
  select a.id, a.at, a.actor_id, coalesce(u.display_name, u.phone, u.email, case when a.actor_id = '00000000-0000-0000-0000-000000000001' then 'Kora (automatic)' end),
         a.table_name, a.row_id, a.action, a.before, a.after
    from audit_log a left join app_user u on u.id = a.actor_id
   where a.business_id = current_business()
     and (p_table is null or a.table_name = p_table) and (p_row is null or a.row_id = p_row)
   order by a.id desc limit least(coalesce(p_limit, 100), 500)
$$;
revoke all on function audit_with_actors(int, text, text) from public;
grant execute on function audit_with_actors(int, text, text) to kora_app;

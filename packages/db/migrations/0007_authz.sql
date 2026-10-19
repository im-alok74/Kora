-- Defence in depth: the database itself refuses a user who is no longer a member of the business.
-- The request check (resolveTenant) is the first gate; this is the second, so a removed member's request
-- already in flight, or a session that outlived its membership, reads and writes nothing.

create or replace function is_authorized() returns boolean
language sql stable security definer set search_path = public as $$
  select current_actor() = '00000000-0000-0000-0000-000000000001'::uuid
      or exists (select 1 from member where business_id = current_business() and user_id = current_actor())
$$;
revoke all on function is_authorized() from public;
grant execute on function is_authorized() to kora_app;

do $$ declare t text; begin
  foreach t in array array['member','party','item','number_series','document','document_line','share_link','payment','payment_allocation',
                           'einvoice','eway_bill','recurring_schedule','reminder','delivery','audit_log','document_template','payment_link'] loop
    execute format('drop policy tenant_isolation on %I', t);
    execute format('create policy tenant_isolation on %I for all to kora_app
                      using (business_id = current_business() and (select is_authorized()))
                      with check (business_id = current_business() and (select is_authorized()))', t);
  end loop;
end $$;

drop policy business_tenant on business;
create policy business_tenant on business for all to kora_app
  using (id = current_business() and (select is_authorized()))
  with check (id = current_business() and (select is_authorized()));

-- The two listing functions bypass row-level security, so they check authorisation themselves.
create or replace function list_members()
returns table (user_id uuid, role text, phone text, email text, display_name text, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.role, u.phone, u.email, u.display_name, m.created_at
    from member m join app_user u on u.id = m.user_id
   where m.business_id = current_business() and is_authorized()
   order by case m.role when 'owner' then 0 when 'staff' then 1 else 2 end, m.created_at
$$;

create or replace function audit_with_actors(p_limit int, p_table text, p_row text)
returns table (id bigint, at timestamptz, actor_id uuid, actor text, table_name text, row_id text, action text, before jsonb, after jsonb)
language sql stable security definer set search_path = public as $$
  select a.id, a.at, a.actor_id, coalesce(u.display_name, u.phone, u.email, case when a.actor_id = '00000000-0000-0000-0000-000000000001' then 'Kora (automatic)' end),
         a.table_name, a.row_id, a.action, a.before, a.after
    from audit_log a left join app_user u on u.id = a.actor_id
   where a.business_id = current_business() and is_authorized()
     and (p_table is null or a.table_name = p_table) and (p_row is null or a.row_id = p_row)
   order by a.id desc limit least(coalesce(p_limit, 100), 500)
$$;

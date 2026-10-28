-- Which plan a business is on. One row per business; no row means the free plan (starter). Tenants can read their own row; only
-- set_business_plan() writes it, and that is called by Kora's billing code and the admin panel, never from a tenant request.
-- Safe to run twice.
create table if not exists business_plan (
  business_id uuid primary key references business(id) on delete cascade,
  plan text not null default 'starter' check (plan in ('starter', 'business', 'firm')),
  status text not null default 'free' check (status in ('free', 'trialing', 'active', 'past_due', 'cancelled')),
  valid_until timestamptz,
  note text check (note is null or length(note) <= 500),
  updated_at timestamptz not null default now()
);
alter table business_plan enable row level security;
alter table business_plan force row level security;
drop policy if exists business_plan_read on business_plan;
create policy business_plan_read on business_plan for select using (business_id = current_business() and (select is_authorized()));
grant select on business_plan to kora_app;

create or replace function set_business_plan(p_business uuid, p_plan text, p_status text, p_valid_until timestamptz, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into business_plan (business_id, plan, status, valid_until, note) values (p_business, p_plan, p_status, p_valid_until, p_note)
  on conflict (business_id) do update set plan = excluded.plan, status = excluded.status, valid_until = excluded.valid_until,
                                          note = coalesce(excluded.note, business_plan.note), updated_at = now();
end $$;
revoke all on function set_business_plan(uuid, text, text, timestamptz, text) from public;
grant execute on function set_business_plan(uuid, text, text, timestamptz, text) to kora_app;

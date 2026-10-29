-- Kora's own billing: a business subscribes to a plan through Razorpay Subscriptions. Everything that changes state goes through
-- the functions at the bottom, so a repeated webhook cannot charge a period twice or move a plan twice. Tenants can read their own
-- subscription and payments and nothing else. Safe to run twice.

create table if not exists subscription (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  gateway text not null check (gateway in ('razorpay', 'mock')),
  gateway_subscription_id text not null unique,
  plan text not null check (plan in ('business', 'firm')),
  status text not null default 'created' check (status in ('created', 'active', 'past_due', 'cancelled', 'completed')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscription_business on subscription (business_id, created_at desc);
alter table subscription enable row level security;
alter table subscription force row level security;
drop policy if exists subscription_read on subscription;
create policy subscription_read on subscription for select using (business_id = current_business() and (select is_authorized()));
grant select on subscription to kora_app;

create table if not exists billing_payment (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  subscription_id uuid not null references subscription(id),
  gateway_payment_id text not null unique,
  amount_paise bigint not null check (amount_paise > 0),
  period_end timestamptz,
  paid_at timestamptz not null default now()
);
create index if not exists billing_payment_business on billing_payment (business_id, paid_at desc);
alter table billing_payment enable row level security;
alter table billing_payment force row level security;
drop policy if exists billing_payment_read on billing_payment;
create policy billing_payment_read on billing_payment for select using (business_id = current_business() and (select is_authorized()));
grant select on billing_payment to kora_app;

-- Every webhook event once. The primary key is what makes a replay a no-op.
create table if not exists billing_event (
  gateway text not null,
  event_id text not null,
  type text not null,
  received_at timestamptz not null default now(),
  primary key (gateway, event_id)
);
revoke all on billing_event from public;

create or replace function billing_start(p_business uuid, p_plan text, p_gateway text, p_gateway_sub text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid;
begin
  insert into subscription (business_id, gateway, gateway_subscription_id, plan) values (p_business, p_gateway, p_gateway_sub, p_plan) returning id into v;
  return v;
end $$;

create or replace function billing_set_cancel(p_business uuid, p_gateway_sub text, p_cancel boolean) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update subscription set cancel_at_period_end = p_cancel, updated_at = now() where business_id = p_business and gateway_subscription_id = p_gateway_sub;
  return found;
end $$;

create or replace function billing_apply_event(p_gateway text, p_event_id text, p_type text, p_sub text, p_period_end timestamptz,
                                               p_payment_id text, p_amount bigint) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare s subscription%rowtype; new_status text;
begin
  insert into billing_event (gateway, event_id, type) values (p_gateway, p_event_id, p_type) on conflict do nothing;
  if not found then return 'duplicate'; end if;
  select * into s from subscription where gateway = p_gateway and gateway_subscription_id = p_sub for update;
  if not found then return 'unknown_subscription'; end if;
  if p_type in ('subscription.activated', 'subscription.charged') then
    new_status := 'active';
  elsif p_type in ('subscription.pending', 'subscription.halted') then
    new_status := 'past_due';
  elsif p_type in ('subscription.cancelled', 'subscription.completed') then
    new_status := case when p_type = 'subscription.completed' then 'completed' else 'cancelled' end;
  else
    return 'ignored';
  end if;
  update subscription set status = new_status, current_period_end = coalesce(p_period_end, current_period_end), updated_at = now() where id = s.id;
  if p_payment_id is not null and p_amount is not null and p_amount > 0 then
    insert into billing_payment (business_id, subscription_id, gateway_payment_id, amount_paise, period_end)
    values (s.business_id, s.id, p_payment_id, p_amount, p_period_end) on conflict (gateway_payment_id) do nothing;
  end if;
  perform set_business_plan(s.business_id, s.plan,
    case new_status when 'active' then 'active' when 'past_due' then 'past_due' else 'cancelled' end,
    coalesce(p_period_end, s.current_period_end));
  return 'applied';
end $$;

revoke all on function billing_start(uuid, text, text, text) from public;
revoke all on function billing_set_cancel(uuid, text, boolean) from public;
revoke all on function billing_apply_event(text, text, text, text, timestamptz, text, bigint) from public;
grant execute on function billing_start(uuid, text, text, text) to kora_app;
grant execute on function billing_set_cancel(uuid, text, boolean) to kora_app;
grant execute on function billing_apply_event(text, text, text, text, timestamptz, text, bigint) to kora_app;

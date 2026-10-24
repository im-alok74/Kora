-- Durable replay records. Retain alongside the financial records; do not prune with operational jobs.
create table payment_operation (
  business_id uuid not null references business(id),
  operation_key text not null,
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (business_id, operation_key)
);
alter table payment_operation enable row level security;
create policy payment_operation_tenant on payment_operation
  using (business_id = current_business() and (select is_authorized()))
  with check (business_id = current_business() and (select is_authorized()));
grant select, insert on payment_operation to kora_app;

-- Step 5: API keys, outbound webhooks, and a log of data exports.

-- ---------------------------------------------------------------- exports
-- Who took data out, and what. Whole-business exports are sensitive, so each one leaves a record.
create table data_export (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  user_id uuid references app_user(id),
  kind text not null check (kind in ('workbook', 'backup', 'tally', 'import_customers', 'import_items')),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on data_export (business_id, created_at desc);

-- ---------------------------------------------------------------- API keys
-- Only a hash of the key is stored. The key is shown once, when it is made.
create table api_key (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  key_hash bytea not null unique,
  prefix text not null check (length(prefix) between 6 and 16),     -- the first few characters, to recognise a key in a list
  scope text not null check (scope in ('read', 'write')),
  created_by uuid not null references app_user(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index on api_key (business_id) where revoked_at is null;

-- A request arrives with a key and no tenant. This finds which business and role it belongs to, and nothing else.
-- It also notes when the key was last used, at most once a minute so a busy integration does not write on every call.
create or replace function api_key_lookup(p_hash bytea)
returns table (key_id uuid, business_id uuid, scope text, created_by uuid)
language plpgsql security definer set search_path = public as $$
begin
  update api_key set last_used_at = now()
   where key_hash = p_hash and revoked_at is null and (last_used_at is null or last_used_at < now() - interval '1 minute');
  return query select k.id, k.business_id, k.scope, k.created_by from api_key k where k.key_hash = p_hash and k.revoked_at is null;
end $$;
revoke all on function api_key_lookup(bytea) from public;
grant execute on function api_key_lookup(bytea) to kora_app;

-- ---------------------------------------------------------------- webhooks
-- The signing secret has to be readable to sign requests, so this table is not copied into the audit log.
create table webhook_endpoint (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  url text not null check (length(url) between 10 and 500 and url ~ '^https?://'),
  description text check (description is null or length(description) <= 120),
  events text[] not null check (cardinality(events) between 1 and 20),
  secret text not null check (length(secret) >= 24),
  active boolean not null default true,
  consecutive_failures int not null default 0,
  created_by uuid not null references app_user(id),
  created_at timestamptz not null default now()
);
create index on webhook_endpoint (business_id) where active;

create table webhook_delivery (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  endpoint_id uuid not null references webhook_endpoint(id) on delete cascade,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts int not null default 0,
  response_status int,
  error text check (error is null or length(error) <= 500),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (endpoint_id, event_id)
);
create index on webhook_delivery (endpoint_id, created_at desc);

-- ---------------------------------------------------------------- access
do $$ declare t text; begin
  foreach t in array array['data_export', 'api_key', 'webhook_endpoint', 'webhook_delivery'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I for all to kora_app
                      using (business_id = current_business() and (select is_authorized()))
                      with check (business_id = current_business() and (select is_authorized()))', t);
  end loop;
end $$;
create trigger audit_api_key after insert or update or delete on api_key for each row execute function audit_row();
create trigger audit_data_export after insert or update or delete on data_export for each row execute function audit_row();
grant select, insert on data_export to kora_app;
grant select, insert, update, delete on api_key to kora_app;
grant select, insert, update, delete on webhook_endpoint to kora_app;
grant select, insert, update, delete on webhook_delivery to kora_app;

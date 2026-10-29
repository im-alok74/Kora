-- The clients a CA firm looks after, whether or not they use Kora.
--   client_entity        a legal entity the firm serves (a company, a proprietor, a trust)
--   client_registration  one GST registration of that entity; an entity can have several (one per state)
-- A client does not need a Kora business. Linking one comes later and needs the business owner's consent.
-- Both tables are isolated on app.firm_id. Safe to run twice.

create table if not exists client_entity (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firm(id) on delete cascade,
  legal_name text not null check (length(btrim(legal_name)) between 1 and 200),
  pan text check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  source_software text not null default '' check (length(source_software) <= 60),
  contact_name text not null default '' check (length(contact_name) <= 120),
  contact_email text not null default '' check (length(contact_email) <= 200),
  contact_phone text not null default '' check (length(contact_phone) <= 30),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now()
);
create index if not exists client_entity_firm on client_entity (firm_id, legal_name);

create table if not exists client_registration (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firm(id) on delete cascade,
  client_id uuid not null references client_entity(id) on delete cascade,
  gstin text not null check (gstin_valid(gstin)),
  registration_type text not null default 'regular' check (registration_type in ('regular', 'composition', 'sez', 'isd')),
  filing_frequency text not null default 'monthly' check (filing_frequency in ('monthly', 'quarterly')),
  state_code text not null check (state_code ~ '^[0-9]{2}$'),
  created_at timestamptz not null default now(),
  unique (firm_id, gstin)
);
create index if not exists client_registration_client on client_registration (client_id);

do $$ declare t text; begin
  foreach t in array array['client_entity', 'client_registration'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists firm_tenant on %I', t);
    execute format('create policy firm_tenant on %I for all to kora_app
                      using (firm_id = current_firm()) with check (firm_id = current_firm())', t);
    execute format('grant select, insert, update on %I to kora_app', t);
  end loop;
end $$;

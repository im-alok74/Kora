-- One piece of recurring work: a service, for one GST registration, for one period.
-- There can be only one per (registration, service, period), so running the monthly generator twice creates nothing new.
-- statutory_deadline is the date the rule gives; deadline_source says where it came from. A null deadline means "set it by hand":
-- Kora never guesses a date for a registration whose rule it does not know (quarterly filers, notified extensions).
-- Isolated on app.firm_id. Safe to run twice.

create table if not exists engagement (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firm(id) on delete cascade,
  client_id uuid not null references client_entity(id) on delete cascade,
  registration_id uuid not null references client_registration(id) on delete cascade,
  service text not null check (service in ('gstr1', 'gstr3b')),
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  statutory_deadline date,
  deadline_source text not null default '' check (length(deadline_source) <= 200),
  internal_target date,
  status text not null default 'open' check (status in ('open', 'preparing', 'in_review', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (registration_id, service, period)
);
create index if not exists engagement_firm_period on engagement (firm_id, period);
create index if not exists engagement_client on engagement (client_id);

alter table engagement enable row level security;
alter table engagement force row level security;
drop policy if exists firm_tenant on engagement;
create policy firm_tenant on engagement for all to kora_app
  using (firm_id = current_firm()) with check (firm_id = current_firm());
grant select, insert, update on engagement to kora_app;

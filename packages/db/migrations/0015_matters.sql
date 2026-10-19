-- Lawyer module: matters (cases or engagements), time and expense entries billed from them, and a client money ledger.

create table matter (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  party_id uuid not null,
  title text not null check (length(title) between 1 and 160),
  reference text check (reference is null or length(reference) between 1 and 60),
  status text not null default 'open' check (status in ('open', 'closed')),
  rate_paise bigint not null default 0 check (rate_paise >= 0),                       -- default hourly rate for time entries
  sac text not null default '998212' check (sac ~ '^[0-9]{4,8}$'),                    -- SAC printed on the invoice lines
  reverse_charge boolean not null default false,                                       -- tax payable by the client; the owner decides, with their CA
  tds_bp integer not null default 0 check (tds_bp between 0 and 2000),
  notes text check (notes is null or length(notes) <= 2000),
  opened_on date not null default current_date,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, party_id) references party (business_id, id)
);
create unique index matter_reference_unique on matter (business_id, lower(reference)) where reference is not null;
create index on matter (business_id, status, created_at desc);
create trigger matter_touch before update on matter for each row execute function touch_updated_at();

-- One row per piece of time or per expense paid on the client's behalf. A time entry's amount is worked out once, in paise, when it is
-- saved, so later changes to the matter's rate never change an old entry. Entries that went onto an invoice are locked.
create table matter_entry (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  matter_id uuid not null references matter(id) on delete cascade,
  kind text not null check (kind in ('time', 'expense')),
  entry_date date not null,
  description text not null check (length(description) between 1 and 300),
  minutes integer check (minutes is null or minutes between 1 and 1440),
  rate_paise bigint check (rate_paise is null or rate_paise >= 0),
  amount_paise bigint not null check (amount_paise > 0),
  billable boolean not null default true,
  pure_agent boolean not null default false,                                           -- an expense paid as the client's agent, passed on without GST
  invoiced_document_id uuid,
  claim_id uuid,                                                                       -- held while an invoice is being made from this entry
  claimed_at timestamptz,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  check ((kind = 'time') = (minutes is not null and rate_paise is not null)),
  check (kind = 'expense' or not pure_agent),
  foreign key (business_id, invoiced_document_id) references document (business_id, id) on delete set null (invoiced_document_id)
);
create index on matter_entry (matter_id, entry_date, created_at);
create index on matter_entry (business_id, invoiced_document_id);

create or replace function matter_entry_lock() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.invoiced_document_id is not null then
      raise exception 'This entry is on an invoice and cannot be deleted.' using errcode = '23514';
    end if;
    return old;
  end if;
  -- on an invoiced entry the only allowed change is the invoice going away (a deleted draft frees its entries)
  if old.invoiced_document_id is not null and new.invoiced_document_id is not null
     and (to_jsonb(new) - 'claim_id' - 'claimed_at') is distinct from (to_jsonb(old) - 'claim_id' - 'claimed_at') then
    raise exception 'This entry is on an invoice and cannot be changed.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger matter_entry_lock before update or delete on matter_entry for each row execute function matter_entry_lock();

-- Money held for a client. Append-only: a mistake is corrected by a later entry, never by editing history.
-- 'deposit' adds to the balance; 'refund' and 'applied' (kept to pay an invoice) take away. The balance can never go below zero.
create table client_fund_entry (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  matter_id uuid not null references matter(id) on delete cascade,
  entry_date date not null,
  kind text not null check (kind in ('deposit', 'refund', 'applied')),
  amount_paise bigint not null check (amount_paise > 0),
  note text check (note is null or length(note) <= 300),
  created_by uuid references app_user(id),
  created_at timestamptz not null default now()
);
create index on client_fund_entry (matter_id, entry_date, created_at);

create or replace function client_fund_guard() returns trigger language plpgsql as $$
declare bal bigint;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Client money entries cannot be changed or deleted. Add a correcting entry instead.' using errcode = '23514';
  end if;
  perform 1 from matter where id = new.matter_id for update;      -- one entry at a time per matter, so two refunds cannot both pass
  select coalesce(sum(case when kind = 'deposit' then amount_paise else -amount_paise end), 0) into bal from client_fund_entry where matter_id = new.matter_id;
  if new.kind <> 'deposit' and new.amount_paise > bal then
    raise exception 'Only Rs % is held for this client, so that much cannot be taken out.', (bal / 100)::text || '.' || lpad((bal % 100)::text, 2, '0') using errcode = '23514';
  end if;
  return new;
end $$;
create trigger client_fund_guard before insert or update or delete on client_fund_entry for each row execute function client_fund_guard();

do $$ declare t text; begin
  foreach t in array array['matter', 'matter_entry', 'client_fund_entry'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I for all to kora_app
                      using (business_id = current_business() and (select is_authorized()))
                      with check (business_id = current_business() and (select is_authorized()))', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row()', 'audit_' || t, t);
  end loop;
end $$;
grant select, insert, update, delete on matter to kora_app;
grant select, insert, update, delete on matter_entry to kora_app;
grant select, insert on client_fund_entry to kora_app;

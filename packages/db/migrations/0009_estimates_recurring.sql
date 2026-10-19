-- Estimates (accept, decline, convert to an invoice) and recurring invoices.
-- An issued estimate is frozen like any issued document, so what happens to it afterwards lives in estimate_state.

create table estimate_state (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  document_id uuid not null,
  decision text check (decision in ('accepted', 'declined')),
  decided_at timestamptz,
  decided_by uuid references app_user(id),
  converted_to_id uuid,                              -- the draft or issued invoice made from this estimate
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id),
  foreign key (business_id, document_id) references document (business_id, id) on delete cascade,
  -- If the draft invoice is deleted, the estimate can be converted again.
  foreign key (business_id, converted_to_id) references document (business_id, id) on delete set null (converted_to_id)
);
create unique index estimate_state_converted_once on estimate_state (converted_to_id) where converted_to_id is not null;
create trigger estimate_state_touch before update on estimate_state for each row execute function touch_updated_at();

-- Where an estimate stands, worked out in the business's own time zone so "expired" flips at local midnight.
create or replace function estimate_status(p_status text, p_due date, p_tz text, p_decision text, p_converted uuid) returns text
language sql stable as $$
  select case when p_status = 'draft' then 'draft'
              when p_status = 'cancelled' then 'cancelled'
              when p_converted is not null then 'invoiced'
              when p_decision = 'accepted' then 'accepted'
              when p_decision = 'declined' then 'declined'
              when p_due is not null and p_due < (now() at time zone p_tz)::date then 'expired'
              else 'open' end
$$;

-- The earlier recurring_schedule was a placeholder that nothing used. Profiles replace it.
drop table recurring_schedule;

create table recurring_profile (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  party_id uuid not null,
  doc_type text not null check (doc_type in ('tax_invoice', 'bill_of_supply')),
  every_n int not null default 1 check (every_n between 1 and 24),
  unit text not null check (unit in ('week', 'month', 'year')),
  start_date date not null,
  end_date date check (end_date is null or end_date >= start_date),
  occurrence int not null default 0 check (occurrence >= 0),  -- how many dates have been passed, counted from start_date
  next_run_date date not null,
  mode text not null default 'draft' check (mode in ('draft', 'issue', 'issue_and_send')),
  channel text check (channel in ('whatsapp', 'sms', 'email')),
  terms_days int not null default 0 check (terms_days between 0 and 365),   -- due date = run date + this
  payload jsonb not null,                                                    -- lines, notes, terms
  active boolean not null default true,
  created_by uuid not null references app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (mode <> 'issue_and_send' or channel is not null),
  unique (business_id, id),
  foreign key (business_id, party_id) references party (business_id, id)
);
create index on recurring_profile (active, next_run_date);
create trigger recurring_profile_touch before update on recurring_profile for each row execute function touch_updated_at();

-- One row per scheduled date, so a retried or doubled worker tick can never create the same invoice twice.
create table recurring_run (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  profile_id uuid not null,
  run_date date not null,
  status text not null default 'pending' check (status in ('pending', 'created', 'failed')),
  document_id uuid,
  note text,
  created_at timestamptz not null default now(),
  unique (profile_id, run_date),
  foreign key (business_id, profile_id) references recurring_profile (business_id, id) on delete cascade,
  foreign key (business_id, document_id) references document (business_id, id) on delete set null (document_id)
);
create index on recurring_run (profile_id, run_date desc);

do $$ declare t text; begin
  foreach t in array array['estimate_state', 'recurring_profile', 'recurring_run'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on %1$s for each row execute function audit_row()', t);
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I for all to kora_app
                      using (business_id = current_business() and (select is_authorized()))
                      with check (business_id = current_business() and (select is_authorized()))', t);
  end loop;
end $$;
grant select, insert, update on estimate_state to kora_app;
grant select, insert, update, delete on recurring_profile to kora_app;
grant select, insert, update on recurring_run to kora_app;

-- Profiles due today in their own business's time zone, across tenants. The worker then handles each in its tenant.
create or replace function due_recurring(p_limit int)
returns table (id uuid, business_id uuid)
language sql stable security definer set search_path = public as $$
  select p.id, p.business_id from recurring_profile p join business b on b.id = p.business_id
   where p.active and p.next_run_date <= (now() at time zone b.timezone)::date
   order by p.next_run_date limit p_limit
$$;
revoke all on function due_recurring(int) from public;
grant execute on function due_recurring(int) to kora_app;

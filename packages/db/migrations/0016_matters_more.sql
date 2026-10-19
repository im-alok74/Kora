-- Lawyer module, second part: lump-sum fees, paying an invoice from money held for the client, hearing dates and deadlines,
-- and matters that only chosen people can see.

-- ---------------------------------------------------------------- fixed fees
-- A fee is a lump sum for a stage of work or a period (a fixed fee, or a monthly retainer fee). It has no hours.
alter table matter_entry drop constraint matter_entry_kind_check;
alter table matter_entry add constraint matter_entry_kind_check check (kind in ('time', 'expense', 'fee'));

-- ---------------------------------------------------------------- paying an invoice from money held
alter table payment drop constraint payment_method_check;
alter table payment add constraint payment_method_check check (method in ('cash','upi','card','netbanking','bank_transfer','cheque','tds','client_money','other'));

alter table client_fund_entry add column document_id uuid;
alter table client_fund_entry add constraint client_fund_entry_document_fk foreign key (business_id, document_id) references document (business_id, id);
-- earlier "kept to pay an invoice" entries have no invoice, so the rule is applied to new rows only
alter table client_fund_entry add constraint client_fund_applied_has_document check (kind <> 'applied' or document_id is not null) not valid;

-- ---------------------------------------------------------------- hearings and deadlines
create table matter_event (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  matter_id uuid not null references matter(id) on delete cascade,
  event_date date not null,
  kind text not null default 'hearing' check (kind in ('hearing', 'deadline', 'other')),
  title text not null check (length(title) between 1 and 160),
  notes text check (notes is null or length(notes) <= 1000),
  done boolean not null default false,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now()
);
create index on matter_event (business_id, done, event_date);
create index on matter_event (matter_id, event_date);

-- ---------------------------------------------------------------- who can see a matter
alter table matter add column restricted boolean not null default false;
create table matter_access (
  id uuid not null unique default gen_random_uuid(),           -- the audit log keys its records on an id
  matter_id uuid not null references matter(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  business_id uuid not null references business(id) on delete cascade,
  primary key (matter_id, user_id)
);

-- A restricted matter is seen by the owners and the people listed. The background worker (the system actor) is not restricted.
create or replace function matter_visible(m uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from matter x
     where x.id = m and x.business_id = current_business()
       and (not x.restricted
            or current_actor() = '00000000-0000-0000-0000-000000000001'::uuid
            or exists (select 1 from member where business_id = x.business_id and user_id = current_actor() and role = 'owner')
            or exists (select 1 from matter_access a where a.matter_id = x.id and a.user_id = current_actor())))
$$;
revoke all on function matter_visible(uuid) from public;
grant execute on function matter_visible(uuid) to kora_app;

-- The matter's own policy cannot look itself up (a row being inserted is not yet visible to a lookup), so it works from the row's own values.
create or replace function matter_row_visible(m uuid, b uuid, r boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select not r
      or current_actor() = '00000000-0000-0000-0000-000000000001'::uuid
      or exists (select 1 from member where business_id = b and user_id = current_actor() and role = 'owner')
      or exists (select 1 from matter_access a where a.matter_id = m and a.user_id = current_actor())
$$;
revoke all on function matter_row_visible(uuid, uuid, boolean) from public;
grant execute on function matter_row_visible(uuid, uuid, boolean) to kora_app;

drop policy tenant_isolation on matter;
create policy tenant_isolation on matter for all to kora_app
  using (business_id = current_business() and (select is_authorized()) and matter_row_visible(id, business_id, restricted))
  with check (business_id = current_business() and (select is_authorized()));
drop policy tenant_isolation on matter_entry;
drop policy tenant_isolation on client_fund_entry;
do $$ declare t text; begin
  foreach t in array array['matter_entry', 'client_fund_entry', 'matter_event', 'matter_access'] loop
    if t = 'matter_event' or t = 'matter_access' then
      execute format('alter table %I enable row level security', t);
      execute format('alter table %I force row level security', t);
    end if;
    execute format('create policy tenant_isolation on %I for all to kora_app
                      using (business_id = current_business() and (select is_authorized()) and matter_visible(matter_id))
                      with check (business_id = current_business() and (select is_authorized()) and matter_visible(matter_id))', t);
  end loop;
end $$;
create trigger audit_matter_event after insert or update or delete on matter_event for each row execute function audit_row();
create trigger audit_matter_access after insert or update or delete on matter_access for each row execute function audit_row();
grant select, insert, update, delete on matter_event to kora_app;
grant select, insert, delete on matter_access to kora_app;

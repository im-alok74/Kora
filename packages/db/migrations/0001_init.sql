-- Kora schema. PostgreSQL 15+. Money is bigint paise. Times are timestamptz (UTC).
-- Rules enforced here, in the database, so no code path can bypass them:
--   * row-level security on business_id for every tenant table (fail closed)
--   * gapless numbering per series and financial year, assigned by trigger at issue
--   * totals equal the sum of lines, checked at issue
--   * issued documents are immutable (only settlement and e-invoice mirror fields move)
--   * idempotent payment webhooks (unique gateway + event id)
--   * append-only audit log
-- Per-request contract: in every transaction the app runs
--     select set_config('app.business_id', '<uuid>', true), set_config('app.user_id', '<uuid>', true);
-- If app.business_id is unset, tenant tables return no rows and accept no writes.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- roles
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'kora_app') then
    create role kora_app nologin;      -- web app and worker connect as a login role that inherits this
  end if;
end $$;

-- ---------------------------------------------------------------- helpers
create or replace function current_business() returns uuid
language sql stable as $$ select nullif(current_setting('app.business_id', true), '')::uuid $$;

create or replace function current_actor() returns uuid
language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- GSTIN: 15 chars, pattern plus mod-36 check digit.
create or replace function gstin_valid(g text) returns boolean
language plpgsql immutable as $$
declare
  chars constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  total int := 0; v int; i int; f int;
begin
  if g is null or g !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then return false; end if;
  for i in 1..14 loop
    v := position(substr(g, i, 1) in chars) - 1;
    f := case when i % 2 = 1 then 1 else 2 end;
    v := v * f;
    total := total + (v / 36) + (v % 36);
  end loop;
  return substr(chars, ((36 - (total % 36)) % 36) + 1, 1) = substr(g, 15, 1);
end $$;

-- Indian financial year label for a date: 2026-04-01 -> '2026-27'.
create or replace function fy_label(d date) returns text language sql immutable as $$
  select case when extract(month from d) >= 4
              then extract(year from d)::int || '-' || lpad(((extract(year from d)::int + 1) % 100)::text, 2, '0')
              else (extract(year from d)::int - 1) || '-' || lpad((extract(year from d)::int % 100)::text, 2, '0') end $$;

-- ---------------------------------------------------------------- global reference data (no tenant)
create table tax_rate (
  rate_bp int primary key check (rate_bp >= 0),   -- 1800 = 18.00 percent
  label text not null,
  active boolean not null default true
);
-- Seed is a starting list. A practising CA must confirm current slabs before beta.
insert into tax_rate (rate_bp, label) values
  (0, '0%'), (25, '0.25%'), (300, '3%'), (500, '5%'), (1200, '12%'), (1800, '18%'), (2800, '28%'), (4000, '40%')
on conflict do nothing;

create table state_code (
  code char(2) primary key,
  name text not null
);

create table app_user (
  id uuid primary key default gen_random_uuid(),
  phone text unique,
  email text unique,
  display_name text,
  created_at timestamptz not null default now(),
  check (phone is not null or email is not null)
);

-- ---------------------------------------------------------------- tenancy
create table business (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  trade_name text,
  gstin text unique check (gstin is null or gstin_valid(gstin)),
  registration_type text not null default 'regular'
    check (registration_type in ('unregistered','regular','composition','sez','isd')),
  state_code char(2) not null references state_code(code),
  turnover_band text not null default 'under_5cr'
    check (turnover_band in ('under_5cr','over_5cr')),
  -- Threshold memory: owner answers whether turnover crossed the limit in any year since FY2017-18.
  crossed_einvoice_threshold boolean not null default false,
  einvoice_enabled boolean not null default false,
  einvoice_threshold_paise bigint not null default 500000000000 check (einvoice_threshold_paise > 0), -- Rs 5 crore, configurable
  fy_start_month int not null default 4 check (fy_start_month = 4),
  default_currency char(3) not null default 'INR',
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((registration_type = 'unregistered') = (gstin is null)),
  check (gstin is null or substr(gstin, 1, 2) = state_code::text)
);
create trigger business_touch before update on business for each row execute function touch_updated_at();

create table member (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  role text not null check (role in ('owner','staff','accountant')),
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);
create index on member (user_id);

create or replace function member_keep_owner() returns trigger language plpgsql as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    if not exists (select 1 from member where business_id = old.business_id and role = 'owner' and id <> old.id) then
      if tg_op = 'DELETE' and not exists (select 1 from business where id = old.business_id) then return old; end if;
      raise exception 'a business must keep at least one owner' using errcode = 'check_violation';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger member_owner_guard before update or delete on member for each row execute function member_keep_owner();

-- ---------------------------------------------------------------- parties and items
create table party (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  kind text not null check (kind in ('customer','vendor','both')),
  name text not null,
  gstin text check (gstin is null or gstin_valid(gstin)),
  phone text, email text,
  billing_address jsonb not null default '{}',
  shipping_address jsonb,
  state_code char(2) not null references state_code(code),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (gstin is null or substr(gstin, 1, 2) = state_code::text)
);
create index on party (business_id, name);
create index on party (business_id, gstin);
create trigger party_touch before update on party for each row execute function touch_updated_at();

create table item (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  name text not null,
  kind text not null default 'goods' check (kind in ('goods','service')),
  hsn_sac text check (hsn_sac is null or hsn_sac ~ '^[0-9]{4,8}$'),
  unit text not null default 'NOS',
  default_rate_bp int not null references tax_rate(rate_bp),
  cess_rate_bp int not null default 0 check (cess_rate_bp >= 0),
  price_paise bigint not null default 0 check (price_paise >= 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);
create index on item (business_id, name);
create index on item (default_rate_bp);
create trigger item_touch before update on item for each row execute function touch_updated_at();

-- ---------------------------------------------------------------- numbering
create table number_series (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  doc_type text not null check (doc_type in
    ('tax_invoice','bill_of_supply','estimate','proforma','delivery_challan','credit_note','debit_note')),
  prefix text not null default '' check (prefix ~ '^[A-Za-z0-9/-]*$'),   -- GST rule 46 allows only these
  financial_year text not null check (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  pad_width int not null default 4 check (pad_width between 1 and 8),
  last_number bigint not null default 0 check (last_number >= 0),
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, doc_type, prefix, financial_year),
  check (length(prefix) + pad_width <= 16)                               -- invoice number max 16 characters
);

-- ---------------------------------------------------------------- documents
create table document (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  doc_type text not null check (doc_type in
    ('tax_invoice','bill_of_supply','estimate','proforma','delivery_challan','credit_note','debit_note')),
  status text not null default 'draft' check (status in ('draft','issued','cancelled')),
  series_id uuid,
  number text check (number is null or length(number) <= 16),
  financial_year text,
  doc_date date not null default current_date,
  due_date date,
  party_id uuid,
  original_document_id uuid,                                  -- credit and debit notes point at the invoice they correct
  place_of_supply char(2) not null references state_code(code),
  reverse_charge boolean not null default false,
  currency char(3) not null default 'INR',
  exchange_rate_micro bigint not null default 1000000 check (exchange_rate_micro > 0),
  taxable_paise bigint not null default 0 check (taxable_paise >= 0),
  cgst_paise bigint not null default 0 check (cgst_paise >= 0),
  sgst_paise bigint not null default 0 check (sgst_paise >= 0),
  igst_paise bigint not null default 0 check (igst_paise >= 0),
  cess_paise bigint not null default 0 check (cess_paise >= 0),
  tcs_paise bigint not null default 0 check (tcs_paise >= 0),
  tds_paise bigint not null default 0 check (tds_paise >= 0),   -- receivable reduction, not part of invoice total
  round_off_paise bigint not null default 0 check (abs(round_off_paise) <= 50),
  grand_total_paise bigint not null default 0 check (grand_total_paise >= 0),
  amount_settled_paise bigint not null default 0 check (amount_settled_paise >= 0),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','part_paid','paid')),
  einvoice_required boolean not null default false,
  einvoice_status text not null default 'none'
    check (einvoice_status in ('none','pending','registering','registered','rejected','cancelled')),
  supplier_snapshot jsonb,                                    -- copied at issue
  recipient_snapshot jsonb,
  notes text, terms text,
  pdf_object_key text,
  last_sent_at timestamptz,
  issued_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, series_id, number),
  foreign key (business_id, series_id) references number_series (business_id, id),
  foreign key (business_id, party_id) references party (business_id, id),
  foreign key (business_id, original_document_id) references document (business_id, id),
  -- Under reverse charge the tax is shown but the recipient pays it, so it is not part of the amount due.
  check (grand_total_paise = taxable_paise
         + case when reverse_charge then 0 else cgst_paise + sgst_paise + igst_paise + cess_paise end
         + tcs_paise + round_off_paise),
  check (amount_settled_paise <= grand_total_paise),
  check (igst_paise = 0 or (cgst_paise = 0 and sgst_paise = 0)),
  check (cgst_paise = sgst_paise),
  check (status = 'draft' or (number is not null and series_id is not null and issued_at is not null)),
  check ((doc_type in ('credit_note','debit_note')) = (original_document_id is not null)),
  check (doc_type <> 'bill_of_supply' or (cgst_paise + sgst_paise + igst_paise + cess_paise) = 0)
);
create index on document (business_id, doc_date desc);
create index on document (business_id, party_id);
create index on document (business_id, status, payment_status, due_date);
create index on document (series_id);
create index on document (original_document_id);
create trigger document_touch before update on document for each row execute function touch_updated_at();

create table document_line (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  document_id uuid not null,
  position int not null check (position > 0),
  item_id uuid,                                               -- reference only; the snapshot below is the truth
  item_name text not null,
  hsn_sac text check (hsn_sac is null or hsn_sac ~ '^[0-9]{4,8}$'),
  unit text not null default 'NOS',
  quantity numeric(14,3) not null check (quantity > 0),
  rate_paise bigint not null check (rate_paise >= 0),
  gross_paise bigint not null check (gross_paise >= 0),
  discount_paise bigint not null default 0 check (discount_paise >= 0),
  taxable_paise bigint not null check (taxable_paise >= 0),
  tax_rate_bp int not null references tax_rate(rate_bp),
  cess_rate_bp int not null default 0 check (cess_rate_bp >= 0),
  cgst_paise bigint not null default 0 check (cgst_paise >= 0),
  sgst_paise bigint not null default 0 check (sgst_paise >= 0),
  igst_paise bigint not null default 0 check (igst_paise >= 0),
  cess_paise bigint not null default 0 check (cess_paise >= 0),
  line_total_paise bigint not null check (line_total_paise >= 0),
  unique (document_id, position),
  foreign key (business_id, document_id) references document (business_id, id) on delete cascade,
  foreign key (business_id, item_id) references item (business_id, id),
  check (taxable_paise = gross_paise - discount_paise),
  check (cgst_paise = sgst_paise),
  check (igst_paise = 0 or (cgst_paise = 0 and sgst_paise = 0)),
  check (line_total_paise = taxable_paise + cgst_paise + sgst_paise + igst_paise + cess_paise)
);
create index on document_line (document_id);
create index on document_line (business_id, item_id);
create index on document_line (tax_rate_bp);

-- Lines can only change while the parent is a draft.
create or replace function line_guard() returns trigger language plpgsql as $$
declare st text; did uuid := coalesce(new.document_id, old.document_id);
begin
  select status into st from document where id = did;
  if st is null then return coalesce(new, old); end if;          -- parent already deleted (cascade)
  if st <> 'draft' then
    raise exception 'document % is % and its lines are immutable', did, st using errcode = 'integrity_constraint_violation';
  end if;
  return coalesce(new, old);
end $$;
create trigger line_guard before insert or update or delete on document_line for each row execute function line_guard();

-- Document lifecycle: drafts are free; draft -> issued validates and numbers; issued is frozen.
create or replace function document_guard() returns trigger language plpgsql as $$
declare
  s record; n bigint; sums record; biz record; prt record; live int;
  frozen text[] := array['status','amount_settled_paise','payment_status','einvoice_status','pdf_object_key',
                         'last_sent_at','cancelled_at','cancel_reason','updated_at'];
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'documents are created as drafts' using errcode = 'integrity_constraint_violation';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'issued documents cannot be deleted; cancel or issue a credit note' using errcode = 'integrity_constraint_violation';
    end if;
    return old;
  end if;

  -- UPDATE
  if old.status = 'draft' and new.status = 'draft' then return new; end if;

  if old.status = 'draft' and new.status = 'issued' then
    select * into biz from business where id = new.business_id;
    if new.doc_type in ('tax_invoice','credit_note','debit_note') and biz.gstin is null then
      raise exception 'a registered GSTIN is required to issue a %', new.doc_type using errcode = 'check_violation';
    end if;
    if new.doc_type = 'tax_invoice' and biz.registration_type = 'composition' then
      raise exception 'composition dealers issue a bill of supply' using errcode = 'check_violation';
    end if;
    if new.party_id is null and new.doc_type in ('credit_note','debit_note','delivery_challan') then
      raise exception 'a party is required for %', new.doc_type using errcode = 'check_violation';
    end if;
    if new.original_document_id is not null and
       not exists (select 1 from document where id = new.original_document_id and status = 'issued'
                   and doc_type in ('tax_invoice','bill_of_supply')) then
      raise exception 'credit and debit notes must point at an issued invoice' using errcode = 'check_violation';
    end if;

    select count(*) c, coalesce(sum(taxable_paise),0) taxable, coalesce(sum(cgst_paise),0) cgst,
           coalesce(sum(sgst_paise),0) sgst, coalesce(sum(igst_paise),0) igst, coalesce(sum(cess_paise),0) cess
      into sums from document_line where document_id = new.id;
    if sums.c = 0 then raise exception 'a document needs at least one line' using errcode = 'check_violation'; end if;
    if (sums.taxable, sums.cgst, sums.sgst, sums.igst, sums.cess)
       is distinct from (new.taxable_paise, new.cgst_paise, new.sgst_paise, new.igst_paise, new.cess_paise) then
      raise exception 'document totals do not equal the sum of lines' using errcode = 'check_violation';
    end if;
    if new.doc_type = 'tax_invoice' and exists (select 1 from document_line where document_id = new.id
                                                 and hsn_sac is null) and biz.turnover_band = 'over_5cr' then
      raise exception 'HSN or SAC is required on every line' using errcode = 'check_violation';
    end if;

    -- numbering: lock the series row so concurrent issues serialise and numbers stay gapless
    new.financial_year := fy_label(new.doc_date);
    select * into s from number_series
      where business_id = new.business_id and doc_type = new.doc_type and financial_year = new.financial_year
        and (new.series_id is null or id = new.series_id)
      order by (id = new.series_id) desc nulls last, prefix limit 1 for update;
    if not found then
      raise exception 'no number series for % in FY %', new.doc_type, new.financial_year using errcode = 'check_violation';
    end if;
    n := s.last_number + 1;
    new.number := s.prefix || lpad(n::text, s.pad_width, '0');
    if length(new.number) > 16 then
      raise exception 'invoice number % exceeds 16 characters', new.number using errcode = 'check_violation';
    end if;
    update number_series set last_number = n where id = s.id;
    new.series_id := s.id;
    new.issued_at := now();
    new.einvoice_required := (new.doc_type in ('tax_invoice','credit_note','debit_note') and biz.einvoice_enabled
                              and new.party_id is not null
                              and exists (select 1 from party where id = new.party_id and gstin is not null));
    new.einvoice_status := case when new.einvoice_required then 'pending' else 'none' end;
    new.supplier_snapshot := (select to_jsonb(b) - 'id' from business b where b.id = new.business_id);
    new.recipient_snapshot := (select to_jsonb(p) - 'id' from party p where p.id = new.party_id);
    return new;
  end if;

  if old.status = 'issued' and new.status = 'cancelled' then
    if old.amount_settled_paise > 0 then
      raise exception 'a document with payments cannot be cancelled; issue a credit note' using errcode = 'check_violation';
    end if;
    select count(*) into live from einvoice where document_id = old.id and status = 'registered';
    if live > 0 then
      raise exception 'cancel the e-invoice first, or issue a credit note after the cancellation window' using errcode = 'check_violation';
    end if;
    new.cancelled_at := now();
  elsif old.status <> new.status then
    raise exception 'illegal status change % -> %', old.status, new.status using errcode = 'integrity_constraint_violation';
  end if;

  if old.status = 'cancelled' and (to_jsonb(new) - frozen) is distinct from (to_jsonb(old) - frozen) then
    raise exception 'cancelled documents are frozen' using errcode = 'integrity_constraint_violation';
  end if;
  if (to_jsonb(new) - frozen) is distinct from (to_jsonb(old) - frozen) then
    raise exception 'issued documents are immutable; issue a credit or debit note' using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$;
create trigger document_guard before insert or update or delete on document for each row execute function document_guard();

-- GSTIN and state of a business cannot change once documents exist. Raise a new business instead.
create or replace function business_freeze_identity() returns trigger language plpgsql as $$
begin
  if (new.gstin is distinct from old.gstin or new.state_code <> old.state_code)
     and exists (select 1 from document where business_id = old.id and status <> 'draft') then
    raise exception 'GSTIN and state cannot change after documents are issued' using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$;
create trigger business_identity_guard before update on business for each row execute function business_freeze_identity();

-- Share links (public invoice page with view tracking). The public page reads through a
-- security-definer function (see bottom) so it never needs a tenant session.
create table share_link (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  document_id uuid not null,
  token_hash bytea not null unique,                 -- sha256 of the token; the token itself is never stored
  expires_at timestamptz,
  view_count int not null default 0,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (business_id, document_id) references document (business_id, id) on delete cascade
);
create index on share_link (document_id);

-- ---------------------------------------------------------------- payments
create table payment (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  party_id uuid,
  amount_paise bigint not null check (amount_paise > 0),
  method text not null check (method in ('cash','upi','card','netbanking','bank_transfer','cheque','tds','other')),
  gateway text,                                     -- 'razorpay', 'cashfree', null for manual
  gateway_event_id text,
  gateway_payment_id text,
  received_on date not null default current_date,
  note text,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, party_id) references party (business_id, id),
  check ((gateway is null) = (gateway_event_id is null)),
  unique (gateway, gateway_event_id)                -- a duplicate webhook cannot create a second payment
);
create index on payment (business_id, received_on desc);
create index on payment (party_id);

-- A payment, or a credit note, settles part of an invoice.
create table payment_allocation (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  payment_id uuid,
  credit_note_id uuid,
  document_id uuid not null,
  amount_paise bigint not null check (amount_paise > 0),
  created_at timestamptz not null default now(),
  foreign key (business_id, payment_id) references payment (business_id, id),
  foreign key (business_id, credit_note_id) references document (business_id, id),
  foreign key (business_id, document_id) references document (business_id, id),
  check ((payment_id is null) <> (credit_note_id is null))
);
create index on payment_allocation (payment_id);
create index on payment_allocation (credit_note_id);
create index on payment_allocation (document_id);

create or replace function allocation_guard() returns trigger language plpgsql as $$
declare
  did uuid := coalesce(new.document_id, old.document_id);
  pid uuid := coalesce(new.payment_id, old.payment_id);
  cid uuid := coalesce(new.credit_note_id, old.credit_note_id);
  doc record; src bigint; used bigint; settled bigint;
begin
  select * into doc from document where id = did for update;                  -- serialise per document
  if doc.status <> 'issued' or doc.doc_type not in ('tax_invoice','bill_of_supply','debit_note') then
    raise exception 'only issued invoices can be settled' using errcode = 'check_violation';
  end if;
  if pid is not null then
    select amount_paise into src from payment where id = pid for update;
    select coalesce(sum(amount_paise),0) into used from payment_allocation where payment_id = pid;
    if used > src then raise exception 'allocations exceed the payment' using errcode = 'check_violation'; end if;
  else
    select grand_total_paise into src from document where id = cid and status = 'issued' and doc_type = 'credit_note' for update;
    if src is null then raise exception 'credit note must be issued' using errcode = 'check_violation'; end if;
    select coalesce(sum(amount_paise),0) into used from payment_allocation where credit_note_id = cid;
    if used > src then raise exception 'allocations exceed the credit note' using errcode = 'check_violation'; end if;
  end if;
  select coalesce(sum(amount_paise),0) into settled from payment_allocation where document_id = did;
  if settled > doc.grand_total_paise then
    raise exception 'allocations exceed the document total' using errcode = 'check_violation';
  end if;
  update document set amount_settled_paise = settled,
      payment_status = case when settled = 0 then 'unpaid' when settled = grand_total_paise then 'paid' else 'part_paid' end
    where id = did;
  return null;
end $$;
create constraint trigger allocation_guard after insert or update or delete on payment_allocation
  deferrable initially immediate for each row execute function allocation_guard();

create table webhook_event (                       -- raw inbox, written before the tenant is known; worker role only
  id uuid primary key default gen_random_uuid(),
  gateway text not null,
  event_id text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (gateway, event_id)
);

-- ---------------------------------------------------------------- compliance
create table einvoice (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  document_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending','registering','registered','rejected','cancelled','failed')),
  irn text, ack_no text, ack_date timestamptz,
  signed_invoice text, signed_qr text,
  error_code text, error_message text,
  attempts int not null default 0,
  next_attempt_at timestamptz,
  cancel_deadline timestamptz,                      -- ack_date + 24 hours
  request_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, document_id) references document (business_id, id),
  check (status <> 'registered' or (irn is not null and ack_no is not null and ack_date is not null and signed_qr is not null))
);
-- one live record per document
create unique index einvoice_one_live on einvoice (document_id) where status in ('pending','registering','registered');
create unique index einvoice_irn_unique on einvoice (irn) where irn is not null;
create index on einvoice (business_id, status);
create index on einvoice (status, next_attempt_at);
create trigger einvoice_touch before update on einvoice for each row execute function touch_updated_at();

create table eway_bill (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  document_id uuid not null,
  ewb_number text unique,
  valid_until timestamptz,
  vehicle_no text, transporter_id text, distance_km int,
  status text not null default 'pending' check (status in ('pending','active','extended','cancelled','failed')),
  error_message text,
  created_at timestamptz not null default now(),
  foreign key (business_id, document_id) references document (business_id, id)
);
create index on eway_bill (business_id, document_id);

create or replace function eway_needs_issued() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from document where id = new.document_id and status = 'issued') then
    raise exception 'an e-way bill needs an issued document' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger eway_needs_issued before insert on eway_bill for each row execute function eway_needs_issued();

-- ---------------------------------------------------------------- recurring, reminders, delivery
create table recurring_schedule (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  template_document_id uuid not null,
  every_n int not null default 1 check (every_n > 0),
  unit text not null check (unit in ('day','week','month','year')),
  next_run_at timestamptz not null,                 -- computed in the business time zone by the scheduler
  end_on date,
  send_mode text not null default 'draft' check (send_mode in ('draft','issue','issue_and_send')),
  mandate_ref text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (business_id, template_document_id) references document (business_id, id)
);
create index on recurring_schedule (active, next_run_at);
create index on recurring_schedule (template_document_id);

create table reminder (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  document_id uuid not null,
  channel text not null check (channel in ('whatsapp','sms','email')),
  scheduled_at timestamptz not null,
  delivery_status text not null default 'scheduled'
    check (delivery_status in ('scheduled','sent','delivered','read','failed','cancelled')),
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  foreign key (business_id, document_id) references document (business_id, id) on delete cascade
);
create index on reminder (document_id);
create index on reminder (delivery_status, scheduled_at);

create or replace function cancel_reminders_when_paid() returns trigger language plpgsql as $$
begin
  if new.payment_status = 'paid' and old.payment_status <> 'paid' or new.status = 'cancelled' and old.status <> 'cancelled' then
    update reminder set delivery_status = 'cancelled' where document_id = new.id and delivery_status = 'scheduled';
  end if;
  return null;
end $$;
create trigger reminders_stop after update on document for each row execute function cancel_reminders_when_paid();

create table delivery (                              -- every send of a document, whatever the channel
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  document_id uuid not null,
  channel text not null check (channel in ('whatsapp','sms','email','link')),
  to_address text,
  status text not null default 'queued' check (status in ('queued','sent','delivered','read','failed')),
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  foreign key (business_id, document_id) references document (business_id, id) on delete cascade
);
create index on delivery (document_id);

-- ---------------------------------------------------------------- audit log (append only)
create table audit_log (
  id bigint generated always as identity primary key,
  business_id uuid not null,
  actor_id uuid,
  table_name text not null,
  row_id text,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  before jsonb, after jsonb,
  at timestamptz not null default now()
);
create index on audit_log (business_id, at desc);
create index on audit_log (business_id, table_name, row_id);

create or replace function audit_block_change() returns trigger language plpgsql as $$
begin raise exception 'audit_log is append-only' using errcode = 'insufficient_privilege'; end $$;
create trigger audit_no_update before update or delete on audit_log for each row execute function audit_block_change();
create trigger audit_no_truncate before truncate on audit_log for each statement execute function audit_block_change();

create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare bid uuid; rid text;
begin
  bid := coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> 'business_id')::uuid,
                  (case when tg_op = 'DELETE' then old.id else new.id end));
  rid := (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id';
  insert into audit_log (business_id, actor_id, table_name, row_id, action, before, after)
  values (bid, current_actor(), tg_table_name, rid, tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

do $$ declare t text; begin
  foreach t in array array['business','member','party','item','number_series','document','payment',
                           'payment_allocation','einvoice','eway_bill','recurring_schedule'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on %1$s for each row execute function audit_row()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- row-level security
do $$ declare t text; begin
  foreach t in array array['member','party','item','number_series','document','document_line','share_link','payment',
                           'payment_allocation','einvoice','eway_bill','recurring_schedule','reminder','delivery','audit_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I for all to kora_app
                      using (business_id = current_business()) with check (business_id = current_business())', t);
  end loop;
end $$;

alter table business enable row level security;
alter table business force row level security;
create policy business_tenant on business for all to kora_app
  using (id = current_business()) with check (id = current_business() or current_business() is null);
-- Note: creating a business happens through create_business() below, which is security definer.

-- Public invoice page: token in, one document out, view counted. No tenant session needed.
create or replace function public_document(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l share_link; d document; r jsonb;
begin
  select * into l from share_link where token_hash = digest(p_token, 'sha256')
    and revoked_at is null and (expires_at is null or expires_at > now());
  if not found then return null; end if;
  update share_link set view_count = view_count + 1, last_viewed_at = now(),
         first_viewed_at = coalesce(first_viewed_at, now()) where id = l.id;
  select * into d from document where id = l.document_id;
  select to_jsonb(d) || jsonb_build_object('lines',
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.position), '[]') from document_line x where x.document_id = d.id))
    into r;
  return r;
end $$;

create or replace function create_business(p_user uuid, p_legal_name text, p_gstin text, p_state char(2), p_type text)
returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid;
begin
  insert into business (legal_name, gstin, state_code, registration_type) values (p_legal_name, p_gstin, p_state, p_type)
    returning id into bid;
  insert into member (business_id, user_id, role) values (bid, p_user, 'owner');
  return bid;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on all tables in schema public from public;
grant select on tax_rate, state_code to kora_app;
grant select, insert, update on app_user to kora_app;
grant select, update on business to kora_app;
grant select, insert, update, delete on member, party, item, number_series, document, document_line,
      share_link, payment, payment_allocation, einvoice, eway_bill, recurring_schedule, reminder, delivery to kora_app;
grant select, insert on audit_log to kora_app;          -- no update, no delete
grant execute on function public_document(text), create_business(uuid, text, text, char, text) to kora_app;

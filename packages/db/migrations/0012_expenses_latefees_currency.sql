-- Step 4: expenses, late fees on overdue invoices, and documents in other currencies.

-- ---------------------------------------------------------------- expenses
create table expense (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  expense_date date not null,
  vendor text check (vendor is null or length(vendor) <= 120),
  category text not null check (length(category) between 1 and 60),
  amount_paise bigint not null check (amount_paise > 0),                                       -- what was paid, tax included
  gst_paise bigint not null default 0 check (gst_paise >= 0 and gst_paise <= amount_paise),    -- the GST inside that amount, for the owner's records
  paid_via text not null default 'cash' check (paid_via in ('cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other')),
  notes text check (notes is null or length(notes) <= 1000),
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on expense (business_id, expense_date desc);
create trigger expense_touch before update on expense for each row execute function touch_updated_at();

-- A receipt photo or PDF. Kept apart from the expense so the audit log, which copies whole rows, never holds file contents.
create table expense_receipt (
  expense_id uuid primary key references expense(id) on delete cascade,
  business_id uuid not null references business(id) on delete cascade,
  file_name text not null check (length(file_name) between 1 and 120),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'application/pdf')),
  data bytea not null check (octet_length(data) between 1 and 2097152),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- late fees
-- The settings (whether to offer a late fee, and how it is worked out) live on the business.
alter table business add column late_fee_config jsonb not null default '{"enabled": false}';

-- A late fee is charged by a debit note the owner reviews and issues. This records how much has been charged on each
-- invoice and up to which date, so the same days are never charged twice. Deleting the draft debit note removes the record.
create table late_fee_charge (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  invoice_id uuid not null,
  debit_note_id uuid not null,
  fee_paise bigint not null check (fee_paise > 0),
  charged_through date not null,
  created_at timestamptz not null default now(),
  unique (debit_note_id),
  foreign key (business_id, invoice_id) references document (business_id, id),
  foreign key (business_id, debit_note_id) references document (business_id, id) on delete cascade
);
create index on late_fee_charge (invoice_id);

-- ---------------------------------------------------------------- currency
-- Estimates and proforma invoices can be in another currency. A GST tax invoice is always in rupees: invoices to overseas
-- customers (exports) are not supported yet.
alter table party add column currency char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$');
alter table document add constraint document_currency_scope check (currency = 'INR' or doc_type in ('estimate', 'proforma'));

-- ---------------------------------------------------------------- access
do $$ declare t text; begin
  foreach t in array array['expense', 'expense_receipt', 'late_fee_charge'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I for all to kora_app
                      using (business_id = current_business() and (select is_authorized()))
                      with check (business_id = current_business() and (select is_authorized()))', t);
  end loop;
end $$;
create trigger audit_expense after insert or update or delete on expense for each row execute function audit_row();
create trigger audit_late_fee_charge after insert or update or delete on late_fee_charge for each row execute function audit_row();
grant select, insert, update, delete on expense to kora_app;
grant select, insert, update, delete on expense_receipt to kora_app;
grant select, insert, update, delete on late_fee_charge to kora_app;

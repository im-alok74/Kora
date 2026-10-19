-- Purchases: bills from vendors, payments made against them, the input tax credit they carry, and the GSTR-2B statement to check them against.

create table purchase_bill (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  party_id uuid not null,                                       -- the vendor
  bill_number text not null check (length(bill_number) between 1 and 40),
  bill_date date not null,
  due_date date,
  supply text not null check (supply in ('intra', 'inter')),    -- from the vendor's state and ours
  reverse_charge boolean not null default false,                -- tax is ours to pay, not the vendor's to charge
  taxable_paise bigint not null check (taxable_paise >= 0),
  cgst_paise bigint not null default 0 check (cgst_paise >= 0),
  sgst_paise bigint not null default 0 check (sgst_paise >= 0),
  igst_paise bigint not null default 0 check (igst_paise >= 0),
  cess_paise bigint not null default 0 check (cess_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),         -- what the vendor is owed (tax left out under reverse charge)
  paid_paise bigint not null default 0 check (paid_paise >= 0),
  itc_status text not null default 'eligible' check (itc_status in ('eligible', 'blocked')),
  itc_reason text check (itc_reason is null or length(itc_reason) <= 300),
  status text not null default 'recorded' check (status in ('recorded', 'cancelled')),
  notes text check (notes is null or length(notes) <= 1000),
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, party_id) references party (business_id, id),
  check (paid_paise <= total_paise),
  check (total_paise = taxable_paise + case when reverse_charge then 0 else cgst_paise + sgst_paise + igst_paise + cess_paise end)
);
create unique index purchase_bill_vendor_number on purchase_bill (business_id, party_id, lower(bill_number)) where status <> 'cancelled';
create index on purchase_bill (business_id, bill_date desc);
create index on purchase_bill (business_id, status, due_date);
create trigger purchase_bill_touch before update on purchase_bill for each row execute function touch_updated_at();

create table purchase_line (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  bill_id uuid not null references purchase_bill(id) on delete cascade,
  line_no int not null check (line_no > 0),
  description text not null check (length(description) between 1 and 300),
  hsn_sac text check (hsn_sac is null or hsn_sac ~ '^[0-9]{4,8}$'),
  quantity_milli bigint not null check (quantity_milli > 0),
  rate_paise bigint not null check (rate_paise >= 0),
  discount_paise bigint not null default 0 check (discount_paise >= 0),
  tax_rate_bp int not null check (tax_rate_bp between 0 and 4000),
  cess_rate_bp int not null default 0 check (cess_rate_bp >= 0),
  taxable_paise bigint not null,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0,
  cess_paise bigint not null default 0,
  total_paise bigint not null,
  unique (bill_id, line_no)
);

create table purchase_payment (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  bill_id uuid not null references purchase_bill(id) on delete cascade,
  paid_on date not null,
  amount_paise bigint not null check (amount_paise > 0),
  method text not null default 'bank_transfer' check (method in ('cash', 'upi', 'card', 'netbanking', 'bank_transfer', 'cheque', 'other')),
  note text check (note is null or length(note) <= 300),
  created_by uuid references app_user(id),
  created_at timestamptz not null default now()
);
create index on purchase_payment (bill_id);

-- One line of a GSTR-2B statement, as the GST portal lists what suppliers have filed for you. Matched to a bill, or left unmatched.
create table gstr2b_entry (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  supplier_gstin text not null check (length(supplier_gstin) = 15),
  supplier_name text,
  invoice_number text not null check (length(invoice_number) between 1 and 40),
  invoice_date date,
  taxable_paise bigint not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0,
  cess_paise bigint not null default 0,
  itc_available boolean not null default true,
  reverse_charge boolean not null default false,
  bill_id uuid references purchase_bill(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (business_id, period, supplier_gstin, invoice_number)
);
create index on gstr2b_entry (business_id, period);
create index on gstr2b_entry (bill_id);

do $$ declare t text; begin
  foreach t in array array['purchase_bill', 'purchase_line', 'purchase_payment', 'gstr2b_entry'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I for all to kora_app
                      using (business_id = current_business() and (select is_authorized()))
                      with check (business_id = current_business() and (select is_authorized()))', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row()', 'audit_' || t, t);
    execute format('grant select, insert, update, delete on %I to kora_app', t);
  end loop;
end $$;

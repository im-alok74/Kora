-- The Kora network: businesses on Kora can send each other invoices and orders without email or retyping.
--   * An invoice issued to a customer whose GSTIN belongs to another Kora business is delivered to that business as a received invoice,
--     which they accept (it becomes a purchase bill with its input credit) or reject.
--   * A business can list itself in a directory with a catalogue of items, and other businesses can send it purchase orders, which it
--     accepts (a draft invoice is made) or declines.
-- Everything crossing from one business to another goes through the functions below, which run with the owner's rights and check
-- who is asking. The tables themselves still keep each business to its own rows.

alter table business add column network_receive boolean not null default true;     -- accept invoices sent through Kora
alter table item add column network_listed boolean not null default false;          -- show in the catalogue, if the business is listed

create table network_profile (
  business_id uuid primary key references business(id) on delete cascade,
  listed boolean not null default false,
  about text check (about is null or length(about) <= 600),
  categories text[] not null default '{}' check (cardinality(categories) <= 8),
  city text check (city is null or length(city) <= 80),
  updated_at timestamptz not null default now()
);

create table network_invoice (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,              -- the buyer, who owns this row
  seller_business_id uuid not null references business(id) on delete cascade,
  seller_name text not null,
  seller_gstin text not null,
  source_document_id uuid not null,
  doc_type text not null check (doc_type in ('tax_invoice', 'bill_of_supply')),
  number text not null,
  doc_date date not null,
  due_date date,
  supply text not null check (supply in ('intra', 'inter')),
  reverse_charge boolean not null default false,
  taxable_paise bigint not null,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0,
  cess_paise bigint not null default 0,
  grand_total_paise bigint not null,
  lines jsonb not null,
  status text not null default 'new' check (status in ('new', 'accepted', 'rejected')),
  seller_cancelled_at timestamptz,
  bill_id uuid references purchase_bill(id) on delete set null,
  decided_by uuid references app_user(id),
  decided_at timestamptz,
  reason text check (reason is null or length(reason) <= 300),
  received_at timestamptz not null default now(),
  unique (business_id, seller_business_id, source_document_id)
);
create index on network_invoice (business_id, status, received_at desc);
create index on network_invoice (seller_business_id, source_document_id);

create table network_order (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,              -- the buyer who placed it
  seller_business_id uuid not null references business(id) on delete cascade,
  buyer_name text not null,
  buyer_gstin text not null,
  seller_name text not null,
  seller_gstin text not null,
  po_number text not null check (length(po_number) between 1 and 40),
  po_date date not null,
  expected_on date,
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 100),
  notes text check (notes is null or length(notes) <= 1000),
  status text not null default 'sent' check (status in ('sent', 'accepted', 'declined', 'cancelled')),
  decline_reason text check (decline_reason is null or length(decline_reason) <= 300),
  seller_document_id uuid,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (business_id, po_number),
  check (business_id <> seller_business_id)
);
create index on network_order (seller_business_id, status, created_at desc);

-- A buyer can only cancel a sent order. A seller can only accept or decline it, and link the invoice made from it. Nothing else changes.
create or replace function network_order_guard() returns trigger language plpgsql as $$
declare frozen_old jsonb; frozen_new jsonb;
begin
  frozen_old := to_jsonb(old) - 'status' - 'decline_reason' - 'seller_document_id' - 'decided_at';
  frozen_new := to_jsonb(new) - 'status' - 'decline_reason' - 'seller_document_id' - 'decided_at';
  if frozen_old is distinct from frozen_new then raise exception 'An order cannot be edited once it is sent.' using errcode = '23514'; end if;
  if old.status <> 'sent' then raise exception 'This order has already been %.', old.status using errcode = '23514'; end if;
  if current_business() = old.business_id then
    if new.status <> 'cancelled' or new.decline_reason is distinct from old.decline_reason or new.seller_document_id is distinct from old.seller_document_id then
      raise exception 'Only the seller can accept or decline an order. You can cancel it.' using errcode = '23514';
    end if;
  elsif current_business() = old.seller_business_id then
    if new.status not in ('accepted', 'declined') then raise exception 'You can accept or decline an order you received.' using errcode = '23514'; end if;
  else
    raise exception 'Not your order.' using errcode = '23514';
  end if;
  new.decided_at := now();
  return new;
end $$;
create trigger network_order_guard before update on network_order for each row execute function network_order_guard();

do $$ declare t text; begin
  foreach t in array array['network_profile', 'network_invoice'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I for all to kora_app
                      using (business_id = current_business() and (select is_authorized()))
                      with check (business_id = current_business() and (select is_authorized()))', t);
    execute format('grant select, insert, update, delete on %I to kora_app', t);
  end loop;
end $$;
-- An order belongs to both sides while it lasts.
alter table network_order enable row level security;
alter table network_order force row level security;
create policy order_parties on network_order for all to kora_app
  using ((business_id = current_business() or seller_business_id = current_business()) and (select is_authorized()))
  with check ((business_id = current_business() or seller_business_id = current_business()) and (select is_authorized()));
grant select, insert, update on network_order to kora_app;

-- ---------------------------------------------------------------- delivering an issued invoice to the buyer's Kora business
create or replace function network_deliver(p_doc uuid) returns void language plpgsql security definer set search_path = public as $$
declare d record; s record; pty record; buyer uuid; lns jsonb; sup text;
begin
  select * into d from document where id = p_doc;
  if d.id is null or d.doc_type not in ('tax_invoice', 'bill_of_supply') or d.party_id is null then return; end if;
  select gstin into pty from party where id = d.party_id;
  if pty.gstin is null then return; end if;
  select id into buyer from business where gstin = pty.gstin and id <> d.business_id and network_receive;
  if buyer is null then return; end if;
  select legal_name, trade_name, gstin into s from business where id = d.business_id;
  if s.gstin is null then return; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'position', position, 'name', item_name, 'hsn', hsn_sac, 'unit', unit, 'quantity', quantity::text, 'rate_paise', rate_paise, 'discount_paise', discount_paise,
           'tax_rate_bp', tax_rate_bp, 'cess_rate_bp', cess_rate_bp, 'taxable_paise', taxable_paise, 'cgst_paise', cgst_paise, 'sgst_paise', sgst_paise, 'igst_paise', igst_paise,
           'cess_paise', cess_paise, 'total_paise', line_total_paise) order by position), '[]'::jsonb)
    into lns from document_line where document_id = p_doc;
  sup := case when d.cgst_paise > 0 or d.sgst_paise > 0 then 'intra' else 'inter' end;
  insert into network_invoice (business_id, seller_business_id, seller_name, seller_gstin, source_document_id, doc_type, number, doc_date, due_date, supply, reverse_charge,
                               taxable_paise, cgst_paise, sgst_paise, igst_paise, cess_paise, grand_total_paise, lines)
  values (buyer, d.business_id, coalesce(s.trade_name, s.legal_name), s.gstin, d.id, d.doc_type, d.number, d.doc_date, d.due_date, sup, d.reverse_charge,
          d.taxable_paise, d.cgst_paise, d.sgst_paise, d.igst_paise, d.cess_paise, d.grand_total_paise, lns)
  on conflict (business_id, seller_business_id, source_document_id) do nothing;
end $$;

create or replace function network_on_document() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.doc_type in ('tax_invoice', 'bill_of_supply') then
    if old.status = 'draft' and new.status = 'issued' then
      -- Delivery is a courtesy to the buyer. If it ever fails, the invoice must still be issued.
      begin
        perform network_deliver(new.id);
      exception when others then
        raise warning 'network delivery failed for document %: %', new.id, sqlerrm;
      end;
    elsif old.status = 'issued' and new.status = 'cancelled' then
      update network_invoice set seller_cancelled_at = now() where seller_business_id = new.business_id and source_document_id = new.id;
    end if;
  end if;
  return new;
end $$;
create trigger document_network after update of status on document for each row when (old.status is distinct from new.status) execute function network_on_document();

-- The seller's view of what became of an invoice they sent through Kora.
create or replace function network_delivery_status(p_doc uuid) returns table (buyer_name text, status text, seller_cancelled boolean, received_at timestamptz, decided_at timestamptz, reason text)
language sql stable security definer set search_path = public as $$
  select b.legal_name, n.status, n.seller_cancelled_at is not null, n.received_at, n.decided_at, n.reason
    from network_invoice n join business b on b.id = n.business_id
   where n.source_document_id = p_doc and n.seller_business_id = current_business() and is_authorized()
$$;

-- ---------------------------------------------------------------- the directory
create or replace function network_directory(p_q text, p_limit int default 30) returns table (business_id uuid, name text, gstin text, city text, state_code char(2), about text, categories text[], items int)
language sql stable security definer set search_path = public as $$
  select b.id, coalesce(b.trade_name, b.legal_name), b.gstin, p.city, b.state_code, p.about, p.categories,
         (select count(*)::int from item i where i.business_id = b.id and i.network_listed and i.archived_at is null)
    from network_profile p join business b on b.id = p.business_id
   where p.listed and b.gstin is not null and b.id <> current_business() and is_authorized()
     and (p_q is null or p_q = '' or b.legal_name ilike '%' || p_q || '%' or b.trade_name ilike '%' || p_q || '%' or p.about ilike '%' || p_q || '%'
          or array_to_string(p.categories, ' ') ilike '%' || p_q || '%' or p.city ilike '%' || p_q || '%'
          or exists (select 1 from item i where i.business_id = b.id and i.network_listed and i.archived_at is null and i.name ilike '%' || p_q || '%'))
   order by coalesce(b.trade_name, b.legal_name) limit least(greatest(p_limit, 1), 100)
$$;

create or replace function network_catalogue(p_business uuid) returns table (name text, kind text, hsn_sac text, unit text, price_paise bigint, price_includes_tax boolean, default_rate_bp int)
language sql stable security definer set search_path = public as $$
  select i.name, i.kind, i.hsn_sac, i.unit, i.price_paise, i.price_includes_tax, i.default_rate_bp
    from item i join network_profile p on p.business_id = i.business_id and p.listed
   where i.business_id = p_business and i.network_listed and i.archived_at is null and is_authorized() order by i.name limit 300
$$;

-- A listed business by its id, so a buyer can send it an order.
create or replace function network_seller(p_business uuid) returns table (business_id uuid, name text, gstin text, state_code char(2))
language sql stable security definer set search_path = public as $$
  select b.id, coalesce(b.trade_name, b.legal_name), b.gstin, b.state_code
    from business b join network_profile p on p.business_id = b.id and p.listed
   where b.id = p_business and b.gstin is not null and b.id <> current_business() and is_authorized()
$$;

revoke all on function network_deliver(uuid), network_delivery_status(uuid), network_directory(text, int), network_catalogue(uuid), network_seller(uuid) from public;
grant execute on function network_delivery_status(uuid), network_directory(text, int), network_catalogue(uuid), network_seller(uuid) to kora_app;

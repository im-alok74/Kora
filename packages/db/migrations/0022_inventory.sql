-- Shops: prices that include GST (an MRP), stock that follows sales and purchases, and barcodes.

-- ---------------------------------------------------------------- prices that include tax
alter table item add column price_includes_tax boolean not null default false;
alter table document_line add column price_includes_tax boolean not null default false;   -- rate_paise is then the price with tax inside it

-- ---------------------------------------------------------------- stock
alter table item add column track_stock boolean not null default false;
alter table item add column barcode text check (barcode is null or length(barcode) between 1 and 60);
alter table item add column reorder_level_milli bigint check (reorder_level_milli is null or reorder_level_milli >= 0);
create unique index item_barcode_unique on item (business_id, barcode) where barcode is not null;
alter table purchase_line add column item_id uuid;
alter table purchase_line add constraint purchase_line_item_fk foreign key (business_id, item_id) references item (business_id, id);

-- Every change in stock is a row. The level is their sum, so the history can always explain the number.
create table stock_movement (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  item_id uuid not null,
  qty_milli bigint not null check (qty_milli <> 0),             -- plus in, minus out, in thousandths of a unit
  kind text not null check (kind in ('opening', 'purchase', 'purchase_cancelled', 'sale', 'sale_cancelled', 'adjustment')),
  document_id uuid,
  bill_id uuid references purchase_bill(id) on delete set null,
  note text check (note is null or length(note) <= 300),
  occurred_on date not null default current_date,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  foreign key (business_id, item_id) references item (business_id, id),
  foreign key (business_id, document_id) references document (business_id, id) on delete set null (document_id)
);
create index on stock_movement (item_id, created_at desc);
create index on stock_movement (business_id, created_at desc);

create view item_stock as
  select i.id as item_id, i.business_id, coalesce(sum(m.qty_milli), 0)::bigint as qty_milli
    from item i left join stock_movement m on m.item_id = i.id
   where i.track_stock group by i.id, i.business_id;
alter view item_stock set (security_invoker = true);
grant select on item_stock to kora_app;

-- A sale takes stock out when the invoice is issued, and puts it back if the invoice is cancelled.
-- Credit notes do not move stock: a credit note may be for a price change as well as for returned goods, so a return is a stock adjustment.
create or replace function stock_on_document() returns trigger language plpgsql as $$
begin
  if new.doc_type not in ('tax_invoice', 'bill_of_supply') then return new; end if;
  if old.status = 'draft' and new.status = 'issued' then
    insert into stock_movement (business_id, item_id, qty_milli, kind, document_id, occurred_on)
      select l.business_id, l.item_id, -round(l.quantity * 1000)::bigint, 'sale', new.id, new.doc_date
        from document_line l join item i on i.id = l.item_id where l.document_id = new.id and i.track_stock and l.quantity > 0;
  elsif old.status = 'issued' and new.status = 'cancelled' then
    insert into stock_movement (business_id, item_id, qty_milli, kind, document_id, occurred_on)
      select l.business_id, l.item_id, round(l.quantity * 1000)::bigint, 'sale_cancelled', new.id, current_date
        from document_line l join item i on i.id = l.item_id where l.document_id = new.id and i.track_stock and l.quantity > 0;
  end if;
  return new;
end $$;
create trigger document_stock after update of status on document for each row when (old.status is distinct from new.status) execute function stock_on_document();

-- A purchase bill brings stock in as it is recorded, and takes it out again if the bill is cancelled.
create or replace function stock_on_purchase_line() returns trigger language plpgsql as $$
begin
  if new.item_id is null then return new; end if;
  insert into stock_movement (business_id, item_id, qty_milli, kind, bill_id, occurred_on)
    select new.business_id, new.item_id, new.quantity_milli, 'purchase', new.bill_id, b.bill_date
      from purchase_bill b join item i on i.id = new.item_id where b.id = new.bill_id and i.track_stock;
  return new;
end $$;
create trigger purchase_line_stock after insert on purchase_line for each row execute function stock_on_purchase_line();

create or replace function stock_on_purchase_bill() returns trigger language plpgsql as $$
begin
  if old.status = 'recorded' and new.status = 'cancelled' then
    insert into stock_movement (business_id, item_id, qty_milli, kind, bill_id, occurred_on)
      select l.business_id, l.item_id, -l.quantity_milli, 'purchase_cancelled', new.id, current_date
        from purchase_line l join item i on i.id = l.item_id where l.bill_id = new.id and i.track_stock;
  end if;
  return new;
end $$;
create trigger purchase_bill_stock after update of status on purchase_bill for each row when (old.status is distinct from new.status) execute function stock_on_purchase_bill();

alter table stock_movement enable row level security;
alter table stock_movement force row level security;
create policy tenant_isolation on stock_movement for all to kora_app
  using (business_id = current_business() and (select is_authorized()))
  with check (business_id = current_business() and (select is_authorized()));
create trigger audit_stock_movement after insert or update or delete on stock_movement for each row execute function audit_row();
-- A movement is never edited or removed: a mistake is corrected by another movement.
grant select, insert on stock_movement to kora_app;

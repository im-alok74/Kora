-- Phase 2: money held for a customer (an advance, or an overpayment) can be applied to a later invoice, or refunded.
-- A refund only ever returns money that has not been applied to an invoice, so a payment's allocations plus its refunds can
-- never be more than the payment. The existing allocation guard is extended to count refunds, and the refund table has its own guard.

create table payment_refund (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  payment_id uuid not null,
  amount_paise bigint not null check (amount_paise > 0),
  method text not null check (method in ('cash', 'upi', 'card', 'netbanking', 'bank_transfer', 'cheque', 'other')),
  refunded_on date not null,
  note text check (note is null or length(note) <= 300),
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  foreign key (business_id, payment_id) references payment (business_id, id)
);
create index payment_refund_payment on payment_refund (payment_id);

create or replace function refund_guard() returns trigger language plpgsql as $$
declare src bigint; used bigint; back bigint;
begin
  select amount_paise into src from payment where id = new.payment_id for update;
  select coalesce(sum(amount_paise), 0) into used from payment_allocation where payment_id = new.payment_id;
  select coalesce(sum(amount_paise), 0) into back from payment_refund where payment_id = new.payment_id;
  if used + back > src then raise exception 'a refund cannot be more than the money not yet applied to an invoice' using errcode = 'check_violation'; end if;
  return null;
end $$;
create constraint trigger refund_guard after insert or update on payment_refund
  deferrable initially immediate for each row execute function refund_guard();

-- Allocations may not use money that has been refunded.
create or replace function allocation_guard() returns trigger language plpgsql as $$
declare
  did uuid := coalesce(new.document_id, old.document_id);
  pid uuid := coalesce(new.payment_id, old.payment_id);
  cid uuid := coalesce(new.credit_note_id, old.credit_note_id);
  doc record; src bigint; used bigint; settled bigint; back bigint := 0;
begin
  select * into doc from document where id = did for update;                  -- serialise per document
  if doc.status <> 'issued' or doc.doc_type not in ('tax_invoice','bill_of_supply','debit_note') then
    raise exception 'only issued invoices can be settled' using errcode = 'check_violation';
  end if;
  if pid is not null then
    select amount_paise into src from payment where id = pid for update;
    select coalesce(sum(amount_paise),0) into used from payment_allocation where payment_id = pid;
    select coalesce(sum(amount_paise),0) into back from payment_refund where payment_id = pid;
    if used + back > src then raise exception 'allocations exceed the payment' using errcode = 'check_violation'; end if;
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

alter table payment_refund enable row level security;
alter table payment_refund force row level security;
create policy tenant_isolation on payment_refund for all to kora_app
  using (business_id = current_business() and (select is_authorized()))
  with check (business_id = current_business() and (select is_authorized()));
create trigger audit_payment_refund after insert or update or delete on payment_refund for each row execute function audit_row();
grant select, insert, update, delete on payment_refund to kora_app;

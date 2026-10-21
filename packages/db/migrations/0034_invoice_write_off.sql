-- Phase 7, G4 and G5: the customer who will never pay, and the issued document that was cancelled by mistake.
--
-- A bad debt is not a credit note. When the money will never come, the business must stop showing it as receivable,
-- but the supply did happen and the output tax on it was already declared in GSTR-1 and paid through GSTR-3B.
-- Section 34 lets a credit note reverse that tax only for a supply that was cancelled, found deficient or repriced;
-- a customer simply refusing to pay is none of those, and GST has no bad-debt relief. So a write-off is recorded
-- beside the document and never on it: no taxable value, no tax column, no total, nothing the returns read. The
-- invoice stays exactly as it was filed and only what is owed changes. That is also why this is its own table rather
-- than a column on document: an issued document is immutable by design, and it should stay that way.
--
-- Kora already has what Zoho calls "void". `cancelled` keeps the number, reports it in the GSTR-1 doc_issue summary
-- as a cancelled number, declares no supply, and is refused once a payment or a registered e-invoice exists. A second
-- 'void' status would say the same thing twice and would have to be taught to every query that reads
-- status in ('issued','cancelled') -- gstr1, gstSummary, the sales register, the public page -- and any one that was
-- missed would quietly drop a voided number out of the numbering summary, which is a defective return. So there is no
-- new status here. What was genuinely missing is the way back: a document cancelled in error had to be keyed in
-- again under a new number, and the reason was lost. Re-opening is now allowed, with its own reason kept beside the
-- cancellation reason, except where the e-invoice was cancelled on the portal: that IRN is dead for good, and a
-- fresh invoice is the only honest answer.

create table document_write_off (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  document_id uuid not null,
  -- What was still owed on the day it was written off. Frozen here, so later movements cannot rewrite history.
  amount_paise bigint not null check (amount_paise > 0),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  written_off_on date not null default current_date,
  -- Reversed, not deleted: the money turned up after all, or the write-off was a mistake.
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(btrim(cancel_reason)) between 1 and 500),
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (cancelled_at is not null or cancel_reason is null),
  foreign key (business_id, document_id) references document (business_id, id)
);
create index document_write_off_document on document_write_off (document_id, written_off_on desc);
-- An invoice is either written off or it is not. A reversed write-off does not hold the spot.
create unique index document_write_off_one_live on document_write_off (document_id) where cancelled_at is null;
create trigger document_write_off_touch before update on document_write_off for each row execute function touch_updated_at();
create trigger audit_document_write_off after insert or update or delete on document_write_off for each row execute function audit_row();

alter table document_write_off enable row level security;
alter table document_write_off force row level security;
create policy tenant_isolation on document_write_off for all to kora_app
  using (business_id = current_business() and (select is_authorized()))
  with check (business_id = current_business() and (select is_authorized()));
grant select, insert, update, delete on document_write_off to kora_app;

-- G5: re-opening a cancelled document, and the reason it was re-opened.
alter table document
  add column reopened_at timestamptz,
  add column reopen_reason text check (reopen_reason is null or length(btrim(reopen_reason)) between 1 and 500);

create or replace function document_guard() returns trigger language plpgsql as $$
declare
  s record; n bigint; sums record; biz record; prt record; live int;
  frozen text[] := array['status','amount_settled_paise','payment_status','einvoice_status','pdf_object_key',
                         'last_sent_at','cancelled_at','cancel_reason','reopened_at','reopen_reason','updated_at'];
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
  elsif old.status = 'cancelled' and new.status = 'issued' then
    -- An e-invoice cancelled on the portal cannot be undone there, so the document it belongs to cannot come back.
    if exists (select 1 from einvoice where document_id = old.id and status = 'cancelled') then
      raise exception 'the e-invoice was cancelled on the GST portal and cannot be revived; issue a fresh invoice'
        using errcode = 'check_violation';
    end if;
    new.cancelled_at := null;
    new.reopened_at := now();
  elsif old.status <> new.status then
    raise exception 'illegal status change % -> %', old.status, new.status using errcode = 'integrity_constraint_violation';
  end if;

  if old.status = 'cancelled' and new.status = 'cancelled'
     and (to_jsonb(new) - frozen) is distinct from (to_jsonb(old) - frozen) then
    raise exception 'cancelled documents are frozen' using errcode = 'integrity_constraint_violation';
  end if;
  -- Before an IRN exists, the buyer's details may be corrected so a rejected e-invoice can be resubmitted.
  -- The state cannot change, because that would change the tax split.
  if old.einvoice_status in ('pending', 'registering', 'rejected') and new.recipient_snapshot is distinct from old.recipient_snapshot then
    if coalesce(new.recipient_snapshot->>'state_code', '') <> coalesce(old.recipient_snapshot->>'state_code', '') then
      raise exception 'the buyer state cannot change after issue; cancel and issue a new invoice' using errcode = 'integrity_constraint_violation';
    end if;
    frozen := frozen || array['recipient_snapshot'];
  end if;
  if (to_jsonb(new) - frozen) is distinct from (to_jsonb(old) - frozen) then
    raise exception 'issued documents are immutable; issue a credit or debit note' using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$;

-- A written-off invoice is no longer receivable: it drops out of the ageing report, the dashboard and the overdue
-- lists, all of which read this view. Its taxable value and its tax are untouched, so the returns do not move.
create or replace view receivable as
  select d.id, d.business_id, d.party_id, d.doc_type, d.number, d.doc_date,
         coalesce(d.due_date, d.doc_date) as due_date,
         d.grand_total_paise, d.amount_settled_paise,
         (d.grand_total_paise - d.amount_settled_paise) as outstanding_paise
    from document d
   where d.status = 'issued' and d.doc_type in ('tax_invoice', 'bill_of_supply', 'debit_note')
     and d.grand_total_paise > d.amount_settled_paise
     and not exists (select 1 from document_write_off w where w.document_id = d.id and w.cancelled_at is null);
alter view receivable set (security_invoker = true);
grant select on receivable to kora_app;

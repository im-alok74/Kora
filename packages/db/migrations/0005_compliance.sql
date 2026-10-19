-- E-invoicing: buyer correction before an IRN exists, and the e-invoice on the public page.

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

-- The public page also needs the registered IRN and QR, so it can print them.
create or replace function public_document(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l share_link; d document; r jsonb; t jsonb; e jsonb;
begin
  select * into l from share_link where token_hash = digest(p_token, 'sha256')
    and revoked_at is null and (expires_at is null or expires_at > now());
  if not found then return null; end if;
  update share_link set view_count = view_count + 1, last_viewed_at = now(),
         first_viewed_at = coalesce(first_viewed_at, now()) where id = l.id;
  select * into d from document where id = l.document_id and status <> 'draft';
  if not found then return null; end if;
  select config into t from document_template where business_id = d.business_id and is_default;
  select jsonb_build_object('irn', irn, 'ack_no', ack_no, 'ack_date', ack_date, 'signed_qr', signed_qr)
    into e from einvoice where document_id = d.id and status = 'registered';
  select (to_jsonb(d) - 'created_by' - 'pdf_object_key') || jsonb_build_object(
      'template', coalesce(t, '{}'::jsonb), 'einvoice', e,
      'lines', (select coalesce(jsonb_agg(to_jsonb(x) - 'business_id' order by x.position), '[]'::jsonb)
                  from document_line x where x.document_id = d.id))
    into r;
  return r;
end $$;

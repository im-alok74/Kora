-- Night 1, step 1: a fuller quote flow and the sales order type.
--   * sales_order becomes a document type with its own number series (the two type checks are widened, nothing else changes)
--   * a customer's answer to a quote can carry a comment and the name they gave
--   * a revised quote points at the one it replaces and counts its version
--   * a document made from another one remembers where it came from, so conversions can be chained

alter table number_series drop constraint number_series_doc_type_check;
alter table number_series add constraint number_series_doc_type_check check (doc_type in
  ('tax_invoice','bill_of_supply','estimate','proforma','delivery_challan','credit_note','debit_note','sales_order'));

alter table document drop constraint document_doc_type_check;
alter table document add constraint document_doc_type_check check (doc_type in
  ('tax_invoice','bill_of_supply','estimate','proforma','delivery_challan','credit_note','debit_note','sales_order'));

-- A sales order may be quoted in a foreign currency, like an estimate or a proforma.
alter table document drop constraint document_currency_scope;
alter table document add constraint document_currency_scope check (currency = 'INR' or doc_type in ('estimate', 'proforma', 'sales_order'));

alter table estimate_state
  add column decision_comment text check (decision_comment is null or length(btrim(decision_comment)) between 1 and 500),
  add column decided_by_name text check (decided_by_name is null or length(btrim(decided_by_name)) between 1 and 120),
  add column expiry_notified_at timestamptz;

alter table document
  add column version int not null default 1 check (version between 1 and 99),
  add column previous_version_id uuid,
  add column source_document_id uuid;
alter table document add constraint document_previous_version_fk foreign key (business_id, previous_version_id) references document (business_id, id) on delete set null (previous_version_id);
alter table document add constraint document_source_fk foreign key (business_id, source_document_id) references document (business_id, id) on delete set null (source_document_id);
create index document_source_idx on document (source_document_id) where source_document_id is not null;
create index document_previous_version_idx on document (previous_version_id) where previous_version_id is not null;

-- The public quote page finds its document from a share link without counting a view.
create or replace function share_resolve(p_token text)
returns table (business_id uuid, document_id uuid)
language sql stable security definer set search_path = public as $$
  select l.business_id, l.document_id from share_link l
   where l.token_hash = digest(p_token, 'sha256') and l.revoked_at is null and (l.expires_at is null or l.expires_at > now())
$$;
revoke all on function share_resolve(text) from public;
grant execute on function share_resolve(text) to kora_app;

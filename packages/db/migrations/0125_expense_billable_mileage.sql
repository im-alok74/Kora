-- Night 2, task 8: expenses you pass on to a customer, and mileage.
--   * bill_to_party_id: the customer the cost is to be re-billed to. Null means not billable.
--   * billed_document_id: the draft invoice that carries it. If that draft is deleted the link clears and the expense is billable again.
--   * distance_tenth_km and rate_per_km_paise: a mileage claim. The amount is worked out from them when saved.
-- Additive only.
alter table expense
  add column bill_to_party_id uuid,
  add column billed_document_id uuid,
  add column distance_tenth_km int check (distance_tenth_km is null or distance_tenth_km > 0),
  add column rate_per_km_paise int check (rate_per_km_paise is null or rate_per_km_paise > 0),
  add constraint expense_bill_party_fk foreign key (business_id, bill_to_party_id) references party (business_id, id),
  add constraint expense_billed_doc_fk foreign key (business_id, billed_document_id) references document (business_id, id) on delete set null (billed_document_id),
  add constraint expense_billed_needs_party check (billed_document_id is null or bill_to_party_id is not null),
  add constraint expense_mileage_pair check ((distance_tenth_km is null) = (rate_per_km_paise is null));
create index on expense (business_id, bill_to_party_id) where bill_to_party_id is not null and billed_document_id is null;

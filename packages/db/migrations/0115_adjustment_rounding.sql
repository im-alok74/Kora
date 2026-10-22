-- Night 1, step 6: a manual adjustment line (a small plus or minus that is not taxed) and a per-document choice about rounding.
-- The one total check on a document is replaced by the same check with the adjustment added. Nothing else about it changes.
alter table document
  add column adjustment_paise bigint not null default 0 check (abs(adjustment_paise) <= 1000000),
  add column adjustment_label text check (adjustment_label is null or length(btrim(adjustment_label)) between 1 and 40),
  add column round_total boolean not null default true;

alter table document drop constraint document_check;
alter table document add constraint document_totals_check check (grand_total_paise = taxable_paise
  + case when reverse_charge then 0 else cgst_paise + sgst_paise + igst_paise + cess_paise end
  + tcs_paise + adjustment_paise + round_off_paise);

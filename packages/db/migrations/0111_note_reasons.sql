-- Night 1, step 2: a credit or debit note says why it was raised. The reason is printed on the note.
alter table document
  add column note_reason text check (note_reason is null or note_reason in
    ('goods_returned', 'post_sale_discount', 'price_correction', 'quantity_correction', 'service_deficiency', 'tax_rate_correction', 'additional_charge', 'other')),
  add column note_reason_detail text check (note_reason_detail is null or length(btrim(note_reason_detail)) between 1 and 300);

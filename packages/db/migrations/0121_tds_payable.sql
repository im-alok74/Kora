-- Night 2: TDS payable. When you pay a vendor you may hold back tax at source and deposit it with the government yourself.
-- The payment row keeps the cash that left the bank (amount_paise) and, beside it, the tax held back (tds_paise) with its section.
-- The bill is settled by the two together. Additive only.
alter table purchase_payment
  add column tds_paise bigint not null default 0 check (tds_paise >= 0),
  add column tds_section text check (tds_section is null or tds_section ~ '^[0-9]{3}[A-Z]{0,2}$'),
  add constraint purchase_payment_tds_needs_section check (tds_paise = 0 or tds_section is not null);
create index on purchase_payment (business_id, paid_on) where tds_paise > 0;

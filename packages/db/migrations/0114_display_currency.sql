-- Night 1, step 5: a rupee document can also show its total in another currency, as a reference for a foreign customer.
-- The tax and the legal amounts stay in rupees. The reference total is worked out when the document is printed, from this rate.
alter table document
  add column display_currency char(3) check (display_currency is null or (display_currency <> 'INR' and display_currency ~ '^[A-Z]{3}$')),
  add column display_rate_micro bigint check (display_rate_micro is null or display_rate_micro > 0);
alter table document add constraint document_display_pair check ((display_currency is null) = (display_rate_micro is null));

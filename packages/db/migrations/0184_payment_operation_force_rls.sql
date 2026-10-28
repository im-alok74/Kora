-- Audit finding V-3: 0181 enabled row level security on payment_operation but did not force it, and the guard test requires every
-- table with a business_id to have it forced like the rest. Safe to run twice.
alter table payment_operation force row level security;

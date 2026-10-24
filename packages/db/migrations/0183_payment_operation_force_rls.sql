-- Match the tenant-table contract even when a non-BYPASSRLS table owner connects.
alter table payment_operation force row level security;

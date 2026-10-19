-- Files can live in object storage (S3, Cloudflare R2, Backblaze B2) instead of inside the database. A row holds either the bytes
-- (the default, and what already exists) or the key of an object. Old rows keep working; a switch needs no data move.

alter table expense_receipt alter column data drop not null;
alter table expense_receipt drop constraint expense_receipt_data_check;
alter table expense_receipt add column storage_key text;
alter table expense_receipt add constraint expense_receipt_has_content
  check ((data is not null and storage_key is null and octet_length(data) between 1 and 2097152) or (data is null and storage_key is not null and length(storage_key) between 1 and 300));

alter table inbox_file alter column data drop not null;
alter table inbox_file drop constraint inbox_file_data_check;
alter table inbox_file add column storage_key text;
alter table inbox_file add constraint inbox_file_has_content
  check ((data is not null and storage_key is null and octet_length(data) between 1 and 2097152) or (data is null and storage_key is not null and length(storage_key) between 1 and 300));

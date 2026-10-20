-- Phase 1.5: supporting files on a document (a purchase order, a signed quote, a delivery proof), kept by the team.
-- They are not part of the sealed document, so they can be added or removed after it is issued; the audit log records each change.
-- A file is either the bytes (the default) or the key of an object in S3-compatible storage, as for receipts.
create table document_file (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  document_id uuid not null references document(id) on delete cascade,
  file_name text not null check (length(file_name) between 1 and 120),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes int not null check (size_bytes between 1 and 2097152),
  data bytea,
  storage_key text,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  constraint document_file_has_content check ((data is not null and storage_key is null) or (data is null and storage_key is not null and length(storage_key) between 1 and 300))
);
create index document_file_document on document_file (document_id, created_at);

alter table document_file enable row level security;
alter table document_file force row level security;
create policy tenant_isolation on document_file for all to kora_app
  using (business_id = current_business() and (select is_authorized()))
  with check (business_id = current_business() and (select is_authorized()));
create trigger audit_document_file after insert or update or delete on document_file for each row execute function audit_row();
grant select, insert, update, delete on document_file to kora_app;

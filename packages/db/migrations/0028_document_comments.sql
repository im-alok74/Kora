-- Phase 3.5: notes between team members on a document ("customer promised payment on Friday", "check the PO"). Never shown to customers.
create table document_comment (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  document_id uuid not null references document(id) on delete cascade,
  user_id uuid not null references app_user(id),
  body text not null check (length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index document_comment_document on document_comment (document_id, created_at);

alter table document_comment enable row level security;
alter table document_comment force row level security;
create policy tenant_isolation on document_comment for all to kora_app
  using (business_id = current_business() and (select is_authorized()))
  with check (business_id = current_business() and (select is_authorized()));
create trigger audit_document_comment after insert or update or delete on document_comment for each row execute function audit_row();
grant select, insert, delete on document_comment to kora_app;

-- What the firm records when a return has been filed: the reference, the date the filer states, and the acknowledgement file.
-- This is the firm's own record. Kora does not talk to the GST portal here, so nothing in this table means "verified with the portal".
-- Append-only: a correction is a new row. Isolated on app.firm_id. Safe to run twice.

create table if not exists filing_evidence (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firm(id) on delete cascade,
  engagement_id uuid not null references engagement(id) on delete cascade,
  reference text not null check (length(btrim(reference)) between 1 and 60),
  filed_on date not null,
  file_name text not null check (length(file_name) between 1 and 120),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 2097152),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  data bytea,
  storage_key text,
  marked_by uuid not null references app_user(id),
  created_at timestamptz not null default now(),
  check (data is not null or storage_key is not null)
);
create index if not exists filing_evidence_engagement on filing_evidence (engagement_id, created_at desc);

alter table filing_evidence enable row level security;
alter table filing_evidence force row level security;
drop policy if exists firm_tenant on filing_evidence;
create policy firm_tenant on filing_evidence for all to kora_app
  using (firm_id = current_firm()) with check (firm_id = current_firm());
grant select, insert on filing_evidence to kora_app;   -- no update, no delete

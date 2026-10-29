-- A reminder to a client about an item they have not sent. One row per item per reminder number, so planning twice never doubles up.
-- status says what really happened: queued (decided, not yet handed to a sender), sent, failed, or cancelled (the item was dealt with first).
-- Nothing here sends a message by itself; a sender marks each row sent or failed. Safe to run twice.

create table if not exists request_reminder (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firm(id) on delete cascade,
  request_id uuid not null references document_request(id) on delete cascade,
  seq int not null check (seq between 1 and 10),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'cancelled')),
  error text check (error is null or length(error) <= 300),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (request_id, seq),
  check ((status in ('sent', 'failed', 'cancelled')) = (settled_at is not null))
);
create index if not exists request_reminder_open on request_reminder (firm_id, status) where status = 'queued';

alter table request_reminder enable row level security;
alter table request_reminder force row level security;
drop policy if exists firm_tenant on request_reminder;
create policy firm_tenant on request_reminder for all to kora_app
  using (firm_id = current_firm()) with check (firm_id = current_firm());
grant select, insert, update on request_reminder to kora_app;

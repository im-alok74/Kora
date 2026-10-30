-- The firm's own fee for a piece of work, and a log of what happened to the work, for the pilot measurements.
--   fee_item     one per engagement: the agreed amount, and whether it has been billed and paid. Work that is done with no fee recorded, or an unbilled one,
--                counts as "completed but unbilled". This is the firm's own record; it is not an invoice (invoices are made in the firm's own Kora business).
--   firm_event   an append-only log (request created, file received, reminder queued, review submitted, approved, returned, closed, reopened).
--                It holds counts and times for the firm's measurements, never file contents and never a per-person productivity score.
-- Isolated on app.firm_id. Safe to run twice.

create table if not exists fee_item (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firm(id) on delete cascade,
  engagement_id uuid not null unique references engagement(id) on delete cascade,
  client_id uuid not null references client_entity(id) on delete cascade,
  amount_paise bigint not null check (amount_paise >= 0 and amount_paise <= 100000000000),
  description text not null default '' check (length(description) <= 200),
  status text not null default 'unbilled' check (status in ('unbilled', 'billed', 'paid', 'waived')),
  reference text check (reference is null or length(reference) between 1 and 60),
  billed_on date,
  paid_on date,
  waived_reason text check (waived_reason is null or length(waived_reason) between 1 and 300),
  created_by uuid not null references app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status in ('billed', 'paid')) = (billed_on is not null)),
  check ((status = 'paid') = (paid_on is not null)),
  check ((status = 'waived') = (waived_reason is not null))
);

create table if not exists firm_event (
  id bigint generated always as identity primary key,
  firm_id uuid not null references firm(id) on delete cascade,
  engagement_id uuid references engagement(id) on delete cascade,
  request_id uuid references document_request(id) on delete cascade,
  kind text not null check (kind in ('request_created', 'file_received', 'reminder_queued', 'request_accepted', 'request_returned', 'request_waived', 'request_reopened',
                                       'review_submitted', 'review_approved', 'review_returned', 'engagement_closed', 'engagement_reopened', 'link_created')),
  via text check (via is null or via in ('link', 'staff', 'system')),
  at timestamptz not null default now()
);
create index if not exists firm_event_kind on firm_event (firm_id, kind, at desc);
create index if not exists firm_event_engagement on firm_event (engagement_id, kind);

do $$ declare t text; begin
  foreach t in array array['fee_item', 'firm_event'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists firm_tenant on %I', t);
    execute format('create policy firm_tenant on %I for all to kora_app
                      using (firm_id = current_firm()) with check (firm_id = current_firm())', t);
  end loop;
end $$;
grant select, insert, update on fee_item to kora_app;
grant select, insert on firm_event to kora_app;   -- no update, no delete

-- The client link now also logs that a file arrived (0211 plus the event).
create or replace function upload_link_add_version(p_hash text, p_request uuid, p_id uuid, p_name text, p_type text, p_size int, p_sha text, p_data bytea, p_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare l upload_link; r document_request; n_item int; n_all int; bytes_all bigint;
begin
  select * into l from upload_link where token_hash = p_hash and revoked_at is null and expires_at > now();
  if not found then raise exception 'this link is not valid or has expired' using errcode = 'check_violation'; end if;
  select * into r from document_request where id = p_request and engagement_id = l.engagement_id for update;
  if not found then raise exception 'that item is not part of this request' using errcode = 'check_violation'; end if;
  if r.status in ('accepted', 'waived') then raise exception 'that item is already closed' using errcode = 'check_violation'; end if;
  select count(*) into n_item from document_version where request_id = r.id and uploaded_via = 'link';
  select count(*), coalesce(sum(v.size_bytes), 0) into n_all, bytes_all
    from document_version v join document_request q on q.id = v.request_id where q.engagement_id = l.engagement_id and v.uploaded_via = 'link';
  if n_item >= 10 or n_all >= 40 or bytes_all + p_size > 52428800 then
    raise exception 'upload limit reached for this request' using errcode = 'check_violation';
  end if;
  insert into document_version (id, firm_id, request_id, file_name, content_type, size_bytes, sha256, data, storage_key, uploaded_via)
  values (p_id, l.firm_id, r.id, p_name, p_type, p_size, p_sha, p_data, p_key, 'link');
  update document_request set status = 'received', reason = null, updated_at = now() where id = r.id;
  insert into firm_event (firm_id, engagement_id, request_id, kind, via) values (l.firm_id, l.engagement_id, r.id, 'file_received', 'link');
  return p_id;
end $$;

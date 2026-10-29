-- What the firm needs from the client for one piece of work, and the files that come back.
--   document_request   one item on the checklist (bank statement, sales register...), with a status
--   upload_link        a secret link the client opens to send files, no sign-in; only its hash is stored; expires; can be revoked
--   document_version   every file ever sent for an item; append-only, so a re-upload never overwrites the earlier one
-- Firm side is isolated on app.firm_id. The client side goes only through the two functions at the bottom, which check the link.
-- Safe to run twice.

create table if not exists document_request (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firm(id) on delete cascade,
  engagement_id uuid not null references engagement(id) on delete cascade,
  client_id uuid not null references client_entity(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 200),
  status text not null default 'requested' check (status in ('requested', 'received', 'needs_correction', 'accepted', 'waived')),
  reason text check (reason is null or length(reason) between 1 and 500),
  due_date date,
  created_by uuid not null references app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status in ('needs_correction', 'waived')) = (reason is not null))
);
create index if not exists document_request_engagement on document_request (engagement_id);
create unique index if not exists document_request_label on document_request (engagement_id, lower(label));

create table if not exists upload_link (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firm(id) on delete cascade,
  engagement_id uuid not null references engagement(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null references app_user(id),
  created_at timestamptz not null default now()
);
create index if not exists upload_link_engagement on upload_link (engagement_id);

create table if not exists document_version (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firm(id) on delete cascade,
  request_id uuid not null references document_request(id) on delete cascade,
  file_name text not null check (length(file_name) between 1 and 120),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 2097152),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  data bytea,
  storage_key text,
  uploaded_by uuid references app_user(id),
  uploaded_via text not null check (uploaded_via in ('link', 'staff')),
  created_at timestamptz not null default now(),
  check (data is not null or storage_key is not null)
);
create index if not exists document_version_request on document_version (request_id, created_at desc);

do $$ declare t text; begin
  foreach t in array array['document_request', 'upload_link', 'document_version'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists firm_tenant on %I', t);
    execute format('create policy firm_tenant on %I for all to kora_app
                      using (firm_id = current_firm()) with check (firm_id = current_firm())', t);
  end loop;
end $$;
grant select, insert, update on document_request to kora_app;
grant select, insert, update on upload_link to kora_app;
grant select, insert on document_version to kora_app;   -- no update, no delete

-- What the client sees when they open their link: the work and the open items. Nothing else about the firm or its other clients.
create or replace function upload_link_context(p_hash text)
returns table (firm_id uuid, engagement_id uuid, firm_name text, client_name text, service text, period text, request_id uuid, label text, status text, reason text, due_date date)
language sql stable security definer set search_path = public as $$
  select e.firm_id, e.id, f.name, c.legal_name, e.service, e.period, r.id, r.label, r.status, r.reason, r.due_date
    from upload_link l
    join engagement e on e.id = l.engagement_id join firm f on f.id = e.firm_id join client_entity c on c.id = e.client_id
    left join document_request r on r.engagement_id = e.id
   where l.token_hash = p_hash and l.revoked_at is null and l.expires_at > now()
   order by r.created_at
$$;

-- A client sends one file for one item. Refused unless the link is live and the item belongs to the link's work and is still open.
create or replace function upload_link_add_version(p_hash text, p_request uuid, p_id uuid, p_name text, p_type text, p_size int, p_sha text, p_data bytea, p_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare l upload_link; r document_request;
begin
  select * into l from upload_link where token_hash = p_hash and revoked_at is null and expires_at > now();
  if not found then raise exception 'this link is not valid or has expired' using errcode = 'check_violation'; end if;
  select * into r from document_request where id = p_request and engagement_id = l.engagement_id for update;
  if not found then raise exception 'that item is not part of this request' using errcode = 'check_violation'; end if;
  if r.status in ('accepted', 'waived') then raise exception 'that item is already closed' using errcode = 'check_violation'; end if;
  insert into document_version (id, firm_id, request_id, file_name, content_type, size_bytes, sha256, data, storage_key, uploaded_via)
  values (p_id, l.firm_id, r.id, p_name, p_type, p_size, p_sha, p_data, p_key, 'link');
  update document_request set status = 'received', reason = null, updated_at = now() where id = r.id;
  return p_id;
end $$;

revoke all on function upload_link_context(text), upload_link_add_version(text, uuid, uuid, text, text, int, text, bytea, text) from public;
grant execute on function upload_link_context(text), upload_link_add_version(text, uuid, uuid, text, text, int, text, bytea, text) to kora_app;

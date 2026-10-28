-- Digital Personal Data Protection Act, 2023: what Kora needs to show it can do, kept in the database so it cannot be skipped.
--   consent_event     every consent given or withdrawn, per person and purpose, never edited (the history is the proof)
--   privacy_request   a person's request to see, correct or erase their data, to complain, or to name a nominee, with a due date
--   data_breach       the platform's own register of personal data breaches and when the Board and the people were told
-- consent_event and privacy_request belong to one person, so row level security is on the signed in user (app.user_id).
-- data_breach is read and written only through the admin functions (a later migration), so the application role has no grant on it.
-- Safe to run twice.

create table if not exists consent_event (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id),
  purpose text not null check (purpose in ('terms_privacy', 'product_updates', 'messaging_notifications')),
  action text not null check (action in ('given', 'withdrawn')),
  notice_version text not null check (length(notice_version) between 1 and 20),
  source text not null check (length(source) between 1 and 40),
  created_at timestamptz not null default now()
);
create index if not exists consent_event_user on consent_event (user_id, purpose, created_at desc);
alter table consent_event enable row level security;
alter table consent_event force row level security;
drop policy if exists consent_event_own on consent_event;
create policy consent_event_own on consent_event using (user_id = current_actor()) with check (user_id = current_actor());
grant select, insert on consent_event to kora_app;

create table if not exists privacy_request (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id),
  kind text not null check (kind in ('access', 'correction', 'erasure', 'grievance', 'nomination')),
  details text not null default '' check (length(details) <= 4000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'rejected')),
  due_at timestamptz not null default now() + interval '30 days',
  resolution text check (resolution is null or length(resolution) <= 4000),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status in ('done', 'rejected')) = (resolved_at is not null))
);
create index if not exists privacy_request_user on privacy_request (user_id, created_at desc);
create index if not exists privacy_request_open on privacy_request (due_at) where status in ('open', 'in_progress');
alter table privacy_request enable row level security;
alter table privacy_request force row level security;
drop policy if exists privacy_request_own on privacy_request;
create policy privacy_request_own on privacy_request using (user_id = current_actor()) with check (user_id = current_actor());
grant select, insert on privacy_request to kora_app;

create table if not exists data_breach (
  id uuid primary key default gen_random_uuid(),
  discovered_at timestamptz not null,
  summary text not null check (length(summary) between 1 and 4000),
  data_affected text not null default '' check (length(data_affected) <= 2000),
  people_affected int check (people_affected is null or people_affected >= 0),
  contained boolean not null default false,
  board_notified_at timestamptz,
  people_notified_at timestamptz,
  notes text not null default '' check (length(notes) <= 4000),
  recorded_by uuid references app_user(id),
  created_at timestamptz not null default now()
);
revoke all on data_breach from public;

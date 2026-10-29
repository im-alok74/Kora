-- The reviewer signs off on a specific version of the work, not on "the work".
--   review_submission  one version of the preparer's package: a frozen snapshot of the checklist and the exact files in it, with a hash of it
--   review_issue       a point the reviewer raises that must be resolved before approval
-- The snapshot and its hash can never be changed after submission (a trigger refuses). Only the decision fields move.
-- If the checklist or its files change after approval, the hash no longer matches and the approval counts for nothing; the application checks this.
-- Isolated on app.firm_id. Safe to run twice.

create table if not exists review_submission (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firm(id) on delete cascade,
  engagement_id uuid not null references engagement(id) on delete cascade,
  version_no int not null check (version_no >= 1),
  package_hash text not null check (package_hash ~ '^[0-9a-f]{64}$'),
  snapshot jsonb not null,
  submitted_by uuid not null references app_user(id),
  submitted_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'returned', 'superseded')),
  decided_by uuid references app_user(id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 1000),
  unique (engagement_id, version_no),
  check ((status in ('approved', 'returned')) = (decided_by is not null and decided_at is not null))
);
create index if not exists review_submission_engagement on review_submission (engagement_id, version_no desc);

create or replace function review_submission_immutable() returns trigger language plpgsql as $$
begin
  if new.snapshot is distinct from old.snapshot or new.package_hash <> old.package_hash or new.engagement_id <> old.engagement_id
     or new.version_no <> old.version_no or new.submitted_by <> old.submitted_by or new.submitted_at <> old.submitted_at or new.firm_id <> old.firm_id then
    raise exception 'a submitted package cannot be changed; submit a new version' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists review_submission_immutable on review_submission;
create trigger review_submission_immutable before update on review_submission for each row execute function review_submission_immutable();

create table if not exists review_issue (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firm(id) on delete cascade,
  submission_id uuid not null references review_submission(id) on delete cascade,
  text text not null check (length(btrim(text)) between 1 and 1000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  raised_by uuid not null references app_user(id),
  created_at timestamptz not null default now(),
  resolved_by uuid references app_user(id),
  resolved_at timestamptz,
  check ((status = 'resolved') = (resolved_by is not null and resolved_at is not null))
);
create index if not exists review_issue_submission on review_issue (submission_id);

do $$ declare t text; begin
  foreach t in array array['review_submission', 'review_issue'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists firm_tenant on %I', t);
    execute format('create policy firm_tenant on %I for all to kora_app
                      using (firm_id = current_firm()) with check (firm_id = current_firm())', t);
  end loop;
end $$;
grant select, insert, update on review_submission, review_issue to kora_app;

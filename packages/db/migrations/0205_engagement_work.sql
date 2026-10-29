-- Who is doing an engagement, who reviews it, and what is holding it up.
-- A blocker is kept apart from status: a piece of work can be "preparing" and still be waiting on one bank statement.
-- Safe to run twice.

alter table engagement
  add column if not exists owner_id uuid references app_user(id),
  add column if not exists reviewer_id uuid references app_user(id),
  add column if not exists blocker_reason text check (blocker_reason is null or length(blocker_reason) between 1 and 500),
  add column if not exists blocker_party text check (blocker_party is null or blocker_party in ('client', 'firm', 'third_party')),
  add column if not exists blocker_next_action text check (blocker_next_action is null or length(blocker_next_action) <= 500),
  add column if not exists blocker_expected date,
  add column if not exists blocker_since timestamptz;

-- The preparer and the reviewer must be two different people, and a blocker is all-or-nothing.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'engagement_owner_not_reviewer') then
    alter table engagement add constraint engagement_owner_not_reviewer check (owner_id is null or reviewer_id is null or owner_id <> reviewer_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'engagement_blocker_whole') then
    alter table engagement add constraint engagement_blocker_whole
      check ((blocker_reason is null) = (blocker_party is null) and (blocker_reason is null) = (blocker_since is null));
  end if;
end $$;

create index if not exists engagement_owner on engagement (firm_id, owner_id) where owner_id is not null;
create index if not exists engagement_reviewer on engagement (firm_id, reviewer_id) where reviewer_id is not null;
create index if not exists engagement_blocked on engagement (firm_id) where blocker_reason is not null;

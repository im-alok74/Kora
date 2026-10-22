-- Night 2: more on a customer or vendor page.
--   * tags: short labels to group parties by ("wholesale", "overdue-watch").
--   * credit_limit_paise: the most the business is happy to be owed by this customer. Null means no limit.
--   * opening_balance_paise and opening_balance_on: what the party owed (positive) or was owed (negative) before Kora was used.
--   * merged_into: a duplicate that was merged keeps its old issued documents (they are immutable) and points at the party that stays.
--   * party_note: a dated log of notes about a party, written by the team.
-- Additive only.
alter table party
  add column tags text[] not null default '{}' check (cardinality(tags) <= 10),
  add column credit_limit_paise bigint check (credit_limit_paise is null or credit_limit_paise >= 0),
  add column opening_balance_paise bigint not null default 0,
  add column opening_balance_on date,
  add column merged_into uuid,
  add constraint party_opening_has_date check (opening_balance_paise = 0 or opening_balance_on is not null),
  add constraint party_merged_into_fk foreign key (business_id, merged_into) references party (business_id, id),
  add constraint party_not_merged_into_self check (merged_into is null or merged_into <> id);
create index on party using gin (tags);
create index on party (merged_into) where merged_into is not null;

create table party_note (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  party_id uuid not null,
  body text not null check (length(body) between 1 and 2000),
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  foreign key (business_id, party_id) references party (business_id, id) on delete cascade
);
create index on party_note (party_id, created_at desc);
alter table party_note enable row level security;
alter table party_note force row level security;
create policy tenant_isolation on party_note for all to kora_app
  using (business_id = current_business() and (select is_authorized()))
  with check (business_id = current_business() and (select is_authorized()));
grant select, insert, update, delete on party_note to kora_app;

-- A party and the duplicates merged into it, for reading a customer's whole account in one place.
create or replace function party_family(p_id uuid) returns setof uuid
language sql stable as $$
  select p_id union select id from party where merged_into = p_id
$$;
grant execute on function party_family(uuid) to kora_app;

-- Night 2, ROADMAP 7.1 to 7.4: the customer portal grows up.
--   * code_login: the owner can require a one-time code (emailed or texted) on top of the private link.
--   * portal_code and portal_session: the codes and the short sessions they open. Only hashes are stored.
--   * portal_comment: a customer's remarks on an estimate, and the business's replies.
--   * payment_link_item: one payment link that settles several invoices at once (bulk pay).
--   * document_file.from_customer: a purchase order the customer attached to an estimate.
-- Additive only: new tables and columns, nothing existing changes.

alter table portal_link add column code_login boolean not null default false;

create table portal_code (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  portal_link_id uuid not null references portal_link(id) on delete cascade,
  channel text not null check (channel in ('sms', 'email')),
  code_hash bytea not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on portal_code (portal_link_id, created_at desc);

create table portal_session (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  portal_link_id uuid not null references portal_link(id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on portal_session (portal_link_id);

create table portal_comment (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  document_id uuid not null,
  author text not null check (author in ('customer', 'business')),
  body text not null check (length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  foreign key (business_id, document_id) references document (business_id, id) on delete cascade
);
create index on portal_comment (document_id, created_at);

create table payment_link_item (
  link_id uuid not null references payment_link(id) on delete cascade,
  business_id uuid not null references business(id) on delete cascade,
  document_id uuid not null,
  amount_paise bigint not null check (amount_paise > 0),
  primary key (link_id, document_id),
  foreign key (business_id, document_id) references document (business_id, id)
);

alter table document_file add column from_customer boolean not null default false;

do $$
declare t text;
begin
  foreach t in array array['portal_code', 'portal_session', 'portal_comment', 'payment_link_item'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I for all to kora_app using (business_id = current_business() and (select is_authorized())) with check (business_id = current_business() and (select is_authorized()))', t);
    execute format('grant select, insert, update, delete on %I to kora_app', t);
  end loop;
end $$;

-- Phase 7: a customer is an organisation, not one person at one address. The accounts clerk who chases the payment is not the
-- director who signs the order, and the godown that takes delivery is rarely the office that gets the bill. Until now a party
-- held one phone, one email and one pair of addresses, so businesses kept the rest in the note field or in their own phone.
-- A contact book and an address book per party give those people and places a place to live, and the party's own phone, email
-- and addresses stay exactly as they are: they remain what every issued document was printed from, and nothing here rewrites them.

create table contact_person (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  party_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 200),
  designation text check (designation is null or length(designation) <= 100),
  email text check (email is null or length(email) <= 254),
  phone text check (phone is null or length(phone) <= 20),
  is_primary boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, party_id) references party (business_id, id) on delete cascade
);
create index contact_person_party on contact_person (party_id, name);
-- One person answers for the party. An archived contact is out of the way and does not hold the spot.
create unique index contact_person_one_primary on contact_person (party_id) where is_primary and archived_at is null;
create trigger contact_person_touch before update on contact_person for each row execute function touch_updated_at();
create trigger audit_contact_person after insert or update or delete on contact_person for each row execute function audit_row();

alter table contact_person enable row level security;
alter table contact_person force row level security;
create policy tenant_isolation on contact_person for all to kora_app
  using (business_id = current_business() and (select is_authorized()))
  with check (business_id = current_business() and (select is_authorized()));
grant select, insert, update, delete on contact_person to kora_app;

create table party_address (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  party_id uuid not null,
  label text not null check (length(btrim(label)) between 1 and 60),       -- "Head office", "Bhiwandi godown"
  address jsonb not null default '{}',
  -- Where the goods go decides the place of supply, so an address carries its own state rather than borrowing the party's.
  state_code char(2) not null references state_code(code),
  is_default_billing boolean not null default false,
  is_default_shipping boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, party_id) references party (business_id, id) on delete cascade
);
create index party_address_party on party_address (party_id, label);
create unique index party_address_one_billing on party_address (party_id) where is_default_billing and archived_at is null;
create unique index party_address_one_shipping on party_address (party_id) where is_default_shipping and archived_at is null;
create trigger party_address_touch before update on party_address for each row execute function touch_updated_at();
create trigger audit_party_address after insert or update or delete on party_address for each row execute function audit_row();

alter table party_address enable row level security;
alter table party_address force row level security;
create policy tenant_isolation on party_address for all to kora_app
  using (business_id = current_business() and (select is_authorized()))
  with check (business_id = current_business() and (select is_authorized()));
grant select, insert, update, delete on party_address to kora_app;

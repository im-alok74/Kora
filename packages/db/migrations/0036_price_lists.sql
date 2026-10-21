-- Phase 7, G7: a wholesaler does not sell the same bolt to a distributor and to a walk-in at one price.
--
-- A price list is a named set of prices. A customer can be given one, and when a line is added for an item the
-- price comes from that customer's list if the list has something to say about the item, and from the item's own
-- price if it does not. Two kinds, because shops need both: 'fixed' lists carry an explicit price per item, and
-- 'percentage' lists move every item's own price by a signed number of basis points (a markup is positive, a
-- discount negative), rounded half up to the paise or to the whole rupee. A percentage list may still carry a few
-- explicit entries; those win for their item, which is how "10% off everything, but the cement is at cost" is said.
--
-- This only helps while a line is being typed. Nothing here is read when a document is totalled, issued, printed or
-- returned, and a document line keeps the rate that was copied onto it. Editing or archiving a list later therefore
-- cannot reprice an issued invoice, and the tax maths, which works from a rate and an inclusive flag per line, is not
-- touched. A list price carries its own inclusive-of-GST flag only if it says so; otherwise it takes the item's.
--
-- Prices are in rupees. A list has no currency: foreign-currency quotes are priced by hand, as before.
--
-- A party points at its list with a composite key, so a list from another business cannot be attached, whatever the
-- application does. A party has one list at most, which is simply a nullable column. Lists are archived, not deleted;
-- a party still pointing at an archived list falls back to item prices, because the lookup ignores archived lists.

create table price_list (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  kind text not null check (kind in ('fixed','percentage')),
  -- Signed basis points over the item's own price: +1000 is 10% dearer, -500 is 5% cheaper. -10000 would be free.
  markup_bp int check (markup_bp is null or markup_bp between -10000 and 1000000),
  rounding text not null default 'paise' check (rounding in ('paise','rupee')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check ((kind = 'percentage') = (markup_bp is not null))
);
create unique index price_list_name_live on price_list (business_id, lower(name)) where archived_at is null;
create trigger price_list_touch before update on price_list for each row execute function touch_updated_at();
create trigger audit_price_list after insert or update or delete on price_list for each row execute function audit_row();

alter table price_list enable row level security;
alter table price_list force row level security;
create policy tenant_isolation on price_list for all to kora_app
  using (business_id = current_business() and (select is_authorized()))
  with check (business_id = current_business() and (select is_authorized()));
grant select, insert, update, delete on price_list to kora_app;

create table price_list_item (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  price_list_id uuid not null,
  item_id uuid not null,
  price_paise bigint not null check (price_paise >= 0),
  -- Null means "as the item says".
  price_includes_tax boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (price_list_id, item_id),
  foreign key (business_id, price_list_id) references price_list (business_id, id) on delete cascade,
  foreign key (business_id, item_id) references item (business_id, id) on delete cascade
);
create index price_list_item_item on price_list_item (item_id);
create trigger price_list_item_touch before update on price_list_item for each row execute function touch_updated_at();
create trigger audit_price_list_item after insert or update or delete on price_list_item for each row execute function audit_row();

alter table price_list_item enable row level security;
alter table price_list_item force row level security;
create policy tenant_isolation on price_list_item for all to kora_app
  using (business_id = current_business() and (select is_authorized()))
  with check (business_id = current_business() and (select is_authorized()));
grant select, insert, update, delete on price_list_item to kora_app;

alter table party add column price_list_id uuid;
alter table party add constraint party_price_list_fk
  foreign key (business_id, price_list_id) references price_list (business_id, id);
create index party_price_list on party (price_list_id) where price_list_id is not null;

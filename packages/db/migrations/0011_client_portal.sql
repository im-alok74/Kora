-- Client portal: one private link per customer, where they see what they owe, answer estimates, pay, and read their statement.
-- Only a hash of the link's token is stored, like the public invoice link, so a leaked database cannot open anyone's portal.

create table portal_link (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  party_id uuid not null,
  token_hash bytea not null unique,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  view_count int not null default 0,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  foreign key (business_id, party_id) references party (business_id, id) on delete cascade
);
-- A customer has one live link at a time. Making a new one stops the old one.
create unique index portal_one_live_link on portal_link (party_id) where revoked_at is null;
create trigger audit_portal_link after insert or update or delete on portal_link for each row execute function audit_row();
alter table portal_link enable row level security;
alter table portal_link force row level security;
create policy tenant_isolation on portal_link for all to kora_app
  using (business_id = current_business() and (select is_authorized()))
  with check (business_id = current_business() and (select is_authorized()));
grant select, insert, update on portal_link to kora_app;

-- The public page has no tenant yet. This finds which business and customer a live link belongs to, and nothing else.
create or replace function portal_lookup(p_token text, p_count boolean default false)
returns table (business_id uuid, party_id uuid, link_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  if p_count then
    update portal_link set view_count = view_count + 1, last_viewed_at = now(), first_viewed_at = coalesce(first_viewed_at, now())
     where token_hash = digest(p_token, 'sha256') and revoked_at is null;
  end if;
  return query select l.business_id, l.party_id, l.id from portal_link l
                where l.token_hash = digest(p_token, 'sha256') and l.revoked_at is null;
end $$;
revoke all on function portal_lookup(text, boolean) from public;
grant execute on function portal_lookup(text, boolean) to kora_app;

-- Who answered an estimate: staff on the customer's behalf, or the customer through their portal.
alter table estimate_state add column decided_via text not null default 'staff' check (decided_via in ('staff', 'portal'));

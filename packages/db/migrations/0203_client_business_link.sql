-- Lets a CA firm read a client's Kora business, only with the business owner's consent.
-- The firm creates a pending link and hands the owner a one-time code (only its hash is stored). The owner accepts it from inside their own
-- business, which fills in business_id. Either side can revoke; a revoked link grants nothing. The link gives READ access to summaries through the
-- firm session; it never adds the firm's people as members of the business.
-- Firm side: isolated on app.firm_id. Business side: only through the functions below, which check the caller is an owner. Safe to run twice.

create table if not exists client_business_link (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firm(id) on delete cascade,
  client_id uuid not null references client_entity(id) on delete cascade,
  business_id uuid references business(id),
  code_hash text unique,
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'active', 'revoked')),
  requested_by uuid not null references app_user(id),
  accepted_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (status <> 'active' or (business_id is not null and accepted_by is not null and code_hash is null))
);
create unique index if not exists client_link_one_open on client_business_link (client_id) where status in ('pending', 'active');
create unique index if not exists client_link_one_business on client_business_link (firm_id, business_id) where status = 'active';

alter table client_business_link enable row level security;
alter table client_business_link force row level security;
drop policy if exists firm_tenant on client_business_link;
create policy firm_tenant on client_business_link for all to kora_app
  using (firm_id = current_firm()) with check (firm_id = current_firm());
grant select, insert, update on client_business_link to kora_app;

-- Business owner accepts with the code. The code can be used once and only before it expires.
create or replace function accept_client_link(p_actor uuid, p_business uuid, p_code_hash text) returns uuid
language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  if coalesce(member_role(p_actor, p_business), '') <> 'owner' then
    raise exception 'only the owner of the business can accept' using errcode = 'insufficient_privilege';
  end if;
  update client_business_link
     set status = 'active', business_id = p_business, accepted_by = p_actor, code_hash = null
   where code_hash = p_code_hash and status = 'pending' and expires_at > now()
   returning id into lid;
  if lid is null then
    raise exception 'that code is not valid or has expired' using errcode = 'check_violation';
  end if;
  return lid;
end $$;

create or replace function revoke_client_link_by_business(p_actor uuid, p_business uuid, p_link uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(member_role(p_actor, p_business), '') <> 'owner' then
    raise exception 'only the owner of the business can revoke' using errcode = 'insufficient_privilege';
  end if;
  update client_business_link set status = 'revoked', revoked_at = now(), code_hash = null
   where id = p_link and business_id = p_business and status = 'active';
end $$;

-- What the owner sees: which firms can read this business.
create or replace function business_client_links(p_actor uuid, p_business uuid)
returns table (link_id uuid, firm_name text, client_name text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(member_role(p_actor, p_business), '') <> 'owner' then
    raise exception 'only the owner of the business can see links' using errcode = 'insufficient_privilege';
  end if;
  return query select l.id, f.name, c.legal_name, l.status, l.created_at
    from client_business_link l join firm f on f.id = l.firm_id join client_entity c on c.id = l.client_id
   where l.business_id = p_business order by l.created_at desc;
end $$;

revoke all on function accept_client_link(uuid, uuid, text), revoke_client_link_by_business(uuid, uuid, uuid), business_client_links(uuid, uuid) from public;
grant execute on function accept_client_link(uuid, uuid, text), revoke_client_link_by_business(uuid, uuid, uuid), business_client_links(uuid, uuid) to kora_app;

-- The database's own second gate (see 0007): a firm person is authorised for a business only while an ACTIVE link joins their firm to it.
-- Firm sessions are opened read only by withLinkedTenant, so a revoked link stops the very next query, in flight or not.
create or replace function is_authorized() returns boolean
language sql stable security definer set search_path = public as $$
  select current_actor() = '00000000-0000-0000-0000-000000000001'::uuid
      or exists (select 1 from member where business_id = current_business() and user_id = current_actor())
      or exists (select 1 from client_business_link l
                  join firm_member fm on fm.firm_id = l.firm_id and fm.active and fm.user_id = current_actor()
                 where l.status = 'active' and l.business_id = current_business() and l.firm_id = current_firm())
$$;

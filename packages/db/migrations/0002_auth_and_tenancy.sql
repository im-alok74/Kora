-- Auth tables, state codes, and the few cross-tenant lookups the app needs.
-- Functions are SECURITY DEFINER and owned by kora_owner (BYPASSRLS) so they can see across tenants
-- for exactly one purpose each. They take explicit ids and never return more than that purpose needs.

-- GST state and territory codes. Confirm against the GST portal master list before beta.
insert into state_code (code, name) values
  ('01','Jammu and Kashmir'),('02','Himachal Pradesh'),('03','Punjab'),('04','Chandigarh'),('05','Uttarakhand'),
  ('06','Haryana'),('07','Delhi'),('08','Rajasthan'),('09','Uttar Pradesh'),('10','Bihar'),('11','Sikkim'),
  ('12','Arunachal Pradesh'),('13','Nagaland'),('14','Manipur'),('15','Mizoram'),('16','Tripura'),
  ('17','Meghalaya'),('18','Assam'),('19','West Bengal'),('20','Jharkhand'),('21','Odisha'),
  ('22','Chhattisgarh'),('23','Madhya Pradesh'),('24','Gujarat'),
  ('26','Dadra and Nagar Haveli and Daman and Diu'),('27','Maharashtra'),('29','Karnataka'),('30','Goa'),
  ('31','Lakshadweep'),('32','Kerala'),('33','Tamil Nadu'),('34','Puducherry'),
  ('35','Andaman and Nicobar Islands'),('36','Telangana'),('37','Andhra Pradesh'),('38','Ladakh'),
  ('96','Other Country'),('97','Other Territory'),('99','Centre Jurisdiction')
on conflict (code) do nothing;

-- One-time codes. identifier is a normalised E.164 phone or a lowercase email.
create table otp_challenge (
  id uuid primary key default gen_random_uuid(),
  identifier text not null,
  channel text not null check (channel in ('sms','email')),
  code_hash bytea not null,                 -- HMAC of identifier and code; the code is never stored
  expires_at timestamptz not null,
  attempts int not null default 0 check (attempts >= 0),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on otp_challenge (identifier, created_at desc);

create table app_session (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  token_hash bytea not null unique,         -- sha256 of the cookie token
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on app_session (user_id);

grant select, insert, update on otp_challenge, app_session to kora_app;

-- The signed-in user's businesses, for the business switcher.
create or replace function my_memberships(p_user uuid)
returns table (business_id uuid, legal_name text, role text)
language sql stable security definer set search_path = public as $$
  select m.business_id, b.legal_name, m.role
    from member m join business b on b.id = m.business_id
   where m.user_id = p_user order by b.legal_name
$$;

-- Role of a user in a business, or null. Used once per request to authorise the tenant switch.
create or replace function member_role(p_user uuid, p_business uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from member where user_id = p_user and business_id = p_business
$$;

-- Only an owner can add a member. The check lives here so no caller can skip it.
create or replace function add_member(p_actor uuid, p_business uuid, p_user uuid, p_role text) returns uuid
language plpgsql security definer set search_path = public as $$
declare mid uuid;
begin
  if coalesce(member_role(p_actor, p_business), '') <> 'owner' then
    raise exception 'only an owner can add members' using errcode = 'insufficient_privilege';
  end if;
  insert into member (business_id, user_id, role) values (p_business, p_user, p_role) returning id into mid;
  return mid;
end $$;

create or replace function remove_member(p_actor uuid, p_business uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(member_role(p_actor, p_business), '') <> 'owner' then
    raise exception 'only an owner can remove members' using errcode = 'insufficient_privilege';
  end if;
  delete from member where business_id = p_business and user_id = p_user;
end $$;

revoke all on function my_memberships(uuid), member_role(uuid, uuid), add_member(uuid, uuid, uuid, text),
       remove_member(uuid, uuid, uuid) from public;
grant execute on function my_memberships(uuid), member_role(uuid, uuid), add_member(uuid, uuid, uuid, text),
       remove_member(uuid, uuid, uuid) to kora_app;

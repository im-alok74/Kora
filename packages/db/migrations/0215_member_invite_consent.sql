-- An owner who adds a person to a business now only invites them. The person becomes a member when they accept; until then nothing of the
-- business is open to them (no member row exists, so no check can count them). Invitations lapse after 14 days. Safe to run twice.
-- add_member (code that already has the person's consent, and tests) still adds at once.

create table if not exists member_invite (
  business_id uuid not null references business(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  role text not null check (role in ('owner', 'staff', 'accountant')),
  invited_by uuid references app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
alter table member_invite enable row level security;
alter table member_invite force row level security;
-- No policy and no grant: the table is reached only through the definer functions below.

create or replace function invite_member(p_actor uuid, p_business uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(member_role(p_actor, p_business), '') <> 'owner' then
    raise exception 'only an owner can add members' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from member where business_id = p_business and user_id = p_user) then
    raise exception 'already a member' using errcode = 'unique_violation';
  end if;
  insert into member_invite (business_id, user_id, role, invited_by) values (p_business, p_user, p_role, p_actor)
  on conflict (business_id, user_id) do update set role = excluded.role, invited_by = excluded.invited_by, created_at = now();
end $$;

create or replace function list_member_invites(p_actor uuid, p_business uuid)
returns table (user_id uuid, role text, phone text, email text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(member_role(p_actor, p_business), '') <> 'owner' then
    raise exception 'only an owner can see invitations' using errcode = 'insufficient_privilege';
  end if;
  return query select i.user_id, i.role, u.phone, u.email, i.created_at
    from member_invite i join app_user u on u.id = i.user_id
   where i.business_id = p_business and i.created_at > now() - interval '14 days' order by i.created_at;
end $$;

create or replace function cancel_member_invite(p_actor uuid, p_business uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(member_role(p_actor, p_business), '') <> 'owner' then
    raise exception 'only an owner can cancel invitations' using errcode = 'insufficient_privilege';
  end if;
  delete from member_invite where business_id = p_business and user_id = p_user;
end $$;

create or replace function my_member_invites(p_user uuid) returns table (business_id uuid, legal_name text, role text)
language sql stable security definer set search_path = public as $$
  select i.business_id, b.legal_name, i.role from member_invite i join business b on b.id = i.business_id
   where i.user_id = p_user and i.created_at > now() - interval '14 days' order by b.legal_name
$$;

create or replace function answer_member_invite(p_user uuid, p_business uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare inv member_invite;
begin
  select * into inv from member_invite where business_id = p_business and user_id = p_user and created_at > now() - interval '14 days';
  if not found then raise exception 'there is no invitation to answer' using errcode = 'check_violation'; end if;
  delete from member_invite where business_id = p_business and user_id = p_user;
  if p_accept then
    insert into member (business_id, user_id, role) values (p_business, p_user, inv.role) on conflict do nothing;
  end if;
end $$;

revoke all on function invite_member(uuid, uuid, uuid, text), list_member_invites(uuid, uuid), cancel_member_invite(uuid, uuid, uuid),
       my_member_invites(uuid), answer_member_invite(uuid, uuid, boolean) from public;
grant execute on function invite_member(uuid, uuid, uuid, text), list_member_invites(uuid, uuid), cancel_member_invite(uuid, uuid, uuid),
       my_member_invites(uuid), answer_member_invite(uuid, uuid, boolean) to kora_app;

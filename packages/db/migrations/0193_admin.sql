-- The platform admin panel (Kora's own staff, not a business's owner). The checks that decide WHO is an admin (an allowlist of
-- e-mail addresses and a sign-in with an authenticator code) are in the web layer. What lives here is what an admin may do, as
-- narrow functions that return only what the panel shows (never invoice contents), and a log of every change they make that the
-- application role can append to through admin_log() and cannot edit. Safe to run twice.

create table if not exists admin_audit (
  id bigserial primary key,
  admin_user uuid not null references app_user(id),
  action text not null check (length(action) between 1 and 60),
  target text check (target is null or length(target) <= 120),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
revoke all on admin_audit from public;
create index if not exists admin_audit_recent on admin_audit (created_at desc);

create or replace function admin_log(p_admin uuid, p_action text, p_target text, p_detail jsonb) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into admin_audit (admin_user, action, target, detail) values (p_admin, p_action, p_target, coalesce(p_detail, '{}'));
$$;

create or replace function admin_audit_list(p_limit int) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x), '[]') from (
    select a.id, a.action, a.target, a.detail, a.created_at, coalesce(u.email, u.phone, 'unknown') as admin
      from admin_audit a join app_user u on u.id = a.admin_user order by a.id desc limit least(greatest(p_limit, 1), 200)) x;
$$;

create or replace function admin_overview() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  select jsonb_build_object(
    'businesses', (select count(*) from business),
    'users', (select count(*) from app_user where deleted_at is null),
    'newBusinesses30d', (select count(*) from business where created_at > now() - interval '30 days'),
    'issuedThisMonth', (select count(*) from document where status = 'issued' and issued_at >= date_trunc('month', now())),
    'plans', (select coalesce(jsonb_object_agg(plan, n), '{}') from (
                select coalesce(p.plan, 'starter') as plan, count(*) as n from business b left join business_plan p on p.business_id = b.id group by 1) t),
    'activeByPlan', (select coalesce(jsonb_object_agg(plan, n), '{}') from (select plan, count(*) as n from subscription where status = 'active' group by plan) q),
    'pastDue', (select count(*) from subscription where status = 'past_due'),
    'jobsQueued', (select count(*) from job where status = 'queued'),
    'jobsFailed', (select count(*) from job where status = 'failed'),
    'oldestQueuedMinutes', (select coalesce(floor(extract(epoch from now() - min(run_at)) / 60), 0) from job where status = 'queued' and run_at <= now()),
    'privacyOpen', (select count(*) from privacy_request where status in ('open', 'in_progress')),
    'privacyOverdue', (select count(*) from privacy_request where status in ('open', 'in_progress') and due_at < now()),
    'breachesOpen', (select count(*) from data_breach where board_notified_at is null or people_notified_at is null),
    'unprocessedPayments', (select count(*) from webhook_event where processed_at is null)
  ) into r;
  return r;
end $$;

create or replace function admin_businesses(p_q text, p_limit int, p_offset int) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by (x->>'created_at') desc), '[]') from (
    select to_jsonb(t) as x from (
      select b.id, b.legal_name, b.gstin, b.state_code, b.registration_type, b.created_at,
             coalesce(p.plan, 'starter') as plan, coalesce(p.status, 'free') as plan_status, p.valid_until,
             (select count(*) from member m where m.business_id = b.id) as members,
             (select count(*) from document d where d.business_id = b.id and d.status = 'issued') as issued_total
        from business b left join business_plan p on p.business_id = b.id
       where coalesce(p_q, '') = '' or b.legal_name ilike '%' || p_q || '%' or b.gstin ilike p_q || '%'
       order by b.created_at desc limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)) t) s;
$$;

create or replace function admin_business(p_id uuid) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'business', (select to_jsonb(t) from (select id, legal_name, trade_name, gstin, state_code, registration_type, created_at, einvoice_enabled from business where id = p_id) t),
    'plan', (select to_jsonb(p) from business_plan p where p.business_id = p_id),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('userId', u.id, 'who', coalesce(u.email, u.phone, 'removed'), 'role', m.role)), '[]')
                  from member m join app_user u on u.id = m.user_id where m.business_id = p_id),
    'subscriptions', (select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc), '[]') from subscription s where s.business_id = p_id),
    'payments', (select coalesce(jsonb_agg(to_jsonb(x) order by x.paid_at desc), '[]') from (select gateway_payment_id, amount_paise, paid_at from billing_payment where business_id = p_id order by paid_at desc limit 12) x),
    'usage', jsonb_build_object(
      'issuedThisMonth', (select count(*) from document where business_id = p_id and status = 'issued' and issued_at >= date_trunc('month', now())),
      'issuedTotal', (select count(*) from document where business_id = p_id and status = 'issued'),
      'parties', (select count(*) from party where business_id = p_id),
      'failedJobs', (select count(*) from job where business_id = p_id and status = 'failed'))
  );
$$;

create or replace function admin_users(p_q text, p_limit int) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]') from (
    select u.id, u.email, u.phone, u.display_name, u.account_type, u.created_at, u.deleted_at, u.locked_until,
           exists (select 1 from user_totp x where x.user_id = u.id) as has_mfa,
           (select count(*) from app_session s where s.user_id = u.id and s.revoked_at is null and s.expires_at > now()) as active_sessions,
           (select count(*) from member m where m.user_id = u.id) as businesses
      from app_user u
     where coalesce(p_q, '') = '' or u.email ilike '%' || p_q || '%' or u.phone like '%' || p_q || '%' or u.display_name ilike '%' || p_q || '%'
     order by u.created_at desc limit least(greatest(p_limit, 1), 100)) t;
$$;

create or replace function admin_set_plan(p_admin uuid, p_business uuid, p_plan text, p_status text, p_valid_until timestamptz, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_plan not in ('starter', 'business', 'firm') or p_status not in ('free', 'trialing', 'active', 'past_due', 'cancelled') then
    raise exception 'Unknown plan or status.' using errcode = '22023';
  end if;
  if not exists (select 1 from business where id = p_business) then raise exception 'Business not found.' using errcode = '22023'; end if;
  perform set_business_plan(p_business, p_plan, p_status, p_valid_until, left(p_note, 500));
  perform admin_log(p_admin, 'plan.set', p_business::text, jsonb_build_object('plan', p_plan, 'status', p_status, 'validUntil', p_valid_until, 'note', left(p_note, 500)));
end $$;

create or replace function admin_revoke_sessions(p_admin uuid, p_user uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update app_session set revoked_at = now() where user_id = p_user and revoked_at is null;
  get diagnostics n = row_count;
  update app_user set locked_until = null, failed_logins = 0 where id = p_user;
  perform admin_log(p_admin, 'user.sessions_revoked', p_user::text, jsonb_build_object('count', n));
  return n;
end $$;

create or replace function admin_privacy_requests(p_open_only boolean) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.due_at), '[]') from (
    select r.id, r.kind, r.details, r.status, r.due_at, r.resolution, r.resolved_at, r.created_at,
           coalesce(u.email, u.phone, 'removed') as who, (r.status in ('open', 'in_progress') and r.due_at < now()) as overdue
      from privacy_request r join app_user u on u.id = r.user_id
     where not p_open_only or r.status in ('open', 'in_progress') order by r.due_at limit 200) t;
$$;

create or replace function admin_resolve_privacy_request(p_admin uuid, p_id uuid, p_status text, p_resolution text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('in_progress', 'done', 'rejected') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  update privacy_request set status = p_status, resolution = left(p_resolution, 4000), updated_at = now(),
         resolved_at = case when p_status in ('done', 'rejected') then now() else null end where id = p_id;
  if not found then raise exception 'Request not found.' using errcode = '22023'; end if;
  perform admin_log(p_admin, 'privacy_request.' || p_status, p_id::text, '{}');
end $$;

create or replace function admin_breaches() returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(b) order by b.discovered_at desc), '[]') from data_breach b;
$$;

create or replace function admin_record_breach(p_admin uuid, p_discovered timestamptz, p_summary text, p_data text, p_people int, p_contained boolean) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid;
begin
  insert into data_breach (discovered_at, summary, data_affected, people_affected, contained, recorded_by)
  values (p_discovered, left(p_summary, 4000), left(coalesce(p_data, ''), 2000), p_people, coalesce(p_contained, false), p_admin) returning id into v;
  perform admin_log(p_admin, 'breach.recorded', v::text, '{}');
  return v;
end $$;

create or replace function admin_update_breach(p_admin uuid, p_id uuid, p_contained boolean, p_board_notified timestamptz, p_people_notified timestamptz, p_notes text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update data_breach set contained = coalesce(p_contained, contained), board_notified_at = coalesce(p_board_notified, board_notified_at),
         people_notified_at = coalesce(p_people_notified, people_notified_at), notes = coalesce(left(p_notes, 4000), notes) where id = p_id;
  if not found then raise exception 'Breach not found.' using errcode = '22023'; end if;
  perform admin_log(p_admin, 'breach.updated', p_id::text, '{}');
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'admin_log(uuid, text, text, jsonb)', 'admin_audit_list(int)', 'admin_overview()', 'admin_businesses(text, int, int)', 'admin_business(uuid)',
    'admin_users(text, int)', 'admin_set_plan(uuid, uuid, text, text, timestamptz, text)', 'admin_revoke_sessions(uuid, uuid)',
    'admin_privacy_requests(boolean)', 'admin_resolve_privacy_request(uuid, uuid, text, text)', 'admin_breaches()',
    'admin_record_breach(uuid, timestamptz, text, text, int, boolean)', 'admin_update_breach(uuid, uuid, boolean, timestamptz, timestamptz, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to kora_app', f);
  end loop;
end $$;

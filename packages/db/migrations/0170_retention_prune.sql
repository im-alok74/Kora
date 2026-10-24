-- Retention for operational tables that only ever grew: finished jobs, processed gateway events, finished webhook deliveries,
-- expired sign-in codes and sessions. Issued documents, payments and the audit log are never touched.
--
-- Written as a function (not a scheduled job) so the worker or the cron tick can call it. It runs as its owner, which bypasses
-- row-level security, because kora_web has no DELETE on these tables and must not get it. Safe to run any number of times,
-- and safe to apply twice: create or replace, and the grants are repeatable.
create or replace function prune_operational_data() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n_job_done int; n_job_failed int; n_event int; n_delivery int; n_otp int; n_mfa int; n_session int;
begin
  -- Finished work leaves no business record behind: the document, the payment and the e-invoice rows hold the facts.
  delete from job where status = 'done' and coalesce(finished_at, updated_at) < now() - interval '30 days';
  get diagnostics n_job_done = row_count;
  -- Failed jobs stay longer, so a person can still read the error.
  delete from job where status = 'failed' and updated_at < now() - interval '90 days';
  get diagnostics n_job_failed = row_count;

  -- A processed gateway event is only needed to recognise a replay. Gateways stop retrying within days, so 180 days is generous.
  -- An event that was never processed is kept: it means a payment was not applied.
  delete from webhook_event where processed_at is not null and processed_at < now() - interval '180 days';
  get diagnostics n_event = row_count;

  delete from webhook_delivery where status in ('delivered', 'failed') and created_at < now() - interval '90 days';
  get diagnostics n_delivery = row_count;

  delete from otp_challenge where expires_at < now() - interval '1 day';
  get diagnostics n_otp = row_count;
  delete from mfa_challenge where expires_at < now() - interval '1 day';
  get diagnostics n_mfa = row_count;

  -- Expired or signed-out sessions. security_event (the sign-in history) is kept.
  delete from app_session where expires_at < now() - interval '30 days' or (revoked_at is not null and revoked_at < now() - interval '30 days');
  get diagnostics n_session = row_count;

  return jsonb_build_object('job_done', n_job_done, 'job_failed', n_job_failed, 'webhook_event', n_event,
                            'webhook_delivery', n_delivery, 'otp_challenge', n_otp, 'mfa_challenge', n_mfa, 'app_session', n_session);
end $$;

revoke all on function prune_operational_data() from public;
grant execute on function prune_operational_data() to kora_app;

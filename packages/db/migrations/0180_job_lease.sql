-- Fence every claim so a worker returning after lease expiry cannot acknowledge a newer claim.
alter table job add column lease_token uuid;
create or replace function claim_jobs(p_queues text[], p_limit int, p_worker text) returns setof job
language plpgsql as $$
begin
  update job set status = 'failed', finished_at = now(), locked_at = null, locked_by = null,
    lease_token = null, last_error = 'Worker lease expired at attempt limit', updated_at = now()
    where status = 'running' and locked_at < now() - interval '10 minutes' and attempts >= max_attempts;
  update job set status = 'queued', locked_at = null, locked_by = null, lease_token = null, updated_at = now()
    where status = 'running' and locked_at < now() - interval '10 minutes' and attempts < max_attempts;
  return query
  update job j set status = 'running', locked_at = now(), locked_by = p_worker,
    lease_token = gen_random_uuid(), attempts = j.attempts + 1, updated_at = now()
    where j.id in (select id from job where status = 'queued' and run_at <= now() and queue = any(p_queues)
      order by run_at, id limit greatest(0, least(p_limit, 100)) for update skip locked)
    returning j.*;
end $$;

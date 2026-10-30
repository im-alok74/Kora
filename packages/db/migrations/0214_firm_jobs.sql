-- Background work across all firms: the monthly work generator and the reminder sender.
-- Firm tables are isolated on app.firm_id, so a job cannot list the firms through them. These functions answer only for the system actor
-- (app.user_id = the system user), which the web server never uses for a request. Safe to run twice.

alter table firm add column if not exists last_generated_period text check (last_generated_period is null or last_generated_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- Links made by the reminder sender have no person behind them.
alter table upload_link alter column created_by drop not null;

create or replace function firms_needing_month(p_period text) returns table (id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if current_actor() is distinct from '00000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'system only' using errcode = 'insufficient_privilege';
  end if;
  return query select f.id from firm f where f.last_generated_period is distinct from p_period;
end $$;

create or replace function mark_firm_generated(p_firm uuid, p_period text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_actor() is distinct from '00000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'system only' using errcode = 'insufficient_privilege';
  end if;
  update firm set last_generated_period = p_period where id = p_firm;
end $$;

create or replace function firms_with_queued_reminders() returns table (id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if current_actor() is distinct from '00000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'system only' using errcode = 'insufficient_privilege';
  end if;
  return query select distinct q.firm_id from request_reminder q where q.status = 'queued';
end $$;

-- The reminder sender settles a reminder as sent or failed. It has to be able to write the system's own rows.
-- (request_reminder already allows select, insert and update to the app role under the firm policy.)

-- The system actor may plan reminders for every firm, so planning can run as a background job too.
create or replace function firms_with_open_requests() returns table (id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if current_actor() is distinct from '00000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'system only' using errcode = 'insufficient_privilege';
  end if;
  return query select distinct r.firm_id from document_request r where r.status in ('requested', 'needs_correction');
end $$;

revoke all on function firms_needing_month(text), mark_firm_generated(uuid, text), firms_with_queued_reminders(), firms_with_open_requests() from public;
grant execute on function firms_needing_month(text), mark_firm_generated(uuid, text), firms_with_queued_reminders(), firms_with_open_requests() to kora_app;

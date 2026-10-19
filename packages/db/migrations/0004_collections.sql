-- Collections: the job queue, payment links, reminder settings, and the cross-tenant lookups the worker needs.

-- A small Postgres-backed queue. Jobs are inserted in the same transaction as the change that needs them,
-- so an issued invoice always has its e-invoice, send and reminder work queued, and a rolled-back change leaves none.
create table job (
  id uuid primary key default gen_random_uuid(),
  queue text not null,
  business_id uuid,
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  run_at timestamptz not null default now(),
  attempts int not null default 0,
  max_attempts int not null default 8 check (max_attempts > 0),
  last_error text,
  dedupe_key text,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index job_ready on job (run_at) where status = 'queued';
create index job_running on job (locked_at) where status = 'running';
create index job_business on job (business_id, queue);
-- At most one live job per queue and key, so a retry storm cannot double-queue the same work.
create unique index job_dedupe on job (queue, dedupe_key) where dedupe_key is not null and status in ('queued','running');
grant select, insert, update on job to kora_app;

-- Claims ready jobs for one worker. SKIP LOCKED lets several workers run without blocking each other.
-- Jobs stuck in 'running' for 10 minutes (a crashed worker) go back to the queue.
create or replace function claim_jobs(p_queues text[], p_limit int, p_worker text) returns setof job
language plpgsql as $$
begin
  update job set status = 'queued', locked_at = null, locked_by = null, updated_at = now()
   where status = 'running' and locked_at < now() - interval '10 minutes';
  return query
  update job j set status = 'running', locked_at = now(), locked_by = p_worker, attempts = j.attempts + 1, updated_at = now()
   where j.id in (select id from job where status = 'queued' and run_at <= now() and queue = any (p_queues)
                   order by run_at limit p_limit for update skip locked)
  returning j.*;
end $$;
grant execute on function claim_jobs(text[], int, text) to kora_app;

alter table business
  add column reminder_config jsonb not null default '{"enabled": false, "channel": "whatsapp", "offsets": [-2, 3, 7]}';

-- A hosted payment link created with a gateway for one document.
create table payment_link (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  document_id uuid not null,
  gateway text not null,
  gateway_link_id text not null,
  url text not null,
  amount_paise bigint not null check (amount_paise > 0),
  status text not null default 'created' check (status in ('created','paid','expired','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gateway, gateway_link_id),
  foreign key (business_id, document_id) references document (business_id, id)
);
create index on payment_link (business_id, document_id);
create trigger payment_link_touch before update on payment_link for each row execute function touch_updated_at();
create trigger audit_payment_link after insert or update or delete on payment_link for each row execute function audit_row();
alter table payment_link enable row level security;
alter table payment_link force row level security;
create policy tenant_isolation on payment_link for all to kora_app
  using (business_id = current_business()) with check (business_id = current_business());
grant select, insert, update on payment_link to kora_app;

-- Webhooks arrive without a tenant. This finds which business owns a link, and nothing else.
create or replace function lookup_payment_link(p_gateway text, p_link_id text)
returns table (business_id uuid, document_id uuid, link_id uuid, amount_paise bigint, status text)
language sql stable security definer set search_path = public as $$
  select business_id, document_id, id, amount_paise, status from payment_link
   where gateway = p_gateway and gateway_link_id = p_link_id
$$;
revoke all on function lookup_payment_link(text, text) from public;
grant execute on function lookup_payment_link(text, text) to kora_app;

-- Reminders due now, across tenants. The worker then processes each one inside its own tenant transaction.
create or replace function due_reminders(p_limit int)
returns table (id uuid, business_id uuid, document_id uuid)
language sql stable security definer set search_path = public as $$
  select r.id, r.business_id, r.document_id from reminder r
   where r.delivery_status = 'scheduled' and r.scheduled_at <= now()
   order by r.scheduled_at limit p_limit
$$;
revoke all on function due_reminders(int) from public;
grant execute on function due_reminders(int) to kora_app;

-- The ageing and outstanding figures count only issued invoices, debit notes and bills of supply.
create or replace view receivable as
  select d.id, d.business_id, d.party_id, d.doc_type, d.number, d.doc_date,
         coalesce(d.due_date, d.doc_date) as due_date,
         d.grand_total_paise, d.amount_settled_paise,
         (d.grand_total_paise - d.amount_settled_paise) as outstanding_paise
    from document d
   where d.status = 'issued' and d.doc_type in ('tax_invoice', 'bill_of_supply', 'debit_note')
     and d.grand_total_paise > d.amount_settled_paise;
alter view receivable set (security_invoker = true);
grant select on receivable to kora_app;

-- A reminder waiting in the send queue is neither scheduled nor sent.
alter table reminder drop constraint reminder_delivery_status_check;
alter table reminder add constraint reminder_delivery_status_check
  check (delivery_status in ('scheduled','queued','sent','delivered','read','failed','cancelled'));

-- The webhook inbox is written by the application before the tenant is known.
grant select, insert, update on webhook_event to kora_app;

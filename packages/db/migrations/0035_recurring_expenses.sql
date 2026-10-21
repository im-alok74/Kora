-- Phase 7, G6: expenses that repeat. Rent on the 1st, the accounting software every year, a retainer paid out monthly.
--
-- Kora already has a recurrence engine: recurring_profile holds the schedule, recurring_run holds one row per
-- scheduled date, and due_recurring() hands the worker whatever is due in each business's own time zone. It drove
-- invoices only. A second engine for expenses would mean a second occurrence calculator, a second catch-up rule, a
-- second idempotency key and a second pause-and-resume -- and the day the two drift apart, a monthly rent lands on
-- the 28th while a monthly invoice lands on the 31st, for no reason anybody can explain. So this extends the one
-- engine instead of building a parallel one: a `kind` column on the profile, an expense_id beside document_id on the
-- run, and the same tick walks both.
--
-- What an expense profile does not have is the invoice half of the table: there is no customer (a vendor on an
-- expense is free text, exactly as on `expense`), no doc_type, nothing to issue, nothing to send. So party_id and
-- doc_type become nullable and a check ties each kind to the columns it is allowed to use. What varies between
-- expenses -- vendor, category, amount, GST, how it was paid, notes -- goes in the payload jsonb that already holds
-- the invoice template. category stays free text there too: it is not an entity and this does not make it one.
--
-- Profiles are archived, not deleted. A deleted profile used to take its run rows with it; for expenses that would
-- be the only link between the rent paid in April and the schedule that paid it, and the expenses themselves must
-- survive regardless -- which is why expense_id is `on delete set null` and not a cascade.

alter table expense add constraint expense_business_id_id_key unique (business_id, id);

alter table recurring_profile
  add column kind text not null default 'invoice' check (kind in ('invoice', 'expense')),
  add column archived_at timestamptz,
  alter column party_id drop not null,
  alter column doc_type drop not null;

-- Each kind uses its own half of the row, and nothing of the other's.
alter table recurring_profile add constraint recurring_profile_kind_shape check (
  case kind
    when 'invoice' then party_id is not null and doc_type is not null
    -- An expense is simply recorded on its date: no customer, no document type, nothing to issue or send.
    when 'expense' then party_id is null and doc_type is null and mode = 'draft' and channel is null and terms_days = 0
  end);

alter table recurring_run
  add column expense_id uuid,
  add constraint recurring_run_one_child check (document_id is null or expense_id is null),
  -- The expense outlives the run row and the profile: a schedule that is archived, or a run that is pruned, must
  -- never reach into the books and remove money that was really spent.
  add constraint recurring_run_expense_fk foreign key (business_id, expense_id) references expense (business_id, id) on delete set null (expense_id);

-- Archived profiles are not due for anything, ever.
create or replace function due_recurring(p_limit int)
returns table (id uuid, business_id uuid)
language sql stable security definer set search_path = public as $$
  select p.id, p.business_id from recurring_profile p join business b on b.id = p.business_id
   where p.active and p.archived_at is null and p.next_run_date <= (now() at time zone b.timezone)::date
   order by p.next_run_date limit p_limit
$$;
revoke all on function due_recurring(int) from public;
grant execute on function due_recurring(int) to kora_app;

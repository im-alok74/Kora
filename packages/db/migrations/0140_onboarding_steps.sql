-- Night 4: the first-run checklist remembers which steps a business finished or chose to skip, so a person can leave and come back.
--
-- Whether a step is really done (a customer exists, an invoice exists) is read from the business's own records. This table holds only
-- the person's choices: "done" for steps that have no record of their own (the invoice look), and "skipped" for steps they put off.
-- Additive only: one new table.

create table onboarding_step (
  business_id uuid not null references business(id) on delete cascade,
  step text not null check (step in ('business','logo','look','customer','invoice')),
  state text not null check (state in ('done','skipped')),
  updated_at timestamptz not null default now(),
  primary key (business_id, step)
);
create trigger onboarding_step_touch before update on onboarding_step for each row execute function touch_updated_at();

alter table onboarding_step enable row level security;
alter table onboarding_step force row level security;
create policy tenant_isolation on onboarding_step for all to kora_app
  using (business_id = current_business() and (select is_authorized()))
  with check (business_id = current_business() and (select is_authorized()));
grant select, insert, update, delete on onboarding_step to kora_app;

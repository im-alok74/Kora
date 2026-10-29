-- Which firm members look after which client. Partners and managers see every client; preparers and reviewers only the ones assigned to them.
-- Isolated on app.firm_id. Safe to run twice.

create table if not exists client_assignment (
  firm_id uuid not null references firm(id) on delete cascade,
  client_id uuid not null references client_entity(id) on delete cascade,
  user_id uuid not null references app_user(id),
  assigned_by uuid not null references app_user(id),
  created_at timestamptz not null default now(),
  primary key (client_id, user_id)
);
create index if not exists client_assignment_user on client_assignment (firm_id, user_id);

alter table client_assignment enable row level security;
alter table client_assignment force row level security;
drop policy if exists firm_tenant on client_assignment;
create policy firm_tenant on client_assignment for all to kora_app
  using (firm_id = current_firm()) with check (firm_id = current_firm());
grant select, insert, delete on client_assignment to kora_app;

-- Night 1, step 4: custom fields a business defines once and fills in on its documents and customers.
-- A definition says what to ask (label, kind, choices) and whether to print the answer on the PDF.
-- A document or customer keeps a copy of label and answer next to each value (custom_values), so renaming or archiving a
-- field later never changes what an issued document says.

create table custom_field_def (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  entity text not null check (entity in ('document', 'customer')),
  label text not null check (length(btrim(label)) between 1 and 40),
  kind text not null check (kind in ('text', 'number', 'date', 'dropdown')),
  options jsonb check (options is null or jsonb_typeof(options) = 'array'),
  show_on_pdf boolean not null default true,
  position int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check ((kind = 'dropdown') = (options is not null))
);
create unique index custom_field_def_label_live on custom_field_def (business_id, entity, lower(label)) where archived_at is null;
create trigger custom_field_def_touch before update on custom_field_def for each row execute function touch_updated_at();
create trigger audit_custom_field_def after insert or update or delete on custom_field_def for each row execute function audit_row();

alter table custom_field_def enable row level security;
alter table custom_field_def force row level security;
create policy tenant_isolation on custom_field_def for all to kora_app
  using (business_id = current_business() and (select is_authorized()))
  with check (business_id = current_business() and (select is_authorized()));
grant select, insert, update, delete on custom_field_def to kora_app;

alter table document add column custom_values jsonb check (custom_values is null or jsonb_typeof(custom_values) = 'array');
alter table party add column custom_values jsonb check (custom_values is null or jsonb_typeof(custom_values) = 'array');

-- Client inbox: a business hands over bills and papers, and the accountant works through them.
-- The file is kept apart from the row so the audit log, which copies whole rows, never holds file contents.
create table inbox_item (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  note text check (note is null or length(note) <= 1000),
  file_name text not null check (length(file_name) between 1 and 120),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'application/pdf')),
  status text not null default 'new' check (status in ('new', 'done', 'rejected')),
  review_note text check (review_note is null or length(review_note) <= 1000),
  uploaded_by uuid references app_user(id),
  reviewed_by uuid references app_user(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'new') = (reviewed_at is null))
);
create index on inbox_item (business_id, status, created_at desc);

create table inbox_file (
  item_id uuid primary key references inbox_item(id) on delete cascade,
  business_id uuid not null references business(id) on delete cascade,
  data bytea not null check (octet_length(data) between 1 and 2097152)
);

do $$ declare t text; begin
  foreach t in array array['inbox_item', 'inbox_file'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I for all to kora_app
                      using (business_id = current_business() and (select is_authorized()))
                      with check (business_id = current_business() and (select is_authorized()))', t);
  end loop;
end $$;
create trigger audit_inbox_item after insert or update or delete on inbox_item for each row execute function audit_row();
grant select, insert, update, delete on inbox_item to kora_app;
grant select, insert, update, delete on inbox_file to kora_app;

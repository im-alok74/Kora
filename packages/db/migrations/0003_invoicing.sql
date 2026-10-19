-- Business profile fields used on documents, and the invoice template.

alter table business
  add column address jsonb not null default '{}',
  add column phone text,
  add column email text,
  add column upi_vpa text check (upi_vpa is null or upi_vpa ~ '^[a-zA-Z0-9._-]{2,100}@[a-zA-Z]{2,64}$'),
  add column bank_details jsonb not null default '{}';

create table document_template (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  name text not null default 'Default',
  -- Presentation only. Statutory fields are rendered by code and cannot be turned off here.
  config jsonb not null default '{}',
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);
create unique index one_default_template on document_template (business_id) where is_default;
create trigger document_template_touch before update on document_template for each row execute function touch_updated_at();
create trigger audit_document_template after insert or update or delete on document_template for each row execute function audit_row();

alter table document_template enable row level security;
alter table document_template force row level security;
create policy tenant_isolation on document_template for all to kora_app
  using (business_id = current_business()) with check (business_id = current_business());
grant select, insert, update, delete on document_template to kora_app;

-- Share-link views never need a tenant session, so the public page reads through this function.
-- It returns only what the page prints: no internal user ids and no storage keys.
create or replace function public_document(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l share_link; d document; r jsonb; t jsonb;
begin
  select * into l from share_link where token_hash = digest(p_token, 'sha256')
    and revoked_at is null and (expires_at is null or expires_at > now());
  if not found then return null; end if;
  update share_link set view_count = view_count + 1, last_viewed_at = now(),
         first_viewed_at = coalesce(first_viewed_at, now()) where id = l.id;
  select * into d from document where id = l.document_id and status <> 'draft';
  if not found then return null; end if;
  select config into t from document_template where business_id = d.business_id and is_default;
  select (to_jsonb(d) - 'created_by' - 'pdf_object_key') || jsonb_build_object(
      'template', coalesce(t, '{}'::jsonb),
      'lines', (select coalesce(jsonb_agg(to_jsonb(x) - 'business_id' order by x.position), '[]'::jsonb)
                  from document_line x where x.document_id = d.id))
    into r;
  return r;
end $$;

-- Offline drafts: a client reference so a retried sync cannot create a duplicate,
-- and a revision number so two devices editing the same draft are noticed rather than overwritten.

alter table document
  add column client_ref text check (client_ref is null or length(client_ref) between 8 and 64),
  add column rev bigint not null default 1;

-- One document per client reference per business, however many times the device retries.
create unique index document_client_ref on document (business_id, client_ref) where client_ref is not null;

-- Every change bumps the revision. It lives outside document_guard so drafts and issued documents are both counted.
create or replace function document_bump_rev() returns trigger language plpgsql as $$
begin
  new.rev := old.rev + 1;
  return new;
end $$;
create trigger document_rev before update on document for each row execute function document_bump_rev();

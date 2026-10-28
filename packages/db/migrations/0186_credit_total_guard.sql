-- Audit finding C-6: the rule "issued credit notes together cannot exceed the invoice they point at" lived only in the
-- application. This makes the database the authority, as the design rules say. When a credit note becomes issued, the original is
-- locked (so two notes issued at once take turns) and the taxable value of the issued notes, this one included, must fit within it.
-- Existing issued notes are not re-checked. Safe to run twice.
create or replace function credit_total_guard() returns trigger language plpgsql as $$
declare
  orig bigint;
  others bigint;
begin
  if new.doc_type <> 'credit_note' or new.status <> 'issued' or old.status = 'issued' or new.original_document_id is null then
    return new;
  end if;
  select taxable_paise into orig from document where id = new.original_document_id for update;
  if orig is null then
    raise exception 'A credit note must point at an existing invoice.' using errcode = '23514';
  end if;
  select coalesce(sum(taxable_paise), 0) into others from document
   where original_document_id = new.original_document_id and doc_type = 'credit_note' and status = 'issued' and id <> new.id;
  if others + new.taxable_paise > orig then
    raise exception 'Credit notes for this invoice would together exceed its value.' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists document_credit_total on document;
create trigger document_credit_total before update on document for each row execute function credit_total_guard();

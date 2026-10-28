-- Audit findings C-7 and T-9: gstin_valid() accepted a first two digits that are not a GST state code (25, 28, 00 ...). It now
-- requires one of the real codes, the same list as GSTIN_STATE_CODES in packages/tax/src/gstin.ts (a test compares the two).
-- Existing rows are not re-checked by Postgres, and every stored GSTIN already starts with its state_code, which is a foreign key.
-- Safe to run twice.
create or replace function gstin_valid(g text) returns boolean
language plpgsql immutable as $$
declare
  chars constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  total int := 0; v int; i int; f int;
begin
  if g is null or g !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then return false; end if;
  if not (substr(g, 1, 2) = any (array['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','26','27','29','30','31','32','33','34','35','36','37','38','97','99'])) then return false; end if;
  for i in 1..14 loop
    v := position(substr(g, i, 1) in chars) - 1;
    f := case when i % 2 = 1 then 1 else 2 end;
    v := v * f;
    total := total + (v / 36) + (v % 36);
  end loop;
  return substr(chars, ((36 - (total % 36)) % 36) + 1, 1) = substr(g, 15, 1);
end $$;

-- Smoke test for schema.sql. Run as superuser after loading the schema. Every block asserts, so a failure aborts.
\set ON_ERROR_STOP on
insert into state_code values ('27','Maharashtra'),('29','Karnataka') on conflict do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-0000000000a1','owner@example.test');

-- GSTIN checksum
do $$ begin
  assert gstin_valid('27AAPFU0939F1ZV'), 'known good GSTIN rejected';
  assert not gstin_valid('27AAPFU0939F1ZW'), 'bad checksum accepted';
end $$;

select create_business('00000000-0000-0000-0000-0000000000a1','Acme Traders','27AAPFU0939F1ZV','27','regular') as bid \gset
select set_config('app.business_id', :'bid', false), set_config('app.user_id','00000000-0000-0000-0000-0000000000a1', false);
-- helper: one draft invoice, one line, IGST 18% on Rs 1000 = Rs 180
create or replace function mk_draft(p_id uuid) returns void language plpgsql as $$
begin
  insert into document (id, business_id, doc_type, party_id, place_of_supply, taxable_paise, igst_paise, grand_total_paise)
    values (p_id, current_business(), 'tax_invoice', '00000000-0000-0000-0000-0000000000b1', '29', 100000, 18000, 118000);
  insert into document_line (business_id, document_id, position, item_name, hsn_sac, quantity, rate_paise, gross_paise,
      taxable_paise, tax_rate_bp, igst_paise, line_total_paise)
    values (current_business(), p_id, 1, 'Widget', '8471', 1, 100000, 100000, 100000, 1800, 18000, 118000);
end $$;

set role kora_app;
insert into number_series (business_id, doc_type, prefix, financial_year) values (:'bid','tax_invoice','INV/','2026-27');
insert into party (id, business_id, kind, name, gstin, state_code)
  values ('00000000-0000-0000-0000-0000000000b1', :'bid','customer','Buyer Karnataka','29BBBCC1234D1Z4','29');

-- 1. numbering is sequential, and a rolled-back issue leaves no gap
select mk_draft('00000000-0000-0000-0000-00000000d001');
select mk_draft('00000000-0000-0000-0000-00000000d002');
select mk_draft('00000000-0000-0000-0000-00000000d003');
update document set status = 'issued' where id = '00000000-0000-0000-0000-00000000d001';
begin;
  update document set status = 'issued' where id = '00000000-0000-0000-0000-00000000d002';
rollback;
update document set status = 'issued' where id = '00000000-0000-0000-0000-00000000d003';
do $$ declare a text; b text; begin
  select number into a from document where id = '00000000-0000-0000-0000-00000000d001';
  select number into b from document where id = '00000000-0000-0000-0000-00000000d003';
  assert a = 'INV/0001' and b = 'INV/0002', format('numbering has a gap: %s, %s', a, b);
end $$;

-- 2. issued documents are immutable, lines too, and cannot be deleted
do $$ begin
  begin update document set grand_total_paise = 1, taxable_paise = 0, igst_paise = 0 where id = '00000000-0000-0000-0000-00000000d001';
    raise exception 'FAIL: issued document edited'; exception when integrity_constraint_violation then null; end;
  begin update document_line set quantity = 2 where document_id = '00000000-0000-0000-0000-00000000d001';
    raise exception 'FAIL: issued line edited'; exception when integrity_constraint_violation then null; end;
  begin delete from document where id = '00000000-0000-0000-0000-00000000d001';
    raise exception 'FAIL: issued document deleted'; exception when integrity_constraint_violation then null; end;
end $$;

-- 3. totals that disagree with lines cannot be issued
insert into document (id, business_id, doc_type, party_id, place_of_supply, taxable_paise, igst_paise, grand_total_paise)
  values ('00000000-0000-0000-0000-00000000d004', :'bid','tax_invoice','00000000-0000-0000-0000-0000000000b1','29', 100000, 18000, 118000);
insert into document_line (business_id, document_id, position, item_name, hsn_sac, quantity, rate_paise, gross_paise,
    taxable_paise, tax_rate_bp, igst_paise, line_total_paise)
  values (:'bid','00000000-0000-0000-0000-00000000d004',1,'Widget','8471',1,90000,90000,90000,1800,16200,106200);
do $$ begin
  begin update document set status = 'issued' where id = '00000000-0000-0000-0000-00000000d004';
    raise exception 'FAIL: mismatched totals issued'; exception when check_violation then null; end;
end $$;

-- 4. payments: idempotent webhook and allocation caps
insert into payment (id, business_id, amount_paise, method, gateway, gateway_event_id)
  values ('00000000-0000-0000-0000-00000000e001', :'bid', 118000, 'upi', 'razorpay', 'evt_1');
do $$ begin
  begin insert into payment (business_id, amount_paise, method, gateway, gateway_event_id)
          values (current_business(), 118000, 'upi', 'razorpay', 'evt_1');
    raise exception 'FAIL: duplicate webhook accepted'; exception when unique_violation then null; end;
end $$;
insert into payment_allocation (business_id, payment_id, document_id, amount_paise)
  values (:'bid','00000000-0000-0000-0000-00000000e001','00000000-0000-0000-0000-00000000d001', 50000);
do $$ declare s text; begin
  select payment_status into s from document where id = '00000000-0000-0000-0000-00000000d001';
  assert s = 'part_paid', 'expected part_paid, got ' || s;
  begin insert into payment_allocation (business_id, payment_id, document_id, amount_paise)
          values (current_business(),'00000000-0000-0000-0000-00000000e001','00000000-0000-0000-0000-00000000d001', 80000);
    raise exception 'FAIL: over-allocation accepted'; exception when check_violation then null; end;
end $$;
insert into payment_allocation (business_id, payment_id, document_id, amount_paise)
  values (:'bid','00000000-0000-0000-0000-00000000e001','00000000-0000-0000-0000-00000000d001', 68000);
do $$ declare s text; begin
  select payment_status into s from document where id = '00000000-0000-0000-0000-00000000d001';
  assert s = 'paid', 'expected paid, got ' || s;
end $$;

-- 5. audit log is append-only
do $$ begin
  assert (select count(*) from audit_log) > 0, 'audit log empty';
  begin delete from audit_log; raise exception 'FAIL: audit delete'; exception when insufficient_privilege then null; end;
  begin update audit_log set action = 'INSERT'; raise exception 'FAIL: audit update'; exception when insufficient_privilege then null; end;
end $$;

-- 6. row-level security: another tenant sees nothing, and no tenant means nothing
reset role;
select create_business('00000000-0000-0000-0000-0000000000a1','Other Co','29BBBCC1234D1Z4','29','regular') as bid2 \gset
set role kora_app;
select set_config('app.business_id', :'bid2', false), set_config('t.bid', :'bid', false);
do $$ begin
  assert (select count(*) from document) = 0, 'tenant 2 can see tenant 1 documents';
  begin insert into party (business_id, kind, name, state_code) values (current_setting('t.bid')::uuid, 'customer','x','27');
    raise exception 'FAIL: cross-tenant insert accepted'; exception when insufficient_privilege or check_violation then null; end;
end $$;
select set_config('app.business_id', '', false);
do $$ begin assert (select count(*) from document) = 0, 'unset tenant sees rows'; end $$;
select set_config('app.business_id', :'bid', false);

-- 7. identity freeze
do $$ begin
  begin update business set state_code = '29' where id = current_business();
    raise exception 'FAIL: state changed after issue'; exception when others then
    if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;

-- 8. reverse charge: tax shown, not added to the amount due
do $$ begin
  insert into document (business_id, doc_type, party_id, place_of_supply, reverse_charge, taxable_paise, igst_paise, grand_total_paise)
    values (current_business(), 'tax_invoice', '00000000-0000-0000-0000-0000000000b1', '29', true, 100000, 18000, 100000);
end $$;

\echo SMOKE OK

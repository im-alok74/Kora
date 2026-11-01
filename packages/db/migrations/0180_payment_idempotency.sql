-- P-6: a client that retries "record this payment" after a timeout must not record the money twice. A caller may now send an
-- Idempotency-Key with a payment; the same key for the same business names the same payment. Additive and safe to run twice.

alter table payment add column if not exists idempotency_key text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payment_idempotency_key_shape') then
    alter table payment add constraint payment_idempotency_key_shape
      check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9_-]{8,64}$');
  end if;
end $$;

create unique index if not exists payment_idempotency_key on payment (business_id, idempotency_key) where idempotency_key is not null;

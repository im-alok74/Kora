-- Phase 6.1: e-way bill. The table already holds the number, validity and transport details, and already has row-level security,
-- an audit trigger and grants. These columns keep what was sent and what came back (so a bill can be explained later), when it was
-- made, and why and when it was cancelled.
alter table eway_bill
  add column trans_mode text not null default '1' check (trans_mode in ('1', '2', '3', '4')),
  add column payload jsonb,
  add column response jsonb,
  add column generated_at timestamptz,
  add column cancelled_at timestamptz,
  add column cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 100);

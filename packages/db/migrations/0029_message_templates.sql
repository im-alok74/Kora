-- Phase 4.3: the words a business uses when it sends an invoice or a reminder, with placeholders such as {customer} and {link}.
-- Null means "use Kora's wording". The text is checked when it is saved: only known placeholders, and the link is always there.
alter table business
  add column message_templates jsonb check (message_templates is null or jsonb_typeof(message_templates) = 'object');

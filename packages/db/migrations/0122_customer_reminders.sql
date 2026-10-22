-- Night 2: reminder schedules per customer. Null means "use the business's schedule". Otherwise the same shape as
-- business.reminder_config: { enabled, channel, offsets }, where offsets are days from the due date (negative is before).
-- Additive only: one nullable column.
alter table party
  add column reminder_override jsonb check (reminder_override is null or jsonb_typeof(reminder_override) = 'object');

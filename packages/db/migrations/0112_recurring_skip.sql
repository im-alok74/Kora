-- Night 1, step 3: a recurring invoice's next date can be skipped. A skipped date is recorded as a run, so the history says what happened.
alter table recurring_run drop constraint recurring_run_status_check;
alter table recurring_run add constraint recurring_run_status_check check (status in ('pending', 'created', 'failed', 'skipped'));

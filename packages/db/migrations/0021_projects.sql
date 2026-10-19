-- Projects: the same billing engine as legal matters (time, fixed fees, expenses, advances, invoice from the entries),
-- for freelancers and small agencies. A project is a matter of another kind, so nothing is copied.
alter table matter add column kind text not null default 'matter' check (kind in ('matter', 'project'));
create index on matter (business_id, kind, status, created_at desc);

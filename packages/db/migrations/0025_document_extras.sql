-- Phase 1 of the roadmap: default notes and terms per business, up to five extra label and value pairs on a document,
-- and a salesperson name on a document. The document columns freeze with the rest of the row when it is issued.
alter table business
  add column default_notes text check (default_notes is null or length(default_notes) <= 2000),
  add column default_terms text check (default_terms is null or length(default_terms) <= 2000);

alter table document
  add column extra jsonb check (extra is null or (jsonb_typeof(extra) = 'array' and jsonb_array_length(extra) <= 5)),
  add column salesperson text check (salesperson is null or length(salesperson) <= 80);

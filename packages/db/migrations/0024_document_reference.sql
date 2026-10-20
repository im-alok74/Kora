-- A buyer's order or PO reference, a one-line subject, and the payment terms a document was made with.
-- They are plain text on the document. Once a document is issued the row is frozen by the existing trigger, so these freeze with it.
alter table document
  add column reference text check (reference is null or length(reference) <= 60),
  add column subject text check (subject is null or length(subject) <= 200),
  add column payment_terms text check (payment_terms is null or payment_terms in ('receipt', 'net15', 'net30', 'net45', 'net60', 'eom', 'custom'));

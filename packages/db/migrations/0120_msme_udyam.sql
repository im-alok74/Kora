-- Night 2, ROADMAP 6.5: MSME payment-due warnings. A vendor can carry its Udyam registration number and its class.
-- Micro and small suppliers must be paid within 45 days of the bill (MSMED Act section 15); Kora warns before the day.
-- Additive only: two nullable columns on party. Nothing existing changes.
alter table party
  add column udyam_number text check (udyam_number is null or udyam_number ~ '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$'),
  add column msme_class text check (msme_class is null or msme_class in ('micro', 'small', 'medium')),
  add constraint party_udyam_needs_class check (udyam_number is null or msme_class is not null);

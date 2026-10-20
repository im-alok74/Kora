-- Phase 5: importing invoices from a spreadsheet leaves a record like the other imports and exports do.
alter table data_export drop constraint data_export_kind_check;
alter table data_export add constraint data_export_kind_check
  check (kind in ('workbook', 'backup', 'tally', 'import_customers', 'import_items', 'import_invoices'));

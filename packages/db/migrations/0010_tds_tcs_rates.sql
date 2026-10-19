-- The rates behind the TDS and TCS amounts, so a saved draft reopens with the same percentages the person typed.
-- In basis points: 100 = 1%. The amounts themselves (tcs_paise, tds_paise) stay the source of truth for issued documents.
alter table document
  add column tcs_bp int not null default 0 check (tcs_bp between 0 and 10000),
  add column tds_bp int not null default 0 check (tds_bp between 0 and 10000);

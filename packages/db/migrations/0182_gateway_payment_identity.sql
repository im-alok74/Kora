-- Stop one provider payment creating multiple receipts under different event IDs.
-- Existing duplicates must be reconciled before applying this index; never delete financial rows automatically.
create unique index payment_gateway_identity on payment (gateway, gateway_payment_id)
  where gateway is not null and gateway_payment_id is not null;

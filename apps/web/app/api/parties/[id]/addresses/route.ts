import { createPartyAddress, listPartyAddresses, type PartyAddressInput } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

/** This customer's address book: { addresses: [{ id, label, address, state_code, is_default_billing, is_default_shipping }] }. */
export const GET = tenantRoute(async ({ t, sql, params }) => ({ addresses: await listPartyAddresses(sql, t, params.id!) }));
/** Body: { label, address?, stateCode, isDefaultBilling?, isDefaultShipping? }. */
export const POST = tenantRoute(async ({ t, sql, req, params }) => ({ id: await createPartyAddress(sql, t, params.id!, await readJson<PartyAddressInput>(req)) }));

import { archivePartyAddress, setDefaultAddress, updatePartyAddress, type PartyAddressInput } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../../lib/server';

export const PUT = tenantRoute(async ({ t, sql, req, params }) => { await updatePartyAddress(sql, t, params.addressId!, await readJson<PartyAddressInput>(req)); });
/** Body: { kind: 'billing' | 'shipping' }. Marks this as where the bill goes, or where the goods go. */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  const b = await readJson<{ kind?: string }>(req);
  await setDefaultAddress(sql, t, params.id!, params.addressId!, b.kind as 'billing' | 'shipping');
});
export const DELETE = tenantRoute(async ({ t, sql, params }) => { await archivePartyAddress(sql, t, params.addressId!); });

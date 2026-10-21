import { archiveContactPerson, setPrimaryContactPerson, updateContactPerson, type ContactPersonInput } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../../lib/server';

export const PUT = tenantRoute(async ({ t, sql, req, params }) => { await updateContactPerson(sql, t, params.contactId!, await readJson<ContactPersonInput>(req)); });
/** Makes this the one person to write to. */
export const POST = tenantRoute(async ({ t, sql, params }) => { await setPrimaryContactPerson(sql, t, params.id!, params.contactId!); });
export const DELETE = tenantRoute(async ({ t, sql, params }) => { await archiveContactPerson(sql, t, params.contactId!); });

import { createContactPerson, listContactPersons, type ContactPersonInput } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

/** The people at this customer: { contacts: [{ id, name, designation, email, phone, is_primary }] }. */
export const GET = tenantRoute(async ({ t, sql, params }) => ({ contacts: await listContactPersons(sql, t, params.id!) }));
/** Body: { name, designation?, email?, phone?, isPrimary? }. */
export const POST = tenantRoute(async ({ t, sql, req, params }) => ({ id: await createContactPerson(sql, t, params.id!, await readJson<ContactPersonInput>(req)) }));

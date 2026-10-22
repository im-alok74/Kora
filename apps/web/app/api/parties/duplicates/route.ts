import { findDuplicateParties } from '@kora/core';
import { tenantRoute } from '../../../../lib/server';

/** Customers and vendors that look like the same one. */
export const GET = tenantRoute(async ({ t, sql }) => ({ groups: await findDuplicateParties(sql, t) }));

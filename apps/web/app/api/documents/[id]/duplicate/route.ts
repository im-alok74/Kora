import { duplicateDocument } from '@kora/core';
import { tenantRoute } from '../../../../../lib/server';

/** A new draft copied from this document. Returns { id, warnings }. */
export const POST = tenantRoute(async ({ t, sql, params }) => duplicateDocument(sql, t, params.id!));

import { noteContext } from '@kora/core';
import { tenantRoute } from '../../../../../lib/server';

/** What the guided credit and debit note screen needs about an invoice: its lines, what is already credited, and the reasons on offer. */
export const GET = tenantRoute(async ({ t, sql, params }) => noteContext(sql, t, params.id!));

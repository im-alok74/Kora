import { createLateFeeDebitNote, lateFeeStatus } from '@kora/core';
import { tenantRoute } from '../../../../../lib/server';

/** GET: what late fee has built up on this invoice. POST: make a draft debit note for it (the owner issues it). */
export const GET = tenantRoute(async ({ t, sql, params }) => lateFeeStatus(sql, t, params.id!));
export const POST = tenantRoute(async ({ t, sql, params }) => createLateFeeDebitNote(sql, t, params.id!));

import { issueDocument } from '@kora/core';
import { tenantRoute } from '../../../../../lib/server';

export const POST = tenantRoute(async ({ t, sql, params }) => issueDocument(sql, t, params.id!));

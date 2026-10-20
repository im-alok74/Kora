import { removeComment } from '@kora/core';
import { tenantRoute } from '../../../../../../lib/server';

export const DELETE = tenantRoute(async ({ t, sql, params }) => { await removeComment(sql, t, params.id!, params.commentId!); });

import { getMatter } from '@kora/core';
import { v1Route } from '../../../../../lib/apiV1';

export const GET = v1Route({}, async ({ t, sql, params }) => getMatter(sql, t, params.id!));

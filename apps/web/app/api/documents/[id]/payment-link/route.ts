import { createPaymentLink, getPaymentLinks } from '@kora/core';
import { tenantRoute } from '../../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => ({ links: await getPaymentLinks(sql, t, params.id!) }));
export const POST = tenantRoute(async ({ t, sql, params, svc }) => createPaymentLink(sql, t, svc.gateway, params.id!));

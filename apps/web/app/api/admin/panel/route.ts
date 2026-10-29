import {
  adminAudit, adminBreaches, adminBusiness, adminBusinesses, adminJobs, adminOverview, adminPrivacyRequests, adminRecordBreach, adminResolvePrivacyRequest,
  adminRetryJobs, adminRevokeSessions, adminSetPlan, adminUpdateBreach, adminUsers,
} from '@kora/core';
import { adminRoute, json } from '../../../../lib/server';

/**
 * The admin panel's one endpoint. Only for signed in staff on KORA_ADMIN_EMAILS who used an authenticator code; anyone else gets 404.
 *   GET ?view=overview | businesses&q= | business&id= | users&q= | privacy&open=1 | breaches | jobs | audit
 *   POST { action: 'plan.set' | 'sessions.revoke' | 'privacy.resolve' | 'breach.record' | 'breach.update' | 'jobs.retry', ... }
 */
export const GET = adminRoute(async ({ sql, req }) => {
  const q = new URL(req.url).searchParams;
  switch (q.get('view')) {
    case 'overview': return adminOverview(sql);
    case 'businesses': return adminBusinesses(sql, q.get('q') ?? '', 50, Number(q.get('offset') ?? 0) || 0);
    case 'business': return adminBusiness(sql, q.get('id') ?? '');
    case 'users': return adminUsers(sql, q.get('q') ?? '');
    case 'privacy': return adminPrivacyRequests(sql, q.get('open') === '1');
    case 'breaches': return adminBreaches(sql);
    case 'jobs': return adminJobs(sql);
    case 'audit': return adminAudit(sql);
    default: return json({ error: 'Unknown view.' }, 400);
  }
});

export const POST = adminRoute(async ({ adminId, sql, req }) => {
  const b = await req.json().catch(() => ({})) as Record<string, any>;
  switch (b.action) {
    case 'plan.set': await adminSetPlan(sql, adminId, { businessId: b.businessId, plan: b.plan, status: b.status, validUntil: b.validUntil || null, note: b.note }); return { ok: true };
    case 'sessions.revoke': return { revoked: await adminRevokeSessions(sql, adminId, b.userId) };
    case 'privacy.resolve': await adminResolvePrivacyRequest(sql, adminId, { id: b.id, status: b.status, resolution: b.resolution }); return { ok: true };
    case 'breach.record': return { id: await adminRecordBreach(sql, adminId, { discoveredAt: b.discoveredAt, summary: b.summary, dataAffected: b.dataAffected, peopleAffected: b.peopleAffected === '' || b.peopleAffected == null ? null : Number(b.peopleAffected), contained: !!b.contained }) };
    case 'breach.update': await adminUpdateBreach(sql, adminId, { id: b.id, contained: b.contained, boardNotifiedAt: b.boardNotifiedAt || undefined, peopleNotifiedAt: b.peopleNotifiedAt || undefined, notes: b.notes }); return { ok: true };
    case 'jobs.retry': return { requeued: await adminRetryJobs(sql, adminId, b.queue || undefined) };
    default: return json({ error: 'Unknown action.' }, 400);
  }
});

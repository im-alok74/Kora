import { consentStates, listPrivacyRequests, NOTICE_VERSION, openPrivacyRequest, personalDataExport, setConsent } from '@kora/core';
import { json, userRoute } from '../../../lib/server';

/**
 * The signed in person's own privacy: what they agreed to, their requests, and a copy of their data (DPDP Act).
 *   GET                  { noticeVersion, consents, requests }
 *   GET ?export=1        the personal data export as a JSON download
 *   POST { action: 'consent.set', purpose, given }
 *   POST { action: 'request.open', kind, details? }   kind: access, correction, erasure, grievance, nomination
 */
export const GET = userRoute(async ({ userId, svc, req }) => {
  if (new URL(req.url).searchParams.get('export')) {
    const data = await personalDataExport(svc.sql, userId);
    return json(data, 200, { 'content-disposition': 'attachment; filename="kora-my-data.json"' });
  }
  const [consents, requests] = await Promise.all([consentStates(svc.sql, userId), listPrivacyRequests(svc.sql, userId)]);
  return { noticeVersion: NOTICE_VERSION, consents, requests };
});

export const POST = userRoute(async ({ userId, svc, req }) => {
  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  switch (b.action) {
    case 'consent.set': await setConsent(svc.sql, userId, String(b.purpose ?? ''), b.given === true, 'privacy_page'); return { ok: true };
    case 'request.open': return openPrivacyRequest(svc.sql, userId, { kind: String(b.kind ?? ''), details: String(b.details ?? '') });
    default: return json({ error: 'Unknown action.' }, 400);
  }
});

import { createBusiness } from '@kora/core';
import { currentUserId, errorResponse, json, requireJson, services } from '../../../lib/server';

const TYPES = ['unregistered', 'regular', 'composition', 'sez', 'isd'] as const;

export async function POST(req: Request) {
  const bad = requireJson(req);
  if (bad) return bad;
  const userId = await currentUserId();
  if (!userId) return json({ error: 'Sign in first.' }, 401);
  try {
    const b = (await req.json()) as { legalName?: string; gstin?: string; stateCode?: string; registrationType?: string };
    const legalName = String(b.legalName ?? '').trim();
    const registrationType = b.registrationType as (typeof TYPES)[number];
    if (!legalName || legalName.length > 200) return json({ error: 'Enter the legal name of the business.' }, 400);
    if (!TYPES.includes(registrationType)) return json({ error: 'Choose a registration type.' }, 400);
    const gstin = registrationType === 'unregistered' ? null : String(b.gstin ?? '').trim().toUpperCase();
    const id = await createBusiness(services().sql, userId, {
      legalName, gstin, stateCode: String(b.stateCode ?? ''), registrationType,
    });
    return json({ businessId: id }, 201);
  } catch (e) {
    // GSTIN checksum, state mismatch and duplicate GSTIN are caught by the database constraints.
    const pg = (e as { code?: string }).code;
    if (pg === '23505') return json({ error: 'A business with that GSTIN already exists.' }, 409);
    if (pg === '23514') return json({ error: 'The GSTIN is not valid for that state.' }, 400);
    if (pg === '23503') return json({ error: 'Choose a valid state.' }, 400);
    return errorResponse(e);
  }
}

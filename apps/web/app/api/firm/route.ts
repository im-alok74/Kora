import { firmSummary } from '@kora/core';
import { currentUserId, errorResponse, json, services } from '../../../lib/server';

/** A roll-up across every business the signed-in person belongs to. Each business is read with that person's own role. */
export async function GET() {
  try {
    const userId = await currentUserId();
    if (!userId) return json({ error: 'Sign in first.' }, 401);
    return json(await firmSummary(services().sql, userId));
  } catch (e) {
    return errorResponse(e);
  }
}

import { listBusinesses } from '@kora/core';
import { currentUserId, json, services } from '../../../lib/server';

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return json({ error: 'Sign in first.' }, 401);
  return json({ userId, businesses: await listBusinesses(services().sql, userId) });
}

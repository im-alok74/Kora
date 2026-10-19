import { json, services } from '../../../lib/server';

export const dynamic = 'force-dynamic';

/** For load balancers and uptime checks. Reports only up or down, never details. */
export async function GET() {
  try {
    await services().sql`select 1`;
    return json({ status: 'ok' });
  } catch {
    return json({ status: 'down' }, 503);
  }
}

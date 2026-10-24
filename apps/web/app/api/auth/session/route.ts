import { currentUserId, json } from '../../../../lib/server';

/** Whether this browser is signed in. Always 200, so the sign-in page can ask without a 401 showing in the console. */
export async function GET() {
  return json({ signedIn: !!(await currentUserId()) });
}

import { gstinValid } from '@kora/tax';
import { userRoute } from '../../../../lib/server';
import { publicLimit } from '../../../../lib/publicLimit';

/**
 * For the set-up screen, before the business exists. Checks the GSTIN and fills what it contains (the state). The legal name and
 * address come back only when a GST partner is connected; until then the form asks for the name.
 */
export const GET = userRoute(async ({ params, svc }) => {
  const limited = await publicLimit('gstin', 120);
  if (limited) return limited;
  const g = (params.gstin ?? '').trim().toUpperCase();
  if (g.length !== 15) return { valid: false, reason: 'A GSTIN has 15 characters.' };
  if (!gstinValid(g)) return { valid: false, reason: 'This GSTIN is not valid. Check the last character.' };
  return { valid: true, info: await svc.gstin.lookup(g) };
});

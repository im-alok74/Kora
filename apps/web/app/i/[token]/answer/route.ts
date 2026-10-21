import { isValidationError, publicAnswerEstimate } from '@kora/core';
import { services } from '../../../../lib/server';

export const runtime = 'nodejs';

/** The customer's answer from the public quote page: a plain form post, so it works with no scripts. */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const back = (q: string) => new Response(null, { status: 303, headers: { location: `/i/${token}?${q}`, 'cache-control': 'no-store' } });
  try {
    const form = await req.formData();
    const action = String(form.get('action') ?? '');
    if (action !== 'accept' && action !== 'decline') return back('answer=invalid');
    const r = await publicAnswerEstimate(services().sql, token, action === 'accept' ? 'accepted' : 'declined', {
      comment: String(form.get('comment') ?? ''), name: String(form.get('name') ?? ''),
    });
    return r ? back('answered=1') : new Response('This link is not valid.', { status: 404 });
  } catch (e) {
    if (isValidationError(e)) return back(`problem=${encodeURIComponent((e as Error).message)}`);
    throw e;
  }
}

import { getFee, markFeeBilled, markFeePaid, setFee, waiveFee } from '@kora/core';
import { firmRoute } from '../../../../../../lib/firmroute';
import { readJson } from '../../../../../../lib/server';

type Ctx = { params: Promise<{ id: string }> };
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => ({ fee: await getFee(sql, s, id) }))(req);
}
/** { action: "set", amount, description? } | { action: "billed", reference, billedOn? } | { action: "paid", paidOn? } | { action: "waive", reason } */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => {
    const b = await readJson<{ action?: string; amount?: string; description?: string; reference?: string; billedOn?: string; paidOn?: string; reason?: string }>(req.clone());
    switch (b.action) {
      case 'set': await setFee(sql, s, id, { amount: String(b.amount ?? ''), description: b.description }); break;
      case 'billed': await markFeeBilled(sql, s, id, { reference: String(b.reference ?? ''), billedOn: typeof b.billedOn === 'string' ? b.billedOn : undefined }); break;
      case 'paid': await markFeePaid(sql, s, id, typeof b.paidOn === 'string' ? b.paidOn : undefined); break;
      case 'waive': await waiveFee(sql, s, id, String(b.reason ?? '')); break;
      default: return Response.json({ error: 'Choose set, billed, paid or waive.' }, { status: 400 });
    }
    return { ok: true };
  })(req);
}

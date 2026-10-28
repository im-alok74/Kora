import type { Sql, Tx } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';

/**
 * The plans and what each allows. Prices are placeholders until the owner sets them (see docs/pricing.md); the limits are the
 * ones the pricing page shows. null means no limit. Change a number here and the pricing page, the checks and the API rate limit
 * all follow.
 */
export type PlanId = 'starter' | 'business' | 'firm';
export interface PlanLimits {
  invoicesPerMonth: number | null;   // invoices, bills of supply, quotes, proformas and orders issued in a calendar month
  members: number;                    // people in the business, including the owner
  apiPerMinute: number;               // requests a minute for each API key
  messaging: boolean;                 // sending documents by WhatsApp, SMS and email
  reminders: boolean;                 // scheduled payment reminders
  recurring: boolean;                 // recurring invoices
}
export interface Plan { id: PlanId; name: string; pricePaise: number; limits: PlanLimits }

export const PLANS: Readonly<Record<PlanId, Plan>> = {
  starter: { id: 'starter', name: 'Starter', pricePaise: 0, limits: { invoicesPerMonth: 10, members: 1, apiPerMinute: 30, messaging: false, reminders: false, recurring: false } },
  business: { id: 'business', name: 'Business', pricePaise: 49_900, limits: { invoicesPerMonth: null, members: 3, apiPerMinute: 120, messaging: true, reminders: true, recurring: true } },
  firm: { id: 'firm', name: 'Firm', pricePaise: 199_900, limits: { invoicesPerMonth: null, members: 25, apiPerMinute: 300, messaging: true, reminders: true, recurring: true } },
};
export const isPlanId = (p: string): p is PlanId => p in PLANS;

/** Counted against the monthly limit. Credit and debit notes are never limited: they correct an invoice and the law needs them. */
export const LIMITED_DOC_TYPES = ['tax_invoice', 'bill_of_supply', 'estimate', 'proforma', 'delivery_challan', 'sales_order'] as const;

/** A limit of the plan was reached. 402 in the web layer, with a plain message that says what to do. */
export class PlanLimitError extends Error {
  code = 'plan_limit' as const;
  constructor(message: string, public feature: string, public plan: PlanId) { super(message); this.name = 'PlanLimitError'; }
}
export const isPlanLimitError = (e: unknown): e is PlanLimitError => e instanceof Error && e.name === 'PlanLimitError';

/** Limits are applied only when KORA_PLANS=enforce, so a deployment can be switched over on purpose (see the launch checklist). */
export const plansEnforced = (env: Record<string, string | undefined> = process.env) => env.KORA_PLANS === 'enforce';

/** After a paid period ends or a payment fails, the paid plan stays for this long before the business falls back to starter. */
export const GRACE_DAYS = 7;

export interface EffectivePlan { plan: Plan; stored: PlanId; status: string; validUntil: string | null; lapsed: boolean }

/** What the business is on right now. A paid plan that has run out (past the grace days) counts as starter. */
export async function effectivePlanTx(tx: Tx, businessId: string): Promise<EffectivePlan> {
  const [r] = await tx`select plan, status, valid_until::text as valid_until,
                               (valid_until is not null and valid_until + make_interval(days => ${GRACE_DAYS}) < now()) as lapsed,
                               (valid_until is not null and valid_until > now()) as in_period
                          from business_plan where business_id = ${businessId}`;
  if (!r) return { plan: PLANS.starter, stored: 'starter', status: 'free', validUntil: null, lapsed: false };
  const stored = r.plan as PlanId, status = r.status as string, lapsed = !!r.lapsed;
  // A cancelled subscription keeps its plan to the end of the period that was paid for.
  const paidAndLive = stored !== 'starter' && !lapsed && (['active', 'trialing', 'past_due'].includes(status) || (status === 'cancelled' && !!r.in_period));
  return { plan: paidAndLive ? PLANS[stored] : PLANS.starter, stored, status, validUntil: (r.valid_until as string | null) ?? null, lapsed };
}

export async function getPlan(sql: Sql, t: TenantSession): Promise<EffectivePlan> {
  return inTenant(sql, t, 'report.read', (tx) => effectivePlanTx(tx, t.businessId));
}

const upgrade = 'Choose a plan on the Billing page to go on.';

/** Throws PlanLimitError when the plan does not include the feature. No-op unless plans are enforced. */
export async function requireFeature(tx: Tx, businessId: string, feature: 'messaging' | 'reminders' | 'recurring'): Promise<void> {
  if (!plansEnforced()) return;
  const { plan } = await effectivePlanTx(tx, businessId);
  if (plan.limits[feature]) return;
  const what = { messaging: 'Sending by WhatsApp, SMS and email', reminders: 'Payment reminders', recurring: 'Recurring invoices' }[feature];
  throw new PlanLimitError(`${what} is not part of the ${plan.name} plan. ${upgrade}`, feature, plan.id);
}

/** Invoices and quotes issued this calendar month (India time). */
export async function issuedThisMonth(tx: Tx, businessId: string): Promise<number> {
  const [r] = await tx`select count(*)::int as n from document
                        where business_id = ${businessId} and status = 'issued' and doc_type = any(${[...LIMITED_DOC_TYPES]}::text[])
                          and issued_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'`;
  return r!.n as number;
}

/** Called before a document is issued. */
export async function checkCanIssue(tx: Tx, businessId: string, docType: string): Promise<void> {
  if (!plansEnforced() || !(LIMITED_DOC_TYPES as readonly string[]).includes(docType)) return;
  const { plan } = await effectivePlanTx(tx, businessId);
  const max = plan.limits.invoicesPerMonth;
  if (max === null) return;
  if ((await issuedThisMonth(tx, businessId)) >= max) {
    throw new PlanLimitError(`The ${plan.name} plan allows ${max} invoices and quotes a month, and this month's are used. ${upgrade}`, 'invoices', plan.id);
  }
}

/** Called before a person is added to the business. */
export async function checkCanAddMember(tx: Tx, businessId: string): Promise<void> {
  if (!plansEnforced()) return;
  const { plan } = await effectivePlanTx(tx, businessId);
  const [r] = await tx`select count(*)::int as n from member where business_id = ${businessId}`;
  if ((r!.n as number) >= plan.limits.members) {
    throw new PlanLimitError(`The ${plan.name} plan has room for ${plan.limits.members} ${plan.limits.members === 1 ? 'person' : 'people'}. ${upgrade}`, 'members', plan.id);
  }
}

/** What the Billing page shows: the plan, how much of each limit is used. */
export async function usageSummary(sql: Sql, t: TenantSession) {
  return inTenant(sql, t, 'report.read', async (tx) => {
    const ep = await effectivePlanTx(tx, t.businessId);
    const [m] = await tx`select count(*)::int as n from member where business_id = ${t.businessId}`;
    return { ...ep, enforced: plansEnforced(), usage: { invoicesThisMonth: await issuedThisMonth(tx, t.businessId), members: m!.n as number } };
  });
}

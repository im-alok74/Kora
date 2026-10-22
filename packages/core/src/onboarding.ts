import type { Sql } from '@kora/db';
import { getTemplate } from './template.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { ValidationError } from './validation.js';

/**
 * The first-run checklist. Whether a step is really finished is read from the business's own records, so it can never
 * disagree with them. The table holds only the person's choices: "done" for the invoice look, and "skipped" for any step.
 */
export const ONBOARDING_STEPS = ['business', 'logo', 'look', 'customer', 'invoice'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type StepState = 'done' | 'skipped' | 'todo';

export interface OnboardingState {
  steps: { key: OnboardingStep; state: StepState }[];
  /** The first step that is still to do, or null when everything is done or skipped. */
  next: OnboardingStep | null;
  finished: boolean;
}

/** Pure: combines what the records say with what the person chose. A record that exists always wins over "skipped". */
export function combineSteps(facts: Record<OnboardingStep, boolean>, chosen: Partial<Record<OnboardingStep, 'done' | 'skipped'>>): OnboardingState {
  const steps = ONBOARDING_STEPS.map((key) => ({ key, state: (facts[key] || chosen[key] === 'done' ? 'done' : chosen[key] === 'skipped' ? 'skipped' : 'todo') as StepState }));
  const next = steps.find((s) => s.state === 'todo')?.key ?? null;
  return { steps, next, finished: next === null };
}

export async function onboardingState(sql: Sql, t: TenantSession): Promise<OnboardingState> {
  const template = await getTemplate(sql, t);
  return inTenant(sql, t, 'document.read', async (tx) => {
    const [b] = await tx`select (address <> '{}'::jsonb) as has_address, (select count(*) from party where kind in ('customer','both') and archived_at is null)::int as customers,
                                (select count(*) from document where doc_type in ('tax_invoice','bill_of_supply'))::int as invoices from business where id = ${t.businessId}`;
    const rows = await tx`select step, state from onboarding_step`;
    const chosen: Partial<Record<OnboardingStep, 'done' | 'skipped'>> = {};
    for (const r of rows) chosen[r.step as OnboardingStep] = r.state as 'done' | 'skipped';
    return combineSteps({
      business: !!b!.has_address,
      logo: !!template.logoDataUrl,
      look: false,
      customer: (b!.customers as number) > 0,
      invoice: (b!.invoices as number) > 0,
    }, chosen);
  });
}

/** state "todo" clears the choice, so a skipped step can be picked up again. */
export async function setOnboardingStep(sql: Sql, t: TenantSession, step: string, state: string): Promise<void> {
  if (!ONBOARDING_STEPS.includes(step as OnboardingStep)) throw new ValidationError('Unknown step.', 'step');
  if (!['done', 'skipped', 'todo'].includes(state)) throw new ValidationError('Choose done, skipped or todo.', 'state');
  await inTenant(sql, t, 'document.read', async (tx) => {
    if (state === 'todo') { await tx`delete from onboarding_step where step = ${step}`; return; }
    await tx`insert into onboarding_step (business_id, step, state) values (${t.businessId}, ${step}, ${state})
             on conflict (business_id, step) do update set state = excluded.state`;
  });
}

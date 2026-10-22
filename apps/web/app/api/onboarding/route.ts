import { onboardingState, setOnboardingStep } from '@kora/core';
import { readJson, tenantRoute } from '../../../lib/server';

/** The first-run checklist for the active business. PUT { step, state: "done" | "skipped" | "todo" } remembers a choice. */
export const GET = tenantRoute(async ({ t, sql }) => ({ onboarding: await onboardingState(sql, t) }));
export const PUT = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson<{ step?: string; state?: string }>(req);
  await setOnboardingStep(sql, t, String(b.step ?? ''), String(b.state ?? ''));
  return { onboarding: await onboardingState(sql, t) };
});

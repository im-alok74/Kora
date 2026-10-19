import type { Instrumentation } from 'next';

/** Next calls this for every error thrown while rendering or handling a request. It goes to the log and, if SENTRY_DSN is set, to Sentry. */
export const onRequestError: Instrumentation.onRequestError = async (err, request) => {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { reportRequestError } = await import('./instrumentation-node');
    await reportRequestError(err, request);
  }
};

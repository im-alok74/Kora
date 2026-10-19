import type { Instrumentation } from 'next';

/** Next calls this for every error thrown while rendering or handling a request. It goes to the log and, if SENTRY_DSN is set, to Sentry. */
export const onRequestError: Instrumentation.onRequestError = async (err, request) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { reportError } = await import('@kora/core');
  await reportError(err, { event: 'next_error', path: request.path, method: request.method });
};

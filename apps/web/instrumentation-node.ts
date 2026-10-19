import { reportError } from '@kora/core';

/** Node-only part of the error hook, kept in its own file so the edge build never tries to bundle the server code. */
export async function reportRequestError(err: unknown, request: { path: string; method: string }) {
  await reportError(err, { event: 'next_error', path: request.path, method: request.method });
}

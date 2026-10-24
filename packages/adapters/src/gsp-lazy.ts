import { createHttpGsp, GspError, type GspClient } from './gsp.js';

/**
 * A GST partner client that is built the first time it is used. A missing GSP_URL then only breaks e-invoice and e-way bill
 * calls, with a plain message, instead of stopping the whole web app or the worker at start-up.
 * With no address every call fails with kind 'auth' (an operator must fix it), which the e-invoice job treats as retryable
 * and shows to the owner as "not connected yet".
 */
export function createLazyGsp(env: Record<string, string | undefined> = process.env, make: typeof createHttpGsp = createHttpGsp): GspClient {
  let client: GspClient | null = null;
  const get = (): GspClient => {
    if (client) return client;
    const baseUrl = (env.GSP_URL ?? '').trim();
    if (!baseUrl) throw new GspError('auth', 'gsp_not_configured', 'The GST partner is not connected yet, so e-invoices and e-way bills cannot be sent. Set GSP_URL.');
    client = make({ baseUrl, token: env.GSP_TOKEN, timeoutMs: Number(env.GSP_TIMEOUT_MS ?? 15_000) });
    return client;
  };
  return {
    generateIrn: async (p) => get().generateIrn(p),
    cancelIrn: async (a) => get().cancelIrn(a),
    getIrnByDocument: async (a) => get().getIrnByDocument(a),
    generateEwayBill: async (p) => get().generateEwayBill(p),
    cancelEwayBill: async (a) => get().cancelEwayBill(a),
  };
}

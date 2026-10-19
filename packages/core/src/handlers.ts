import type { GspClient, Messenger } from '@kora/adapters';
import type { Sql } from '@kora/db';
import { processDeliveryJob } from './delivery.js';
import { processEinvoiceJob } from './einvoice.js';
import type { Handlers } from './jobs.js';
import { processWebhookJob } from './webhooks.js';

export interface HandlerDeps { messenger: Messenger; appUrl: string; gsp: GspClient }

/** Every queue the worker serves. */
export function createHandlers(sql: Sql, deps: HandlerDeps): Handlers {
  return {
    'delivery.send': (job) => processDeliveryJob(sql, deps, job),
    'einvoice.register': (job) => processEinvoiceJob(sql, deps, job),
    'webhook.deliver': (job) => processWebhookJob(sql, job),
  };
}

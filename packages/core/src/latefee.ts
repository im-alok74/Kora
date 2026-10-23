import { allowedRatesOn } from '@kora/tax';
import type { Sql } from '@kora/db';
import { persist, type DocIn } from './documents.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { todayIn, ValidationError } from './validation.js';

/**
 * Late fees. Nothing is ever charged automatically: Kora works out what has built up on an overdue invoice and offers a
 * draft debit note, which the owner reads and issues. A late payment charge can attract GST, so it is a proper tax
 * document with its own number, not a quiet addition to the invoice.
 */
export interface LateFeeConfig {
  enabled: boolean;
  mode: 'percent_per_month' | 'flat';
  /** percent_per_month: basis points of the outstanding amount per 30 days (200 = 2%). flat: the fee in paise, charged once. */
  value: number;
  graceDays: number;
  /** GST rate on the fee, in basis points. */
  gstRateBp: number;
}
export const DEFAULT_LATE_FEE: LateFeeConfig = { enabled: false, mode: 'percent_per_month', value: 200, graceDays: 7, gstRateBp: 1800 };
export const LATE_FEE_SAC = '999799';   // other services not elsewhere classified; a CA should confirm this for the business

export function sanitiseLateFeeConfig(raw: unknown): LateFeeConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const mode = r.mode === undefined ? DEFAULT_LATE_FEE.mode : r.mode;
  if (mode !== 'percent_per_month' && mode !== 'flat') throw new ValidationError('Choose a percentage per month or a flat fee.', 'mode');
  const value = r.value === undefined ? DEFAULT_LATE_FEE.value : Number(r.value);
  if (!Number.isInteger(value) || value < 1) throw new ValidationError('The late fee must be more than zero.', 'value');
  if (mode === 'percent_per_month' && value > 1000) throw new ValidationError('A late fee above 10% a month is not allowed here.', 'value');
  if (mode === 'flat' && value > 10_000_000) throw new ValidationError('The flat fee is too large.', 'value');
  const graceDays = r.graceDays === undefined ? DEFAULT_LATE_FEE.graceDays : Number(r.graceDays);
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 90) throw new ValidationError('The grace period is 0 to 90 days.', 'graceDays');
  const gstRateBp = r.gstRateBp === undefined ? DEFAULT_LATE_FEE.gstRateBp : Number(r.gstRateBp);
  // The fee is a supply of its own, taxed at a slab in force today (12% and 28% ended on 22 September 2025).
  if (!Number.isInteger(gstRateBp) || !allowedRatesOn(new Date().toISOString().slice(0, 10)).has(gstRateBp)) throw new ValidationError('Choose a GST rate for the fee: 0%, 0.25%, 3%, 5%, 18% or 40%.', 'gstRateBp');
  return { enabled: r.enabled === true, mode, value, graceDays, gstRateBp };
}

const dayNumber = (d: string) => { const [y, m, dd] = d.split('-').map(Number) as [number, number, number]; return Math.floor(Date.UTC(y, m - 1, dd) / 86_400_000); };
const roundHalfUp = (n: bigint, d: bigint) => (n * 2n + d) / (2n * d);

/**
 * What has built up and not yet been charged. Days count from the end of the grace period, or from the date a previous
 * late fee was charged up to, whichever is later, so no day is charged twice. It uses what is still owed now, so a part
 * payment lowers the fee for the days after it. Percentage fees are simple, pro-rata by the day over 30.
 */
export function lateFee(i: { outstandingPaise: bigint; dueDate: string; today: string; cfg: LateFeeConfig; chargedThrough: string | null; chargedBefore: boolean }) {
  const graceEnds = dayNumber(i.dueDate) + i.cfg.graceDays;
  const from = Math.max(graceEnds, i.chargedThrough ? dayNumber(i.chargedThrough) : graceEnds);
  const days = Math.max(0, dayNumber(i.today) - from);
  if (i.outstandingPaise <= 0n || days <= 0) return { days: 0, feePaise: 0n };
  if (i.cfg.mode === 'flat') return { days, feePaise: i.chargedBefore ? 0n : BigInt(i.cfg.value) };
  return { days, feePaise: roundHalfUp(i.outstandingPaise * BigInt(i.cfg.value) * BigInt(days), 300_000n) };
}

export async function getLateFeeConfig(sql: Sql, t: TenantSession): Promise<LateFeeConfig> {
  const rows = await inTenant(sql, t, 'document.read', (tx) => tx`select late_fee_config from business where id = ${t.businessId}`);
  return sanitiseLateFeeConfig({ ...DEFAULT_LATE_FEE, ...(rows[0]?.late_fee_config as object) });
}

export async function saveLateFeeConfig(sql: Sql, t: TenantSession, input: unknown): Promise<LateFeeConfig> {
  const cfg = sanitiseLateFeeConfig(input);
  await inTenant(sql, t, 'settings.write', (tx) => tx`update business set late_fee_config = ${tx.json(cfg as never)} where id = ${t.businessId}`);
  return cfg;
}

async function assess(tx: import('@kora/db').Tx, t: TenantSession, invoiceId: string) {
  const [d] = await tx`select d.id, d.number, d.status, d.doc_type, d.party_id, d.due_date::text as due_date, d.grand_total_paise, d.amount_settled_paise,
                              b.timezone, b.gstin, b.registration_type, b.late_fee_config
                         from document d join business b on b.id = d.business_id where d.id = ${invoiceId}`;
  if (!d) throw new ValidationError('Invoice not found.');
  const cfg = sanitiseLateFeeConfig({ ...DEFAULT_LATE_FEE, ...(d.late_fee_config as object) });
  const charges = await tx`select c.id, c.fee_paise, c.charged_through::text as charged_through, c.debit_note_id, n.number, n.status
                             from late_fee_charge c join document n on n.id = c.debit_note_id where c.invoice_id = ${invoiceId} order by c.created_at`;
  const base = { cfg, charges: charges.map((c) => ({ id: c.id as string, feePaise: c.fee_paise as string, chargedThrough: c.charged_through as string, debitNoteId: c.debit_note_id as string, number: c.number as string | null, status: c.status as string })) };
  const out = (o: { eligible: boolean; reason?: string; days?: number; feePaise?: bigint; outstanding?: bigint; throughDate?: string }) =>
    ({ ...base, eligible: o.eligible, reason: o.reason ?? null, days: o.days ?? 0, feePaise: (o.feePaise ?? 0n).toString(), outstandingPaise: (o.outstanding ?? 0n).toString(), throughDate: o.throughDate ?? null, doc: d });
  if (!cfg.enabled) return out({ eligible: false, reason: 'Late fees are switched off in Settings.' });
  if (d.status !== 'issued' || !['tax_invoice', 'bill_of_supply'].includes(d.doc_type as string)) return out({ eligible: false, reason: 'Late fees apply to issued invoices.' });
  if (!d.gstin || d.registration_type === 'composition') return out({ eligible: false, reason: 'A late fee is charged with a debit note, which needs a regular GST registration.' });
  if (!d.due_date) return out({ eligible: false, reason: 'This invoice has no due date, so it cannot be late.' });
  const outstanding = BigInt(d.grand_total_paise as string) - BigInt(d.amount_settled_paise as string);
  const today = todayIn(d.timezone as string);
  const through = base.charges.length ? base.charges.map((c) => c.chargedThrough).sort().at(-1)! : null;
  const f = lateFee({ outstandingPaise: outstanding, dueDate: d.due_date as string, today, cfg, chargedThrough: through, chargedBefore: base.charges.length > 0 });
  return out({ eligible: f.feePaise > 0n, reason: f.feePaise > 0n ? undefined : outstanding <= 0n ? 'This invoice is paid.' : 'No late fee has built up yet.', days: f.days, feePaise: f.feePaise, outstanding, throughDate: today });
}

/** What is owed in late fees on one invoice today, for the invoice screen. */
export async function lateFeeStatus(sql: Sql, t: TenantSession, invoiceId: string) {
  const { doc: _doc, ...rest } = await inTenant(sql, t, 'document.read', (tx) => assess(tx, t, invoiceId));
  void _doc;
  return rest;
}

/**
 * Makes a draft debit note for the late fee that has built up. The owner reads it and issues it. If a late fee debit note
 * is already waiting as a draft for this invoice, that one is returned instead of a second.
 */
export async function createLateFeeDebitNote(sql: Sql, t: TenantSession, invoiceId: string) {
  return inTenant(sql, t, 'document.write', async (tx) => {
    const a = await assess(tx, t, invoiceId);
    const waiting = a.charges.find((c) => c.status === 'draft');
    if (waiting) return { id: waiting.debitNoteId, alreadyDrafted: true, feePaise: waiting.feePaise, warnings: [] as string[] };
    if (!a.eligible) throw new ValidationError(a.reason ?? 'No late fee is due.');
    const fee = BigInt(a.feePaise);
    const d = a.doc;
    const rate = `${fee / 100n}.${(fee % 100n).toString().padStart(2, '0')}`;
    const days = a.days;
    const input: DocIn = {
      docType: 'debit_note', partyId: d.party_id as string | null, originalDocumentId: invoiceId, docDate: a.throughDate!,
      lines: [{ name: `Late payment charge on invoice ${d.number}${a.cfg.mode === 'percent_per_month' ? ` (${days} day${days === 1 ? '' : 's'})` : ''}`,
        hsnSac: LATE_FEE_SAC, quantity: '1', rate, taxRateBp: a.cfg.gstRateBp, kind: 'service' }],
    };
    const made = await persist(tx, t, null, input);
    await tx`insert into late_fee_charge (business_id, invoice_id, debit_note_id, fee_paise, charged_through)
             values (${t.businessId}, ${invoiceId}, ${made.id}, ${fee.toString()}, ${a.throughDate})`;
    return { id: made.id, alreadyDrafted: false, feePaise: fee.toString(), warnings: made.warnings };
  });
}


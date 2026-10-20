import { createHash } from 'node:crypto';
import { parseRupees } from '@kora/tax';
import type { Sql } from '@kora/db';
import { recordPayment } from './payments.js';
import { normaliseInvoiceNumber, payBill } from './purchases.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { ValidationError } from './validation.js';

/**
 * Bank statement matching. A statement is a CSV downloaded from net banking. Kora reads it, suggests which open invoice or
 * vendor bill each line settles, and records the payments you confirm. Nothing is recorded without your confirmation, and
 * the same line is never recorded twice.
 */

export interface StatementRow { index: number; date: string | null; description: string; creditPaise: bigint; debitPaise: bigint; reference: string }

// ---------------------------------------------------------------- reading the file
/** A small CSV reader: quoted fields, commas and line breaks inside quotes, and a semicolon, tab or pipe as the separator. */
export function parseStatementCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const count = (c: string) => (first.match(new RegExp(`\\${c}`, 'g')) ?? []).length;
  const sep = [',', ';', '\t', '|'].reduce((best, c) => (count(c) > count(best) ? c : best), ',');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

/** 25/10/2026, 25-10-26, 2026-10-25, 25 Oct 2026 and 25-Oct-2026 all become 2026-10-25. Anything else is null. */
export function parseStatementDate(raw: string): string | null {
  const s = raw.trim();
  let parts: [string, string, string] | null = null;                       // year, month, day
  let x: RegExpExecArray | null;
  if ((x = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) parts = [x[1]!, x[2]!, x[3]!];
  else if ((x = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/.exec(s))) parts = [x[3]!, x[2]!, x[1]!];
  else if ((x = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2})\b/.exec(s))) parts = [`20${x[3]!}`, x[2]!, x[1]!];
  else if ((x = /^(\d{1,2})[ \-/]([A-Za-z]{3})[A-Za-z]*[ \-/,]+(\d{4})/.exec(s))) {
    const m = MONTHS[x[2]!.toLowerCase()];
    if (m) parts = [x[3]!, m, x[1]!];
  }
  if (!parts) return null;
  const [y, m, d] = parts;
  const mm = String(Number(m)).padStart(2, '0'), dd = String(Number(d)).padStart(2, '0');
  const at = new Date(Date.UTC(Number(y), Number(mm) - 1, Number(dd)));
  if (at.getUTCFullYear() !== Number(y) || at.getUTCMonth() !== Number(mm) - 1 || at.getUTCDate() !== Number(dd)) return null;
  return `${y}-${mm}-${dd}`;
}

/** "1,23,456.78", "Rs. 500", "(250.00)", "500 Dr" -> paise (always positive), or null when it is empty or not a number. */
export function parseStatementAmount(raw: string): bigint | null {
  const s = raw.replace(/[₹]|rs\.?|inr/gi, '').replace(/\b(dr|cr)\.?$/i, '').replace(/[()\s,]/g, '');
  if (s === '' || s === '-') return null;
  try { const v = parseRupees(s.replace(/^-/, '')); return v >= 0n ? v : null; } catch { return null; }
}

/**
 * Finds the header row (banks put account details above it), maps the columns by their names, and reads every line below.
 * Supports separate debit and credit columns, or one amount column with a Dr/Cr or type column. Lines with no amount or
 * date are skipped and counted.
 */
export function parseStatement(text: string): { rows: StatementRow[]; skipped: number; problems: string[] } {
  const grid = parseStatementCsv(text);
  const find = (cells: string[], re: RegExp, prefer?: RegExp) => {
    const hits = cells.map((c, i) => (re.test(c.toLowerCase()) ? i : -1)).filter((i) => i >= 0);
    return (prefer ? hits.find((i) => prefer.test(cells[i]!.toLowerCase())) : undefined) ?? hits[0] ?? -1;
  };
  let h = -1;
  for (let i = 0; i < Math.min(grid.length, 40); i++) {
    const c = grid[i]!.map((x) => x.toLowerCase());
    if (c.some((x) => /date/.test(x)) && c.some((x) => /debit|withdraw|credit|deposit|amount/.test(x))) { h = i; break; }
  }
  // No amount-like heading: take the first row with a date heading and a few columns, so the message can say what is missing.
  if (h < 0) h = grid.slice(0, 40).findIndex((r) => r.some((x) => /date/i.test(x)) && r.filter((x) => x !== '').length >= 3);
  if (h < 0) return { rows: [], skipped: 0, problems: ['Could not find the header row. The file needs columns for the date, the narration and the debit and credit amounts.'] };
  const head = grid[h]!;
  const iDate = find(head, /date/, /txn|transaction|posting/);
  const iDesc = find(head, /narration|description|particular|remark|detail/);
  const iType = find(head, /dr\s*\/\s*cr|^type$|txn type|transaction type|cr\s*\/\s*dr/);
  const notType = (i: number) => (i === iType ? -1 : i);
  const iDebit = notType(find(head, /debit|withdraw|\bdr\b/));
  const iCredit = notType(find(head, /credit|deposit|\bcr\b/));
  const iAmount = iDebit < 0 && iCredit < 0 ? find(head, /^amount|amount\b/) : -1;
  const iRef = find(head, /ref|chq|cheque|utr/);
  const problems: string[] = [];
  if (iDebit < 0 && iCredit < 0 && iAmount < 0) problems.push('Could not find the debit, credit or amount columns.');
  if (problems.length) return { rows: [], skipped: 0, problems };
  const rows: StatementRow[] = [];
  let skipped = 0;
  for (const r of grid.slice(h + 1)) {
    const date = iDate >= 0 ? parseStatementDate(r[iDate] ?? '') : null;
    let credit = iCredit >= 0 ? parseStatementAmount(r[iCredit] ?? '') : null;
    let debit = iDebit >= 0 ? parseStatementAmount(r[iDebit] ?? '') : null;
    if (iAmount >= 0) {
      const a = parseStatementAmount(r[iAmount] ?? '');
      const raw = `${r[iAmount] ?? ''} ${iType >= 0 ? r[iType] ?? '' : ''}`.toLowerCase();
      if (a !== null) { if (/\bcr\b|credit|deposit/.test(raw)) credit = a; else if (/\bdr\b|debit|withdraw/.test(raw)) debit = a; else if (/^\s*-|\(/.test(r[iAmount] ?? '')) debit = a; else credit = a; }
    }
    if (!date || ((credit ?? 0n) === 0n && (debit ?? 0n) === 0n)) { skipped++; continue; }
    rows.push({ index: rows.length, date, description: (iDesc >= 0 ? r[iDesc] ?? '' : '').replace(/\s+/g, ' ').trim(), creditPaise: credit ?? 0n, debitPaise: debit ?? 0n, reference: iRef >= 0 ? (r[iRef] ?? '').trim() : '' });
  }
  if (rows.length === 0) problems.push('No lines with a date and an amount were found.');
  return { rows, skipped, problems };
}

/** The same line gives the same fingerprint every time, so importing a statement twice cannot record it twice. */
export const fingerprint = (r: Pick<StatementRow, 'date' | 'description' | 'creditPaise' | 'debitPaise' | 'reference'>) =>
  createHash('sha256').update(`${r.date}|${r.creditPaise}|${r.debitPaise}|${r.description.toUpperCase().replace(/[^A-Z0-9]/g, '')}|${r.reference}`).digest('hex').slice(0, 12);

// ---------------------------------------------------------------- matching
export interface OpenInvoice { id: string; number: string; party: string; duePaise: bigint }
export interface OpenBill { id: string; billNumber: string; vendor: string; duePaise: bigint }
export interface Suggestion { kind: 'invoice' | 'bill'; id: string; label: string; party: string; duePaise: string; score: number; reasons: string[] }

const STOP = new Set(['LTD', 'LIMITED', 'PVT', 'PRIVATE', 'CO', 'AND', 'THE', 'OF', 'LLP', 'INC', 'CORP', 'COMPANY', 'STORES', 'TRADERS', 'ENTERPRISES', 'SERVICES', 'INDIA']);
const words = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

function evidence(narration: string, number: string, party: string) {
  const reasons: string[] = [];
  let score = 0;
  const flat = squash(narration);
  const full = normaliseInvoiceNumber(number);
  const serial = /(\d+)\D*$/.exec(number)?.[1]?.replace(/^0+(?=\d)/, '');
  const prefix = /^[A-Za-z]+/.exec(number)?.[0]?.toUpperCase();
  if (full.length >= 4 && flat.includes(full)) { score += 50; reasons.push('The invoice number is in the narration'); }
  else if (serial && prefix && new RegExp(`${prefix}[\\s/\\-_.:#]*0*${serial}(?!\\d)`, 'i').test(narration)) { score += 35; reasons.push('Part of the invoice number is in the narration'); }
  const pw = words(party);
  if (pw.length > 0) {
    const nw = new Set(words(narration));
    const hit = pw.filter((w) => nw.has(w) || [...nw].some((x) => x.length >= 4 && (x.startsWith(w) || w.startsWith(x))));
    if (hit.length >= Math.ceil(pw.length / 2)) { score += 25; reasons.push('The name is in the narration'); }
  }
  return { score, reasons };
}

/** Up to three suggestions for one statement line, best first. Money in matches invoices; money out matches vendor bills. */
export function matchRow(row: StatementRow, invoices: OpenInvoice[], bills: OpenBill[]): Suggestion[] {
  const out: Suggestion[] = [];
  const credit = row.creditPaise > 0n;
  const amount = credit ? row.creditPaise : row.debitPaise;
  const pool: { kind: 'invoice' | 'bill'; id: string; no: string; party: string; due: bigint }[] = credit
    ? invoices.map((i) => ({ kind: 'invoice' as const, id: i.id, no: i.number, party: i.party, due: i.duePaise }))
    : bills.map((b) => ({ kind: 'bill' as const, id: b.id, no: b.billNumber, party: b.vendor, due: b.duePaise }));
  for (const p of pool) {
    if (amount > p.due) continue;                                       // never suggest more than is owed
    const ev = evidence(`${row.description} ${row.reference}`, p.no, p.party);
    let score = ev.score;
    const reasons = [...ev.reasons];
    if (amount === p.due) { score += 60; reasons.unshift('The amount is exactly what is due'); }
    else if (ev.score > 0) { score += 10; reasons.push('Part of what is due'); }
    if (score >= 60) out.push({ kind: p.kind, id: p.id, label: p.no, party: p.party, duePaise: p.due.toString(), score, reasons });
  }
  return out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, 3);
}

// ---------------------------------------------------------------- with the database
export async function bankPreview(sql: Sql, t: TenantSession, csv: string) {
  if (typeof csv !== 'string' || csv.trim() === '') throw new ValidationError('Choose a statement file first.', 'csv');
  if (csv.length > 2_000_000) throw new ValidationError('That file is too large. Export a shorter period.', 'csv');
  const parsed = parseStatement(csv);
  if (parsed.rows.length > 2000) throw new ValidationError('A statement can have at most 2000 lines. Export a shorter period.', 'csv');
  const { invoices, bills, seen } = await inTenant(sql, t, 'payment.read', async (tx) => {
    const inv = await tx`select d.id, d.number, p.name as party, (d.grand_total_paise - d.amount_settled_paise)::text as due
                           from document d left join party p on p.id = d.party_id
                          where d.status = 'issued' and d.doc_type in ('tax_invoice', 'bill_of_supply', 'debit_note') and d.currency = 'INR' and d.grand_total_paise > d.amount_settled_paise`;
    const bl = await tx`select b.id, b.bill_number, p.name as vendor, (b.total_paise - b.paid_paise)::text as due
                          from purchase_bill b join party p on p.id = b.party_id where b.status = 'recorded' and b.total_paise > b.paid_paise`.catch(() => []);
    const notes = await tx`select note from payment where note like '%[bk:%' union all select note from purchase_payment where note like '%[bk:%'`.catch(() => []);
    return { invoices: inv.map((r) => ({ id: r.id as string, number: (r.number as string) ?? '', party: (r.party as string) ?? '', duePaise: BigInt(r.due as string) })),
      bills: bl.map((r) => ({ id: r.id as string, billNumber: r.bill_number as string, vendor: r.vendor as string, duePaise: BigInt(r.due as string) })),
      seen: new Set(notes.flatMap((n) => [...String(n.note).matchAll(/\[bk:([0-9a-f]{12})\]/g)].map((m) => m[1]!))) };
  });
  return {
    skipped: parsed.skipped, problems: parsed.problems,
    rows: parsed.rows.map((r) => {
      const fp = fingerprint(r);
      return { index: r.index, date: r.date, description: r.description, reference: r.reference, creditPaise: r.creditPaise.toString(), debitPaise: r.debitPaise.toString(), fingerprint: fp,
        alreadyRecorded: seen.has(fp), suggestions: seen.has(fp) ? [] : matchRow(r, invoices, bills) };
    }),
  };
}

export interface BankApplyItem { kind: 'invoice' | 'bill'; id: string; amount: string; date: string; description: string; fingerprint: string }

/** Records each confirmed line as a payment, with a note that carries the line's fingerprint. One line failing does not stop the others. */
export async function bankApply(sql: Sql, t: TenantSession, items: BankApplyItem[]) {
  if (!Array.isArray(items) || items.length === 0) throw new ValidationError('Choose at least one line to record.');
  if (items.length > 500) throw new ValidationError('Record at most 500 lines at a time.');
  const results: { index: number; ok: boolean; error?: string }[] = [];
  for (const [index, it] of items.entries()) {
    try {
      if (!/^[0-9a-f]{12}$/.test(it.fingerprint)) throw new ValidationError('This line could not be identified. Read the statement again.');
      const seen = await inTenant(sql, t, 'payment.read', async (tx) => {
        const r = await tx`select 1 from payment where note like ${'%[bk:' + it.fingerprint + ']%'} union all select 1 from purchase_payment where note like ${'%[bk:' + it.fingerprint + ']%'} limit 1`;
        return r.length > 0;
      });
      if (seen) throw new ValidationError('This line has already been recorded.');
      const note = `Bank: ${String(it.description ?? '').slice(0, 200)} [bk:${it.fingerprint}]`;
      if (it.kind === 'invoice') await recordPayment(sql, t, { documentId: it.id, amount: it.amount, method: 'bank_transfer', receivedOn: it.date, note });
      else if (it.kind === 'bill') await payBill(sql, t, it.id, { amount: it.amount, method: 'bank_transfer', paidOn: it.date, note });
      else throw new ValidationError('Choose an invoice or a bill for each line.');
      results.push({ index, ok: true });
    } catch (e) {
      results.push({ index, ok: false, error: (e as Error).message });
    }
  }
  return { done: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

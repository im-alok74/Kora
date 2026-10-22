'use client';
import { computeDocument, parseQuantity, parseRupees, resolvePlaceOfSupply, formatRupees, type DocType } from '@kora/tax';

export interface BusinessFacts { registration_type: string; state_code: string; turnover_band: string }
export interface PartyFacts { id: string; name: string; state_code: string; gstin?: string | null; shipping_address?: { stateCode?: string } | null }

/**
 * Totals for the editor when the server cannot be reached. It runs the same tax library the server runs, so the
 * numbers match; the server still recomputes everything when the draft syncs.
 */
/** "-5" or "12.50" as paise. Anything unreadable counts as no adjustment while it is being typed; the server says what is wrong. */
function adjustmentOf(text: unknown): bigint {
  const t = String(text ?? '').trim();
  if (!t) return 0n;
  try { return t.startsWith('-') ? -parseRupees(t.slice(1)) : parseRupees(t.replace(/^\+/, '')); } catch { return 0n; }
}

export function localTotals(a: { business: BusinessFacts; party: PartyFacts | null; payload: Record<string, any> }) {
  const { business, party, payload } = a;
  const lines = (payload.lines ?? []) as { name: string; quantity: string; rate: string; discount?: string; taxRateBp: number; cessRateBp?: number; kind?: string; taxInclusive?: boolean }[];
  if (!lines.length) return null;
  const allServices = lines.every((l) => l.kind === 'service');
  const foreign = !!payload.currency && payload.currency !== 'INR';   // a quote abroad is not a tax document, so place 96 is fine
  const place = payload.placeOfSupply || (foreign ? (party?.state_code ?? business.state_code) : resolvePlaceOfSupply({
    kind: allServices ? 'service' : 'goods', billToState: party?.state_code ?? business.state_code,
    shipToState: payload.shipToState ?? party?.shipping_address?.stateCode ?? null, recipientRegisteredState: party?.state_code,
  }));
  const r = computeDocument({
    supplyDate: /^\d{4}-\d{2}-\d{2}$/.test(payload.docDate ?? '') ? payload.docDate : undefined,
    docType: payload.docType as DocType, registrationType: business.registration_type as never, supplierState: business.state_code, placeOfSupply: place,
    reverseCharge: !!payload.reverseCharge, tcsBp: payload.tcsBp ?? 0, tdsBp: payload.tdsBp ?? 0, roundTotal: (!payload.currency || payload.currency === 'INR') && payload.roundTotal !== false, adjustmentPaise: adjustmentOf(payload.adjustment),
    lines: lines.map((l) => ({ quantityMilli: parseQuantity(String(l.quantity)), ratePaise: parseRupees(String(l.rate)), discountPaise: l.discount ? parseRupees(String(l.discount)) : 0n,
      taxRateBp: l.taxRateBp, cessRateBp: l.cessRateBp ?? 0, taxInclusive: !!l.taxInclusive })),
  });
  const s = (x: bigint) => x.toString();
  return {
    supply: r.supply, placeOfSupply: place, warnings: [] as string[], recommendedDocType: r.recommendedDocType,
    taxable: s(r.taxablePaise), cgst: s(r.cgstPaise), sgst: s(r.sgstPaise), igst: s(r.igstPaise), cess: s(r.cessPaise), tcs: s(r.tcsPaise), tds: s(r.tdsPaise),
    adjustment: s(r.adjustmentPaise), roundOff: s(r.roundOffPaise), grandTotal: s(r.grandTotalPaise), netReceivable: s(r.netReceivablePaise), lines: r.lines.map((l) => ({ total: s(l.lineTotalPaise) })),
    display: formatRupees(r.grandTotalPaise),
  };
}

import type { Sql, Tx } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';
import { isDate, ValidationError } from './validation.js';

export type CustomEntity = 'document' | 'customer';
export type CustomKind = 'text' | 'number' | 'date' | 'dropdown';
export interface CustomValue { id: string; label: string; value: string; pdf: boolean }
export interface CustomFieldIn { entity: CustomEntity; label: string; kind: CustomKind; options?: string[]; showOnPdf?: boolean }

const MAX_LIVE = 10;

function cleanDef(input: CustomFieldIn) {
  if (input.entity !== 'document' && input.entity !== 'customer') throw new ValidationError('Choose documents or customers.', 'entity');
  if (!['text', 'number', 'date', 'dropdown'].includes(input.kind)) throw new ValidationError('Choose text, number, date or a list of choices.', 'kind');
  const label = String(input.label ?? '').trim();
  if (!label || label.length > 40) throw new ValidationError('Give the field a name of up to 40 characters.', 'label');
  let options: string[] | null = null;
  if (input.kind === 'dropdown') {
    options = [...new Set((input.options ?? []).map((o) => String(o).trim()).filter(Boolean))];
    if (options.length < 2 || options.length > 20) throw new ValidationError('A list needs between 2 and 20 choices.', 'options');
    if (options.some((o) => o.length > 60)) throw new ValidationError('Each choice can be up to 60 characters.', 'options');
  }
  return { entity: input.entity, label, kind: input.kind, options, showOnPdf: input.showOnPdf !== false };
}

export async function listCustomFields(sql: Sql, t: TenantSession, entity?: CustomEntity) {
  return inTenant(sql, t, 'document.read', (tx) => tx`
    select id, entity, label, kind, options, show_on_pdf, position from custom_field_def
     where archived_at is null and (${entity ?? null}::text is null or entity = ${entity ?? ''}) order by entity, position, created_at`);
}

export async function createCustomField(sql: Sql, t: TenantSession, input: CustomFieldIn) {
  const c = cleanDef(input);
  return inTenant(sql, t, 'settings.write', async (tx) => {
    const [n] = await tx`select count(*)::int as n from custom_field_def where entity = ${c.entity} and archived_at is null`;
    if ((n!.n as number) >= MAX_LIVE) throw new ValidationError(`You can have up to ${MAX_LIVE} custom fields for ${c.entity === 'document' ? 'documents' : 'customers'}. Remove one first.`);
    try {
      const [r] = await tx`insert into custom_field_def (business_id, entity, label, kind, options, show_on_pdf, position)
                           values (${t.businessId}, ${c.entity}, ${c.label}, ${c.kind}, ${c.options === null ? null : tx.json(c.options)}, ${c.showOnPdf}, ${n!.n as number})
                           returning id`;
      return { id: r!.id as string };
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ValidationError('You already have a field with that name.', 'label');
      throw e;
    }
  });
}

/** Only the name, the printing switch and the choices of a list can change. The kind is fixed, because answers already given would no longer fit it. */
export async function updateCustomField(sql: Sql, t: TenantSession, id: string, input: { label: string; options?: string[]; showOnPdf?: boolean }) {
  return inTenant(sql, t, 'settings.write', async (tx) => {
    const [cur] = await tx`select entity, kind from custom_field_def where id = ${id} and archived_at is null for update`;
    if (!cur) throw new ValidationError('Field not found.');
    const c = cleanDef({ entity: cur.entity as CustomEntity, kind: cur.kind as CustomKind, label: input.label, options: input.options, showOnPdf: input.showOnPdf });
    try {
      await tx`update custom_field_def set label = ${c.label}, options = ${c.options === null ? null : tx.json(c.options)}, show_on_pdf = ${c.showOnPdf} where id = ${id}`;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ValidationError('You already have a field with that name.', 'label');
      throw e;
    }
    return { id };
  });
}

/** Archiving hides the field from new documents. Documents that already carry an answer keep it. */
export async function archiveCustomField(sql: Sql, t: TenantSession, id: string) {
  await inTenant(sql, t, 'settings.write', async (tx) => {
    const r = await tx`update custom_field_def set archived_at = now() where id = ${id} and archived_at is null returning id`;
    if (r.length === 0) throw new ValidationError('Field not found.');
  });
}

/**
 * Checks answers against the live definitions and returns the copy to store: label, answer and whether it prints, in the
 * order the fields were defined. An empty answer is left out. An answer for a field that is not there is refused.
 */
export async function resolveCustom(tx: Tx, entity: CustomEntity, values: Record<string, unknown> | null | undefined): Promise<CustomValue[] | null> {
  const given = Object.entries(values ?? {}).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');
  if (given.length === 0) return null;
  const defs = await tx`select id, label, kind, options, show_on_pdf from custom_field_def where entity = ${entity} and archived_at is null order by position, created_at`;
  const byId = new Map(defs.map((d) => [d.id as string, d]));
  for (const [id] of given) if (!byId.has(id)) throw new ValidationError('One of the custom fields is no longer there. Reload and try again.', 'custom');
  const out: CustomValue[] = [];
  for (const d of defs) {
    const raw = given.find(([id]) => id === d.id)?.[1];
    if (raw === undefined) continue;
    const v = String(raw).trim();
    const label = d.label as string;
    if (d.kind === 'text' && v.length > 200) throw new ValidationError(`${label} is too long.`, 'custom');
    if (d.kind === 'number' && !/^-?\d{1,12}(\.\d{1,4})?$/.test(v)) throw new ValidationError(`${label} must be a number.`, 'custom');
    if (d.kind === 'date' && !isDate(v)) throw new ValidationError(`${label} must be a date as YYYY-MM-DD.`, 'custom');
    if (d.kind === 'dropdown' && !(d.options as string[]).includes(v)) throw new ValidationError(`${label}: choose one of the listed options.`, 'custom');
    out.push({ id: d.id as string, label, value: v, pdf: !!d.show_on_pdf });
  }
  return out.length ? out : null;
}

/** Sets the custom answers on a customer. They are copied onto each document made for the customer when it is issued. */
export async function setPartyCustom(sql: Sql, t: TenantSession, partyId: string, values: Record<string, unknown>) {
  return inTenant(sql, t, 'document.write', async (tx) => {
    const cv = await resolveCustom(tx, 'customer', values);
    const r = await tx`update party set custom_values = ${cv === null ? null : tx.json(cv as never)} where id = ${partyId} returning id`;
    if (r.length === 0) throw new ValidationError('Customer not found.');
    return { id: partyId, custom: cv };
  });
}

export async function getPartyCustom(sql: Sql, t: TenantSession, partyId: string): Promise<CustomValue[]> {
  const [r] = await inTenant(sql, t, 'document.read', (tx) => tx`select custom_values from party where id = ${partyId}`);
  return ((r?.custom_values as CustomValue[] | null) ?? []);
}

/**
 * The answers of an existing document, ready to go onto a copy of it (a duplicate, a new quote version, the next document in a
 * chain). Fields that have been archived since are dropped, so a copy never fails over a field that is gone.
 */
export async function copyCustom(tx: Tx, stored: unknown): Promise<Record<string, string> | null> {
  if (!Array.isArray(stored) || stored.length === 0) return null;
  const live = await tx`select id from custom_field_def where entity = 'document' and archived_at is null`;
  const ids = new Set(live.map((r) => r.id as string));
  const out: Record<string, string> = {};
  for (const v of stored as CustomValue[]) if (ids.has(v.id)) out[v.id] = v.value;
  return Object.keys(out).length ? out : null;
}

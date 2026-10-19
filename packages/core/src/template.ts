import type { Sql } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';
import { ValidationError } from './validation.js';

/**
 * What a business can change about how its documents look. Nothing here can remove a statutory field.
 * The renderer always prints the fields in LOCKED_FIELDS, whatever this config says.
 */
export interface TemplateConfig {
  accent: string;                 // #rrggbb
  font: 'sans' | 'serif';
  layout: 'classic' | 'compact' | 'narrative' | 'thermal';
  paper: 'A4' | 'A5';
  /** The language of the fixed words on the document. */
  language: 'en' | 'hi' | 'mr' | 'gu';
  logoDataUrl: string | null;     // png or jpeg, up to 150 KB
  showBank: boolean;
  showTerms: boolean;
  showNotes: boolean;
  showSignature: boolean;
  showAmountInWords: boolean;
  showUpiQr: boolean;
  footerText: string;
}

export const DEFAULT_TEMPLATE: TemplateConfig = {
  accent: '#0b5d4f', font: 'sans', layout: 'classic', paper: 'A4', language: 'en', logoDataUrl: null,
  showBank: true, showTerms: true, showNotes: true, showSignature: true, showAmountInWords: true, showUpiQr: true, footerText: '',
};

/** Shown locked in the editor. Printed on every document regardless of the template. */
export const LOCKED_FIELDS = [
  'Supplier name, address and GSTIN', 'Recipient name and GSTIN', 'Document title and number', 'Date',
  'Place of supply', 'HSN or SAC on every line', 'Quantity, rate, discount and taxable value',
  'Tax breakup (CGST, SGST, IGST, cess)', 'Total', 'Reverse-charge statement', 'IRN and QR code (when issued)',
] as const;

const MAX_LOGO_BYTES = 150 * 1024;

/** Strict allow-list. Unknown keys are dropped; bad values are rejected, never passed through to HTML. */
export function sanitiseTemplate(raw: unknown): TemplateConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_TEMPLATE;
  const bool = (k: keyof TemplateConfig) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : (d[k] as boolean));
  const accent = r.accent === undefined ? d.accent : String(r.accent);
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) throw new ValidationError('Choose a colour as #rrggbb.', 'accent');
  const font = r.font === undefined ? d.font : r.font;
  if (font !== 'sans' && font !== 'serif') throw new ValidationError('Choose a font.', 'font');
  const layout = r.layout === undefined ? d.layout : r.layout;
  if (layout !== 'classic' && layout !== 'compact' && layout !== 'narrative' && layout !== 'thermal') throw new ValidationError('Choose a layout.', 'layout');
  const paper = r.paper === undefined ? d.paper : r.paper;
  if (paper !== 'A4' && paper !== 'A5') throw new ValidationError('Choose A4 or A5.', 'paper');
  const language = r.language === undefined ? d.language : r.language;
  if (language !== 'en' && language !== 'hi' && language !== 'mr' && language !== 'gu') throw new ValidationError('Choose English, Hindi, Marathi or Gujarati.', 'language');
  let logo: string | null = null;
  if (r.logoDataUrl) {
    const s = String(r.logoDataUrl);
    const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(s);
    if (!m) throw new ValidationError('The logo must be a PNG or JPEG image.', 'logoDataUrl');
    if (Math.floor((m[2]!.length * 3) / 4) > MAX_LOGO_BYTES) throw new ValidationError('The logo must be under 150 KB.', 'logoDataUrl');
    logo = s;
  }
  const footer = r.footerText === undefined ? '' : String(r.footerText).trim();
  if (footer.length > 200) throw new ValidationError('The footer is too long.', 'footerText');
  return {
    accent: accent.toLowerCase(), font, layout, paper, language, logoDataUrl: logo,
    showBank: bool('showBank'), showTerms: bool('showTerms'), showNotes: bool('showNotes'),
    showSignature: bool('showSignature'), showAmountInWords: bool('showAmountInWords'), showUpiQr: bool('showUpiQr'), footerText: footer,
  };
}

export async function getTemplate(sql: Sql, t: TenantSession): Promise<TemplateConfig> {
  const rows = await inTenant(sql, t, 'document.read', (tx) => tx`select config from document_template where is_default`);
  return sanitiseTemplate(rows[0]?.config ?? {});
}

export async function saveTemplate(sql: Sql, t: TenantSession, input: unknown): Promise<TemplateConfig> {
  const cfg = sanitiseTemplate(input);
  await inTenant(sql, t, 'settings.write', async (tx) => {
    await tx`insert into document_template (business_id, config, is_default) values (${t.businessId}, ${tx.json(cfg as any)}, true)
             on conflict (business_id) where is_default do update set config = excluded.config`;
  });
  return cfg;
}

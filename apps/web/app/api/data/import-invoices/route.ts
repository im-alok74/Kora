import { commitInvoiceImport, importTextFrom, previewInvoiceImport, ValidationError, type ImportDocType } from '@kora/core';
import { readJson, tenantRoute } from '../../../../lib/server';

/**
 * Body: { csv (text) or xlsx (base64), docType?: "tax_invoice" | "bill_of_supply" | "estimate" | "proforma", commit?: true }.
 * Makes DRAFTS, never issued documents. Without commit it checks every invoice and saves nothing.
 */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson<{ csv?: unknown; xlsx?: unknown; docType?: string; commit?: boolean }>(req);
  const text = typeof b.xlsx === 'string' ? importTextFrom({ xlsxBase64: b.xlsx }) : typeof b.csv === 'string' ? b.csv : null;
  if (text === null) throw new ValidationError('Choose a CSV or Excel file.', 'file');
  const docType = (b.docType ?? 'tax_invoice') as ImportDocType;
  return b.commit === true ? { result: await commitInvoiceImport(sql, t, text, docType) } : { preview: await previewInvoiceImport(sql, t, text, docType) };
});

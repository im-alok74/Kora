import DocumentEditor from '../../../../components/DocumentEditor';

const TYPES = ['tax_invoice', 'bill_of_supply', 'estimate', 'proforma', 'delivery_challan'];

/** /app/invoices/new?type=estimate starts the editor on that kind of document. */
export default async function NewInvoice({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  return <DocumentEditor initial={type && TYPES.includes(type) ? { docType: type } : undefined} />;
}

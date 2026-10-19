/**
 * Looks up a taxpayer by GSTIN to fill name and address. The real implementation calls the GST partner's
 * search API, which needs partner credentials. Until then the mock fills only what the GSTIN itself
 * contains (the state), so the form never pretends to know a legal name.
 */
export interface TaxpayerInfo {
  stateCode: string;
  legalName?: string;
  tradeName?: string;
  address?: { line1?: string; city?: string; pincode?: string };
}

export interface GstinLookup {
  lookup(gstin: string): Promise<TaxpayerInfo | null>;
}

export function createMockGstinLookup(): GstinLookup {
  return {
    async lookup(gstin) {
      return /^[0-9]{2}/.test(gstin) ? { stateCode: gstin.slice(0, 2) } : null;
    },
  };
}

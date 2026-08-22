import { apiGet } from './api';
import type { NutritionData } from '@shared/recipe';

/** Fields a product lookup can prefill (superset of local Product + OFF product). */
export interface LookedUpProduct {
  ean?: string;
  name?: string;
  brand?: string;
  netGrams?: number;
  packageLabel?: string;
  nutritionPer100g?: NutritionData;
  imageUrl?: string;
  offCode?: string;
}

export interface LookupResult {
  source: 'local' | 'openfoodfacts';
  product: LookedUpProduct | null;
}

/**
 * Look up an EAN: the server checks the local product register first, then falls
 * back to Open Food Facts. GET → works without a token (read).
 */
export async function lookupProductByEan(ean: string): Promise<LookupResult> {
  return apiGet<LookupResult>(`/api/products/lookup?ean=${encodeURIComponent(ean.trim())}`);
}

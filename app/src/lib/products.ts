import { apiGet } from './api';
import type { NutritionData } from '@shared/recipe';
import type { Product } from '@shared/tracker';

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
  servingGrams?: number;
  servingLabel?: string;
  gramsByUnitSuggestions?: GbuSuggestion[];
}

export interface GbuSuggestion {
  unit: string;
  gramsPerUnit: number;
  source: 'serving' | 'quantity';
  confidence: 'high' | 'medium';
}

export interface LookupResult {
  source: 'local' | 'openfoodfacts';
  product: LookedUpProduct | null;
}

export interface ProductSearchResult {
  local: Product[];
  results: LookedUpProduct[];
  page: number;
  hasMore: boolean;
  count?: number;
  error?: string;
}

/**
 * Look up an EAN: the server checks the local product register first, then falls
 * back to Open Food Facts. GET → works without a token (read).
 */
export async function lookupProductByEan(ean: string): Promise<LookupResult> {
  return apiGet<LookupResult>(`/api/products/lookup?ean=${encodeURIComponent(ean.trim())}`);
}

/**
 * Text search against Open Food Facts (with a few local register matches mixed
 * in). Mirrors the website's `/api/products/lookup?q=…` search. Needs the app to
 * be online (proxied to the server which talks to OFF).
 */
export async function searchProducts(
  query: string,
  page = 1,
  pageSize = 20
): Promise<ProductSearchResult> {
  return apiGet<ProductSearchResult>(
    `/api/products/lookup?q=${encodeURIComponent(query.trim())}&page=${page}&pageSize=${pageSize}`
  );
}

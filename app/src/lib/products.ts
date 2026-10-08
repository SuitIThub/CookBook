import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { apiGet } from './api';
import { getLocalDb } from './localDb';
import { lookupOpenFoodFactsProduct, searchOpenFoodFactsProducts } from '@core/openFoodFacts';
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

const OFF_TIMEOUT_MS = 20000;

/**
 * fetch() for the shared OFF client. On a device it goes through the native
 * HTTP stack (no CORS, and OFF's requested User-Agent can be sent); in the
 * browser it's the normal fetch.
 */
const offFetch: typeof fetch = async (input, init) => {
  if (!Capacitor.isNativePlatform()) return fetch(input, init);
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  const res = await CapacitorHttp.get({
    url: String(input),
    headers,
    responseType: 'text',
    connectTimeout: OFF_TIMEOUT_MS,
    readTimeout: OFF_TIMEOUT_MS
  });
  const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  return new Response(body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
};

/**
 * Look up an EAN like the website's `/api/products/lookup?ean=`: the product
 * register first (local replica, works offline), then Open Food Facts —
 * queried directly from the device, so it works without the Kochbuch server
 * (e.g. on mobile data). The server is only a fallback if the direct call fails.
 */
export async function lookupProductByEan(ean: string): Promise<LookupResult> {
  const code = ean.trim();
  const { db } = await getLocalDb();
  const local = db.getProductByEan(code);
  if (local) return { source: 'local', product: local as unknown as LookedUpProduct };

  const direct = await lookupOpenFoodFactsProduct(code, offFetch);
  if (direct.status === 'found') return { source: 'openfoodfacts', product: direct.product as LookedUpProduct };
  if (direct.status === 'not-found') return { source: 'openfoodfacts', product: null };
  try {
    return await apiGet<LookupResult>(`/api/products/lookup?ean=${encodeURIComponent(code)}`, { timeoutMs: OFF_TIMEOUT_MS });
  } catch {
    throw new Error(direct.message || 'Open Food Facts nicht erreichbar.');
  }
}

/**
 * Text search like the website's `/api/products/lookup?q=…`: local register
 * matches (page 1) + Open Food Facts, queried directly from the device; the
 * server is a fallback. Errors come back in `error` (never silently "no hits").
 */
export async function searchProducts(query: string, page = 1, pageSize = 20): Promise<ProductSearchResult> {
  const q = query.trim();
  const { db } = await getLocalDb();
  const local = page === 1 ? (db.searchProducts(q, Math.min(10, pageSize)) as Product[]) : [];
  const localEans = new Set(local.map((p) => p.ean).filter(Boolean) as string[]);

  const direct = await searchOpenFoodFactsProducts(q, { pageSize, page, fetchFn: offFetch });
  if (direct.status === 'ok') {
    return {
      local,
      results: direct.products.filter((p) => !localEans.has(p.ean)) as LookedUpProduct[],
      page: direct.page ?? page,
      hasMore: Boolean(direct.hasMore),
      count: direct.count
    };
  }
  try {
    const viaServer = await apiGet<ProductSearchResult>(
      `/api/products/lookup?q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}`,
      { timeoutMs: OFF_TIMEOUT_MS }
    );
    return { ...viaServer, local: page === 1 ? local : [] };
  } catch {
    return { local, results: [], page, hasMore: false, error: direct.message || 'Open Food Facts nicht erreichbar.' };
  }
}

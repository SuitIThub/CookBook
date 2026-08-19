import type { NutritionData } from '../types/recipe';

/**
 * Adapter for the Open Food Facts (OFF) public API — https://openfoodfacts.org
 *
 * We call the current v3 endpoint:
 *   GET https://world.openfoodfacts.org/api/v3/product/{ean}
 *
 * Notes / caveats:
 * - OFF is crowdsourced (ODbL). Data can be missing, wrong or partially filled.
 * - Nutrition values are typically per 100 g (or per 100 ml for beverages).
 * - The v3 response shape differs slightly from v2 in a few places, so field
 *   access here is defensive and falls back through both shapes.
 * - OFF asks callers to send a descriptive User-Agent identifying the app.
 */

const OFF_ENDPOINT = 'https://world.openfoodfacts.org/api/v3/product';
const OFF_SEARCH_ALICIOUS = 'https://search.openfoodfacts.org/search';
const OFF_SEARCH_CGI = 'https://world.openfoodfacts.org/cgi/search.pl';
const USER_AGENT = 'CookBook/1.0 (https://github.com/) nutrition tracker';
const SEARCH_FIELDS = [
  'code',
  '_id',
  'product_name',
  'product_name_de',
  'generic_name',
  'generic_name_de',
  'brands',
  'quantity',
  'product_quantity',
  'serving_size',
  'image_front_url',
  'image_url',
  'image_small_url',
  'nutriments',
].join(',');

export interface OpenFoodFactsProduct {
  ean: string;
  name?: string;
  brand?: string;
  netGrams?: number;
  packageLabel?: string;
  nutritionPer100g?: NutritionData;
  imageUrl?: string;
  offCode?: string;
  raw?: unknown;
}

export interface OpenFoodFactsLookupResult {
  status: 'found' | 'not-found' | 'error';
  product?: OpenFoodFactsProduct;
  message?: string;
}

/**
 * Look up a product on Open Food Facts by EAN/barcode.
 * Returns a normalized product or a status if nothing was found.
 */
export async function lookupOpenFoodFactsProduct(ean: string, fetchFn: typeof fetch = fetch): Promise<OpenFoodFactsLookupResult> {
  const trimmed = ean.trim();
  if (!trimmed) return { status: 'error', message: 'EAN darf nicht leer sein' };
  if (!/^\d{6,14}$/.test(trimmed)) {
    return { status: 'error', message: 'Ungültige EAN (nur Ziffern, 6–14 Stellen).' };
  }

  const url = `${OFF_ENDPOINT}/${encodeURIComponent(trimmed)}.json`;
  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });
  } catch (error) {
    return { status: 'error', message: `Netzwerkfehler: ${(error as Error).message}` };
  }

  if (!response.ok) {
    return { status: 'error', message: `Open Food Facts antwortete mit HTTP ${response.status}.` };
  }

  let body: any;
  try {
    body = await response.json();
  } catch (error) {
    return { status: 'error', message: 'Antwort konnte nicht als JSON gelesen werden.' };
  }

  // OFF v3 uses status "success"/"failure" and product under `product`.
  // v2 used numeric status: 1 = found, 0 = not found. Support both.
  const statusStr = typeof body?.status === 'string' ? body.status : null;
  const statusNum = typeof body?.status === 'number' ? body.status : null;

  const product = body?.product;
  if (!product || (statusStr && statusStr !== 'success') || statusNum === 0) {
    return { status: 'not-found', message: body?.status_verbose || 'Produkt nicht gefunden.' };
  }

  return {
    status: 'found',
    product: normalizeOpenFoodFactsProduct(trimmed, product),
  };
}

/**
 * Extract the common fields we care about from an OFF product payload.
 * Kept intentionally defensive: OFF field names and shapes vary between
 * languages, categories and API versions.
 */
export function normalizeOpenFoodFactsProduct(ean: string, product: any): OpenFoodFactsProduct {
  const name = firstString(
    product?.product_name_de,
    product?.product_name,
    product?.generic_name_de,
    product?.generic_name
  );
  const brand = firstString(product?.brands);
  const packageLabel = firstString(product?.quantity, product?.serving_size);
  const netGrams = parseGramsFromQuantity(product?.product_quantity, product?.quantity);
  const imageUrl = firstString(product?.image_front_url, product?.image_url, product?.image_small_url);
  const offCode = firstString(product?.code, product?._id);

  const nutriments = product?.nutriments || {};
  const nutritionPer100g: NutritionData = {};
  const kcal =
    parseNumeric(nutriments['energy-kcal_100g']) ??
    parseNumeric(nutriments.energy_kcal_100g) ??
    energyKjToKcal(parseNumeric(nutriments['energy_100g']) ?? parseNumeric(nutriments['energy-kj_100g']));
  if (kcal != null) nutritionPer100g.calories = round2(kcal);
  const carbs = parseNumeric(nutriments.carbohydrates_100g);
  if (carbs != null) nutritionPer100g.carbohydrates = round2(carbs);
  const sugar = parseNumeric(nutriments.sugars_100g);
  if (sugar != null) nutritionPer100g.sugar = round2(sugar);
  const protein = parseNumeric(nutriments.proteins_100g);
  if (protein != null) nutritionPer100g.protein = round2(protein);
  const fat = parseNumeric(nutriments.fat_100g);
  if (fat != null) nutritionPer100g.fat = round2(fat);
  const satFat = parseNumeric(nutriments['saturated-fat_100g']) ?? parseNumeric(nutriments.saturated_fat_100g);
  if (satFat != null) nutritionPer100g.saturatedFat = round2(satFat);
  const fiber = parseNumeric(nutriments.fiber_100g);
  if (fiber != null) nutritionPer100g.fiber = round2(fiber);
  const salt = parseNumeric(nutriments.salt_100g);
  if (salt != null) nutritionPer100g.salt = round2(salt);

  const hasNutrition = Object.keys(nutritionPer100g).length > 0;

  return {
    ean,
    name,
    brand,
    netGrams,
    packageLabel,
    imageUrl,
    offCode,
    nutritionPer100g: hasNutrition ? nutritionPer100g : undefined,
    raw: product,
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim().length > 0) return item.trim();
      }
    }
  }
  return undefined;
}

function parseNumeric(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(',', '.').replace(/[^0-9.\-]/g, '');
    if (!cleaned) return undefined;
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function energyKjToKcal(kj?: number): number | undefined {
  if (kj == null || !Number.isFinite(kj)) return undefined;
  return kj / 4.184;
}

export interface OpenFoodFactsSearchResult {
  status: 'ok' | 'error';
  products: OpenFoodFactsProduct[];
  count?: number;
  message?: string;
}

/**
 * Text search against Open Food Facts.
 *
 * The legacy `/cgi/search.pl` endpoint is frequently overloaded and returns
 * HTTP 503. OFF's recommended full-text search is Search-a-licious
 * (search.openfoodfacts.org). We try that first, then fall back to cgi/search.pl.
 */
export async function searchOpenFoodFactsProducts(
  query: string,
  options: { pageSize?: number; language?: string; fetchFn?: typeof fetch } = {}
): Promise<OpenFoodFactsSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { status: 'error', products: [], message: 'Suchbegriff darf nicht leer sein' };
  const fetchFn = options.fetchFn ?? fetch;
  const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 15));
  const language = options.language || 'de';

  const primary = await searchViaSearchAlicious(trimmed, pageSize, language, fetchFn);
  if (primary.status === 'ok') return primary;

  const fallback = await searchViaCgi(trimmed, pageSize, language, fetchFn);
  if (fallback.status === 'ok') return fallback;

  return {
    status: 'error',
    products: [],
    message: primary.message || fallback.message || 'Open Food Facts ist gerade nicht erreichbar.',
  };
}

async function searchViaSearchAlicious(
  query: string,
  pageSize: number,
  language: string,
  fetchFn: typeof fetch
): Promise<OpenFoodFactsSearchResult> {
  const langs = language === 'de' ? 'de,en' : `${language},en`;
  const params = new URLSearchParams({
    q: asLiteralSearchQuery(query),
    langs,
    page_size: String(pageSize),
    page: '1',
    fields: SEARCH_FIELDS,
  });
  const response = await fetchWithRetries(`${OFF_SEARCH_ALICIOUS}?${params.toString()}`, fetchFn);
  if (!response) {
    return { status: 'error', products: [], message: 'Netzwerkfehler bei der Open-Food-Facts-Suche.' };
  }
  if (!response.ok) {
    return { status: 'error', products: [], message: `OFF-Suche antwortete mit HTTP ${response.status}.` };
  }
  let body: any;
  try {
    body = await response.json();
  } catch {
    return { status: 'error', products: [], message: 'Antwort konnte nicht als JSON gelesen werden.' };
  }
  if (Array.isArray(body?.errors) && body.errors.length > 0 && !Array.isArray(body?.hits)) {
    const title = body.errors[0]?.title || 'Suche fehlgeschlagen';
    return { status: 'error', products: [], message: title };
  }
  return { status: 'ok', products: normalizeSearchHits(body?.hits), count: numericCount(body?.count) };
}

async function searchViaCgi(
  query: string,
  pageSize: number,
  language: string,
  fetchFn: typeof fetch
): Promise<OpenFoodFactsSearchResult> {
  const params = new URLSearchParams({
    search_terms: query,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: String(pageSize),
    lc: language,
    fields: SEARCH_FIELDS,
  });
  const response = await fetchWithRetries(`${OFF_SEARCH_CGI}?${params.toString()}`, fetchFn);
  if (!response) {
    return { status: 'error', products: [], message: 'Netzwerkfehler bei der Open-Food-Facts-Suche.' };
  }
  if (!response.ok) {
    return { status: 'error', products: [], message: `OFF antwortete mit HTTP ${response.status}.` };
  }
  let body: any;
  try {
    body = await response.json();
  } catch {
    return { status: 'error', products: [], message: 'Antwort konnte nicht als JSON gelesen werden.' };
  }
  return {
    status: 'ok',
    products: normalizeSearchHits(body?.products),
    count: numericCount(body?.count),
  };
}

function normalizeSearchHits(raw: unknown): OpenFoodFactsProduct[] {
  if (!Array.isArray(raw)) return [];
  const products: OpenFoodFactsProduct[] = [];
  for (const item of raw) {
    const ean = firstString(item?.code, item?._id) || '';
    if (!ean) continue;
    products.push(normalizeOpenFoodFactsProduct(ean, item));
  }
  return products;
}

function numericCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Keep product names literal so Lucene operators in the query are not interpreted. */
function asLiteralSearchQuery(query: string): string {
  if (/[+\-&|!(){}[\]^"~*?:\\/]/.test(query)) {
    return `"${query.replace(/"/g, ' ')}"`;
  }
  return query;
}

async function fetchWithRetries(
  url: string,
  fetchFn: typeof fetch,
  retries = 2
): Promise<Response | null> {
  const retryStatuses = new Set([429, 502, 503, 504]);
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchFn(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (response.ok || !retryStatuses.has(response.status) || attempt === retries) {
        return response;
      }
      await sleep(400 * 2 ** attempt);
    } catch (error) {
      lastError = error;
      if (attempt === retries) return null;
      await sleep(400 * 2 ** attempt);
    }
  }
  if (lastError) return null;
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseGramsFromQuantity(productQuantity: unknown, quantityText: unknown): number | undefined {
  // product_quantity from OFF is already in grams for solids when set.
  const num = parseNumeric(productQuantity);
  if (num != null && num > 0) return num;
  if (typeof quantityText !== 'string') return undefined;
  const match = quantityText.match(/([\d.,]+)\s*(kg|g|ml|l|cl)/i);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1].replace(',', '.'));
  if (!Number.isFinite(value)) return undefined;
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 'kg':
      return value * 1000;
    case 'g':
      return value;
    case 'l':
      return value * 1000; // assume density 1 for liquids (fine for water-like products)
    case 'cl':
      return value * 10;
    case 'ml':
      return value;
    default:
      return undefined;
  }
}

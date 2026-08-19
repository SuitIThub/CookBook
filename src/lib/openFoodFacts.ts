import type { NutritionData } from '../types/recipe';
import { detectUnitInText } from './units';

/**
 * Adapter for the Open Food Facts (OFF) public API — https://openfoodfacts.org
 *
 * We call the current v3 endpoint:
 *   GET https://world.openfoodfacts.org/api/v3/product/{ean}
 *
 * Notes / caveats:
 * - OFF is crowdsourced (ODbL). Data can be missing, wrong or partially filled.
 * - Nutrition values are typically per 100 g (or per 100 ml for beverages).
 * - Slice/piece weights are not a first-class field. `serving_size` /
 *   `serving_quantity` are optional contributor text/numbers (e.g. "1 Scheibe
 *   (30 g)"). Many products omit them entirely.
 * - The v3 response shape differs slightly from v2 in a few places, so field
 *   access here is defensive and falls back through both shapes.
 * - OFF asks callers to send a descriptive User-Agent identifying the app.
 */

const OFF_ENDPOINT = 'https://world.openfoodfacts.org/api/v3/product';
const OFF_SEARCH_ALICIOUS = 'https://search.openfoodfacts.org/search';
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
  'serving_quantity',
  'serving_quantity_unit',
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
  /** Grams of one serving, when OFF contributors filled serving_size / serving_quantity. */
  servingGrams?: number;
  /** Raw serving_size text, e.g. "1 Scheibe (30 g)". */
  servingLabel?: string;
  /** Derived "1 unit = N g" suggestions (confirm before applying, see deriveGramsByUnitFromOff). */
  gramsByUnitSuggestions?: GramsPerUnitSuggestion[];
  nutritionPer100g?: NutritionData;
  imageUrl?: string;
  offCode?: string;
  raw?: unknown;
}

/** A single "1 <unit> = <gramsPerUnit> g" suggestion derived from noisy OFF data. */
export interface GramsPerUnitSuggestion {
  unit: string; // canonical unit name (see units.ts)
  gramsPerUnit: number; // grams of ONE unit
  source: 'serving' | 'quantity';
  confidence: 'high' | 'medium';
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
  const packageLabel = firstString(product?.quantity);
  const netGrams = parseGramsFromQuantity(product?.product_quantity, product?.quantity);
  const serving = parseServingInfo(product);
  const gramsByUnitSuggestions = deriveGramsByUnitFromOff(product);
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
    servingGrams: serving.grams,
    servingLabel: serving.label,
    gramsByUnitSuggestions: gramsByUnitSuggestions.length > 0 ? gramsByUnitSuggestions : undefined,
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
  page?: number;
  pageCount?: number;
  hasMore?: boolean;
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
  options: { pageSize?: number; page?: number; language?: string; fetchFn?: typeof fetch } = {}
): Promise<OpenFoodFactsSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { status: 'error', products: [], message: 'Suchbegriff darf nicht leer sein' };
  const fetchFn = options.fetchFn ?? fetch;
  const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));
  const page = Math.max(1, options.page ?? 1);
  const language = options.language || 'de';

  // Only Search-a-licious. The legacy cgi/search.pl fallback was removed: it
  // OR-matches and returned irrelevant results (e.g. products literally named
  // "vegan") or HTML error pages when overloaded. fetchWithRetries already
  // retries transient failures; if it still fails the user simply retries.
  return searchViaSearchAlicious(trimmed, pageSize, page, language, fetchFn);
}

const OFF_SUGGEST = 'https://world.openfoodfacts.org/api/v3/taxonomy_suggestions';

/**
 * Autocomplete suggestions for the product search box, powered by OFF's
 * `taxonomy_suggestions` endpoint. Defaults to the `categories` taxonomy: it
 * returns product-type terms ("Schmand", "Joghurt") — what users actually
 * search for — as plain display strings. Best-effort: any failure yields [].
 */
export async function suggestOpenFoodFactsTerms(
  query: string,
  options: { tagtype?: string; language?: string; limit?: number; fetchFn?: typeof fetch } = {}
): Promise<string[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const fetchFn = options.fetchFn ?? fetch;
  const tagtype = options.tagtype || 'categories';
  const lc = options.language || 'de';
  const limit = Math.min(25, Math.max(1, options.limit ?? 10));
  const params = new URLSearchParams({ tagtype, lc, string: trimmed });
  let response: Response | null;
  try {
    response = await fetchFn(`${OFF_SUGGEST}?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
  } catch {
    return [];
  }
  if (!response || !response.ok) return [];
  let body: any;
  try {
    body = await response.json();
  } catch {
    return [];
  }
  const raw = Array.isArray(body?.suggestions) ? body.suggestions : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of raw) {
    if (typeof s !== 'string') continue;
    const value = s.trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

async function searchViaSearchAlicious(
  query: string,
  pageSize: number,
  page: number,
  language: string,
  fetchFn: typeof fetch
): Promise<OpenFoodFactsSearchResult> {
  const langs = language === 'de' ? 'de,en' : `${language},en`;
  const params = new URLSearchParams({
    q: sanitizeSearchQuery(query),
    langs,
    page_size: String(pageSize),
    page: String(page),
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
  const products = normalizeSearchHits(body?.hits);
  const count = numericCount(body?.count);
  const pageCount = numericCount(body?.page_count);
  const responsePageSize = numericCount(body?.page_size) ?? pageSize;
  return {
    status: 'ok',
    products,
    count,
    page: numericCount(body?.page) ?? page,
    pageCount,
    hasMore: computeHasMore(page, responsePageSize, products.length, count, pageCount, true),
  };
}

function computeHasMore(
  page: number,
  pageSize: number,
  hitCount: number,
  count?: number,
  pageCount?: number,
  pageCountMeansTotalPages = false
): boolean {
  if (hitCount === 0) return false;
  if (count != null) return page * pageSize < count;
  if (pageCountMeansTotalPages && pageCount != null) return page < pageCount;
  return hitCount >= pageSize;
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

/**
 * Neutralize Lucene query operators in user input for the Search-a-licious `q`
 * parameter. The previous approach wrapped the whole query in quotes as soon as
 * one special character was present, turning it into an exact phrase match — so
 * "gut & günstig" matched nothing (0 hits). Instead we replace the reserved
 * characters with spaces so the words are searched as ordinary free text
 * ("gut & günstig" → "gut günstig"). Falls back to the trimmed input if
 * sanitizing would leave nothing.
 */
export function sanitizeSearchQuery(query: string): string {
  const cleaned = query
    .replace(/[+\-&|!(){}\[\]^"~*?:\\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || query.trim();
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
  return parseMassFromText(quantityText);
}

/**
 * Slice / piece weights are not a dedicated OFF field. Contributors sometimes
 * fill `serving_size` ("1 Scheibe (30 g)") and/or numeric `serving_quantity`.
 * `serving_quantity === 1` without a mass unit almost always means "1 serving",
 * not 1 gram — ignore those.
 */
function parseServingInfo(product: any): { grams?: number; label?: string } {
  const label = firstString(product?.serving_size);
  const fromText = label ? parseMassFromText(label) : undefined;
  if (fromText != null) return { grams: fromText, label };

  const unit = firstString(product?.serving_quantity_unit)?.toLowerCase();
  const qty = parseNumeric(product?.serving_quantity);
  if (qty != null && qty > 0) {
    const fromUnit = unit ? toGrams(qty, unit) : undefined;
    if (fromUnit != null) return { grams: fromUnit, label };
    // Bare number without unit: likely grams only when it looks like a weight.
    if (!unit && qty >= 5) return { grams: qty, label };
  }
  return { grams: undefined, label };
}

const MIN_UNIT_GRAMS = 0.5;
const MAX_UNIT_GRAMS = 3000;

/**
 * Derive "1 <unit> = <grams>" suggestions from an OFF product. OFF has no
 * dedicated field for this, so we read two independent, noisy sources:
 *   A. serving_size, e.g. "2 Scheiben (60 g)" → 60 / 2 = 30 g per Scheibe.
 *   B. quantity + product_quantity, e.g. "6 Scheiben" + 300 g → 50 g per Scheibe.
 * Community data is unreliable, so values are clamped to a sane range and
 * returned as suggestions to confirm — never applied silently. When both paths
 * yield the same unit, the higher-confidence serving_size value wins.
 */
export function deriveGramsByUnitFromOff(product: any): GramsPerUnitSuggestion[] {
  const byUnit = new Map<string, GramsPerUnitSuggestion>();
  const consider = (s: GramsPerUnitSuggestion | null): void => {
    if (!s) return;
    const existing = byUnit.get(s.unit);
    if (!existing || rankSuggestion(s) > rankSuggestion(existing)) byUnit.set(s.unit, s);
  };
  consider(suggestionFromServingSize(product));
  consider(suggestionFromQuantityTotal(product));
  return [...byUnit.values()];
}

function rankSuggestion(s: GramsPerUnitSuggestion): number {
  return s.confidence === 'high' ? 2 : 1;
}

function sanitizeUnitGrams(grams: number): number | undefined {
  if (!Number.isFinite(grams) || grams < MIN_UNIT_GRAMS || grams > MAX_UNIT_GRAMS) return undefined;
  return grams >= 10 ? Math.round(grams) : Math.round(grams * 10) / 10;
}

/** Leading count in a text like "2 Scheiben" / "6 x …"; defaults to 1. */
function leadingCount(text: string): number {
  const m = text.trim().match(/^(\d+(?:[.,]\d+)?)/);
  if (!m) return 1;
  const n = Number.parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function suggestionFromServingSize(product: any): GramsPerUnitSuggestion | null {
  const label = firstString(product?.serving_size);
  if (!label) return null;
  const unit = detectUnitInText(label);
  if (!unit) return null;
  const mass = parseMassFromText(label);
  if (mass == null) return null;
  const grams = sanitizeUnitGrams(mass / leadingCount(label));
  if (grams == null) return null;
  return { unit, gramsPerUnit: grams, source: 'serving', confidence: 'high' };
}

function suggestionFromQuantityTotal(product: any): GramsPerUnitSuggestion | null {
  const quantityText = firstString(product?.quantity);
  if (!quantityText) return null;
  const unit = detectUnitInText(quantityText);
  if (!unit) return null;
  const count = leadingCount(quantityText);
  if (!(count > 1)) return null; // "1 Scheibe" carries no ratio without a total
  const total = parseNumeric(product?.product_quantity) ?? parseMassFromText(quantityText);
  if (total == null || !(total > 0)) return null;
  const grams = sanitizeUnitGrams(total / count);
  if (grams == null) return null;
  return { unit, gramsPerUnit: grams, source: 'quantity', confidence: 'medium' };
}

function parseMassFromText(text: string): number | undefined {
  const paren = text.match(/\(([\d.,]+)\s*(kg|g|ml|l|cl)\)/i);
  if (paren) {
    const value = Number.parseFloat(paren[1].replace(',', '.'));
    if (Number.isFinite(value) && value > 0) return toGrams(value, paren[2]);
  }
  const match = text.match(/([\d.,]+)\s*(kg|g|ml|l|cl)\b/i);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1].replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return toGrams(value, match[2]);
}

function toGrams(value: number, unit: string): number | undefined {
  switch (unit.toLowerCase()) {
    case 'kg':
      return value * 1000;
    case 'g':
    case 'gr':
    case 'gram':
    case 'grams':
      return value;
    case 'l':
    case 'liter':
    case 'litre':
      return value * 1000; // assume density 1 for water-like liquids
    case 'cl':
      return value * 10;
    case 'ml':
    case 'milliliter':
    case 'millilitre':
      return value;
    default:
      return undefined;
  }
}

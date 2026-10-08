/**
 * Batch product import (website /produkte/import + app ProductBatchPage):
 * list entries built from lookups (own register or Open Food Facts) and the
 * rows sent to /api/products/batch/{match,commit}. Pure, browser-safe.
 */
import type { NutritionData } from '../types/recipe';

export interface BatchItem {
  /** List key (EAN or a generated id). */
  key: string;
  ean?: string;
  name: string;
  brand?: string;
  netGrams?: number;
  packageLabel?: string;
  nutritionPer100g?: NutritionData;
  imageUrl?: string;
  offCode?: string;
  source: 'local' | 'openfoodfacts';
  /** OFF generic name / categories — help the ingredient matching. */
  genericName?: string;
  categories?: string;
  /** Already in the own product register. */
  registered: boolean;
}

export interface BatchMatch {
  ingredient: string;
  existing: boolean;
  confidence: 'sicher' | 'vorschlag' | 'ki' | 'keine';
  reason: string;
  existingProductId?: string;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Entry from a lookup/search hit ({ source, product } of /api/products/lookup, or a register product). */
export function itemFromLookup(product: any, source: 'local' | 'openfoodfacts'): BatchItem | null {
  const name = str(product?.name);
  if (!name) return null;
  const raw = product?.raw ?? {};
  const ean = str(product.ean) ?? str(product.offCode);
  return {
    key: ean ?? `p-${Math.random().toString(36).slice(2, 10)}`,
    ean,
    name,
    brand: str(product.brand),
    netGrams: num(product.netGrams),
    packageLabel: str(product.packageLabel),
    nutritionPer100g: product.nutritionPer100g && typeof product.nutritionPer100g === 'object' ? product.nutritionPer100g : undefined,
    imageUrl: str(product.imageUrl),
    offCode: str(product.offCode),
    source,
    genericName: str(raw.generic_name_de) ?? str(raw.generic_name),
    categories: str(raw.categories),
    registered: source === 'local'
  };
}

/** Add without duplicates (same EAN). Returns the new list and whether it was added. */
export function addItem(list: BatchItem[], item: BatchItem): { list: BatchItem[]; added: boolean } {
  if (list.some((i) => i.key === item.key || (item.ean && i.ean === item.ean))) return { list, added: false };
  return { list: [...list, item], added: true };
}

export function matchRequest(items: BatchItem[]) {
  return items.map((i) => ({ ean: i.ean, name: i.name, brand: i.brand, genericName: i.genericName, categories: i.categories }));
}

export function commitRequest(items: BatchItem[], ingredients: string[], makeDefault: boolean[]) {
  return items.map((i, idx) => ({
    product: {
      ean: i.ean,
      name: i.name,
      brand: i.brand,
      netGrams: i.netGrams,
      packageLabel: i.packageLabel,
      nutritionPer100g: i.nutritionPer100g,
      imageUrl: i.imageUrl,
      offCode: i.offCode,
      source: i.source === 'openfoodfacts' ? 'openfoodfacts' : 'manual'
    },
    ingredient: (ingredients[idx] ?? '').trim(),
    makeDefault: !!makeDefault[idx]
  }));
}

export const CONFIDENCE_LABEL: Record<BatchMatch['confidence'], { label: string; cls: string }> = {
  sicher: { label: 'sicher', cls: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  vorschlag: { label: 'Vorschlag', cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
  ki: { label: 'KI-Vorschlag', cls: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300' },
  keine: { label: 'offen', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' }
};

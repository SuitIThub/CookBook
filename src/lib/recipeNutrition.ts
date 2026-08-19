import type {
  Ingredient,
  IngredientGroup,
  NutritionData,
  Quantity,
  Recipe,
} from '../types/recipe';
import type { CatalogueIngredient, Product } from '../types/tracker';
import { NUTRITION_FIELDS } from './nutrition';
import { convertToGrams, convertToMl, findUnit, lookupGramsPerUnit } from './units';

export type IngredientResolutionState = 'exact' | 'estimated' | 'incomplete';

export interface IngredientResolution {
  ingredientId: string;
  name: string;
  quantity: Quantity | null;
  grams: number | null;
  state: IngredientResolutionState;
  reason?: string; // human-readable explanation for incomplete/estimated
  contribution?: NutritionData; // absolute nutrition contribution for the whole recipe
  price?: number; // absolute price contribution for the whole recipe (EUR)
  priceEstimated?: boolean;
  matchedCatalogueId?: string;
  matchedProductId?: string;
}

export interface RecipeNutritionResult {
  perRecipe: NutritionData;
  perServing: NutritionData;
  servings: number;
  isEstimated: boolean;
  hasAnyData: boolean;
  ingredients: IngredientResolution[];
  incompleteIngredients: IngredientResolution[];
}

export interface RecipePriceResult {
  perRecipe: number;
  perServing: number;
  servings: number;
  isEstimated: boolean;
  hasAnyData: boolean;
  currency: 'EUR';
  ingredients: IngredientResolution[];
}

export interface RecipeNutritionInput {
  recipe: Recipe;
  visibleIngredients: Ingredient[];
  servings?: number;
  productAssignments?: Record<string, string>; // recipeIngredientId -> productId
  catalogueByName?: Map<string, CatalogueIngredient>;
  productsById?: Map<string, Product>;
}

export interface RecipePriceInput extends RecipeNutritionInput {
  supermarketId?: string;
}

/**
 * Resolve which product is assigned to a recipe ingredient.
 * - Missing key: fall back to the catalogue default.
 * - Empty string: user explicitly chose "no product".
 */
export function resolveAssignedProductId(
  ingredientId: string,
  assignments: Record<string, string> | undefined,
  defaultProductId?: string,
  _ingredientProductId?: string
): string | undefined {
  if (assignments && Object.prototype.hasOwnProperty.call(assignments, ingredientId)) {
    const value = assignments[ingredientId];
    return value ? value : undefined;
  }
  return defaultProductId || undefined;
}

/** recipeIngredientId → catalogue default product (shared register, not recipe-specific). */
export function assignmentsFromCatalogueDefaults(
  ingredients: Ingredient[],
  catalogueByName: Map<string, CatalogueIngredient>
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const ing of ingredients) {
    const cat = catalogueByName.get(ing.name.trim().toLowerCase());
    if (cat?.defaultProductId) map[ing.id] = cat.defaultProductId;
  }
  return map;
}

/** Write recipeIngredientId → productId onto the matching ingredients in the recipe JSON. */
export function applyProductAssignmentsToGroups(
  groups: (Ingredient | IngredientGroup)[] | undefined,
  assignments: Record<string, string>
): (Ingredient | IngredientGroup)[] {
  if (!Array.isArray(groups)) return [];
  return groups.map((item) => {
    if (!item) return item;
    if (Array.isArray((item as IngredientGroup).ingredients)) {
      const group = item as IngredientGroup;
      return {
        ...group,
        ingredients: applyProductAssignmentsToGroups(group.ingredients, assignments),
      };
    }
    const ing = item as Ingredient;
    if (!Object.prototype.hasOwnProperty.call(assignments, ing.id)) return ing;
    const value = assignments[ing.id];
    if (!value) {
      const { productId: _unused, ...rest } = ing;
      return rest;
    }
    return { ...ing, productId: value };
  });
}

/** Combine map + per-ingredient productId into one assignment map. */
export function productAssignmentsFromRecipe(recipe: Recipe): Record<string, string> {
  const map: Record<string, string> = { ...(recipe.productAssignments || {}) };
  for (const ing of collectIngredientsFromGroups(recipe.ingredientGroups)) {
    if (!Object.prototype.hasOwnProperty.call(map, ing.id) && ing.productId) {
      map[ing.id] = ing.productId;
    }
  }
  return map;
}

/**
 * When a supermarket is chosen, prefer a linked product that has a price there.
 * Keeps the current assignment if that product is already priced at the market.
 */
export function applySupermarketProductAssignments(input: {
  ingredients: Ingredient[];
  productAssignments?: Record<string, string>;
  catalogueByName?: Map<string, CatalogueIngredient>;
  productsByIngredientId?: Map<string, Product[]>;
  supermarketId?: string;
}): Record<string, string> {
  const next: Record<string, string> = { ...(input.productAssignments || {}) };
  if (!input.supermarketId) return next;
  for (const ingredient of input.ingredients) {
    const catalogue = input.catalogueByName?.get(ingredient.name.trim().toLowerCase());
    const products = catalogue ? input.productsByIngredientId?.get(catalogue.id) ?? [] : [];
    if (products.length === 0) continue;
    const currentId = resolveAssignedProductId(ingredient.id, next, catalogue?.defaultProductId);
    const picked = pickProductForSupermarket(products, input.supermarketId, currentId, catalogue?.defaultProductId);
    if (picked) next[ingredient.id] = picked;
  }
  return next;
}

function pickProductForSupermarket(
  products: Product[],
  supermarketId: string,
  currentId?: string,
  defaultProductId?: string
): string | undefined {
  const hasPrice = (id?: string): string | undefined => {
    if (!id) return undefined;
    const product = products.find((p) => p.id === id);
    if (!product) return undefined;
    return product.supermarkets.some((s) => s.supermarketId === supermarketId && Number.isFinite(s.price))
      ? id
      : undefined;
  };
  return (
    hasPrice(currentId)
    || hasPrice(defaultProductId)
    || products.find((p) => p.supermarkets.some((s) => s.supermarketId === supermarketId && Number.isFinite(s.price)))?.id
    || currentId
    || defaultProductId
  );
}

/**
 * Flatten the visible ingredients of a recipe. Callers should first apply
 * alternative filtering (`filterRecipeBySelection`) so the input already
 * reflects the active alternative selection. Nested ingredient groups are
 * expanded.
 */
export function collectIngredientsFromGroups(groups: (Ingredient | IngredientGroup)[] | undefined): Ingredient[] {
  const out: Ingredient[] = [];
  if (!Array.isArray(groups)) return out;
  const walk = (items: (Ingredient | IngredientGroup)[]): void => {
    for (const item of items) {
      if (!item) continue;
      if (Array.isArray((item as IngredientGroup).ingredients)) {
        walk((item as IngredientGroup).ingredients);
        continue;
      }
      out.push(item as Ingredient);
    }
  };
  walk(groups as (Ingredient | IngredientGroup)[]);
  return out;
}

/**
 * Resolve one ingredient's total gram weight for the whole recipe using
 * (in order):
 *   1. Weight units (g / kg) → exact.
 *   2. Product `gramsByUnit[unit]` → estimated (product-specific, e.g. 1 Scheibe = 30 g).
 *   3. Ingredient `gramsByUnit[unit]` → estimated, if the product has no mapping for this unit.
 *   4. ml (or ml-equivalent unit) * density → estimated.
 *   5. Nothing → null (incomplete).
 *
 * Nutrition contribution and price fall back to the catalogue ingredient's
 * data when no product is assigned.
 */
function resolveIngredient(
  ingredient: Ingredient,
  productAssignments: Record<string, string> | undefined,
  catalogueByName: Map<string, CatalogueIngredient> | undefined,
  productsById: Map<string, Product> | undefined,
  supermarketId: string | undefined
): IngredientResolution {
  const nameKey = ingredient.name.trim().toLowerCase();
  const catalogue = catalogueByName?.get(nameKey);
  const assignedProductId = resolveAssignedProductId(
    ingredient.id,
    productAssignments,
    catalogue?.defaultProductId
  );
  const product = assignedProductId ? productsById?.get(assignedProductId) : undefined;

  const quantities = Array.isArray(ingredient.quantities) ? ingredient.quantities : [];
  const primary = quantities[0];

  const density = catalogue?.densityGPerMl;

  let grams: number | null = null;
  let state: IngredientResolutionState = 'incomplete';
  let reason: string | undefined;

  if (!primary || !Number.isFinite(primary.amount)) {
    reason = 'keine Menge';
  } else {
    const amount = primary.amount;
    const unit = primary.unit || '';
    const canonicalUnit = findUnit(unit)?.name ?? unit;
    const weightGrams = convertToGrams(amount, unit);
    const productGramsPerUnit = lookupGramsPerUnit(product?.gramsByUnit, unit);
    const catalogueGramsPerUnit = lookupGramsPerUnit(catalogue?.gramsByUnit, unit);
    if (weightGrams != null) {
      grams = weightGrams;
      state = 'exact';
    } else if (productGramsPerUnit != null) {
      grams = amount * productGramsPerUnit;
      state = 'estimated';
      reason = `~ Produkt (${canonicalUnit})`;
    } else if (catalogueGramsPerUnit != null) {
      grams = amount * catalogueGramsPerUnit;
      state = 'estimated';
      reason = `~ Stückgewicht (${canonicalUnit})`;
    } else {
      const ml = convertToMl(amount, unit);
      if (ml != null && density != null && density > 0) {
        grams = ml * density;
        state = 'estimated';
        reason = `~ Dichte ${density} g/ml`;
      } else if (ml != null && density == null) {
        reason = `Dichte fehlt für ${ingredient.name}`;
      } else {
        reason = `keine Umrechnung für "${unit || 'ohne Einheit'}"`;
      }
    }
  }

  const resolution: IngredientResolution = {
    ingredientId: ingredient.id,
    name: ingredient.name,
    quantity: primary ?? null,
    grams,
    state,
    reason,
    matchedCatalogueId: catalogue?.id,
    matchedProductId: product?.id,
  };

  if (grams != null && grams > 0) {
    const nutritionSource = product?.nutritionPer100g ?? catalogue?.nutritionPer100g;
    if (nutritionSource) {
      const factor = grams / 100;
      const contribution: NutritionData = {};
      for (const field of NUTRITION_FIELDS) {
        const value = nutritionSource[field.key];
        if (value != null) contribution[field.key] = value * factor;
      }
      resolution.contribution = contribution;
    }

    if (product) {
      const priceInfo = pickProductPrice(product, supermarketId);
      if (priceInfo && product.netGrams && product.netGrams > 0) {
        const priceForRecipe = (grams / product.netGrams) * priceInfo.price;
        resolution.price = priceForRecipe;
        resolution.priceEstimated = priceInfo.estimated || state !== 'exact';
      }
    }
  }

  return resolution;
}

function pickProductPrice(product: Product, supermarketId: string | undefined): { price: number; estimated: boolean } | null {
  if (supermarketId) {
    const hit = product.supermarkets.find((s) => s.supermarketId === supermarketId);
    if (hit && Number.isFinite(hit.price)) return { price: hit.price, estimated: false };
  }
  if (product.defaultPrice != null && Number.isFinite(product.defaultPrice)) {
    return { price: product.defaultPrice, estimated: true };
  }
  const first = product.supermarkets[0];
  if (first && Number.isFinite(first.price)) return { price: first.price, estimated: true };
  return null;
}

/**
 * Compute recipe-level nutrition.
 *
 * 1. Sum the absolute nutrition contribution of every visible ingredient
 *    (grams / 100 * nutrition_per_100g). Missing catalogue data → the
 *    ingredient contributes nothing and is listed under `incompleteIngredients`.
 * 2. Divide by `servings` to get per-serving values.
 * 3. `isEstimated` becomes true as soon as any contributing ingredient's
 *    gram resolution was estimated (Stückgewicht or Dichte).
 */
export function computeRecipeNutrition(input: RecipeNutritionInput): RecipeNutritionResult {
  const servings = Math.max(1, input.servings ?? input.recipe.metadata?.servings ?? 1);
  const ingredients = input.visibleIngredients;
  const catalogue = input.catalogueByName;
  const products = input.productsById;

  const resolutions: IngredientResolution[] = ingredients.map((ing) =>
    resolveIngredient(ing, input.productAssignments, catalogue, products, undefined)
  );

  const perRecipe: NutritionData = {};
  let hasAnyData = false;
  let isEstimated = false;

  for (const res of resolutions) {
    if (!res.contribution) continue;
    hasAnyData = true;
    if (res.state === 'estimated') isEstimated = true;
    for (const field of NUTRITION_FIELDS) {
      const value = res.contribution[field.key];
      if (value == null) continue;
      perRecipe[field.key] = (perRecipe[field.key] ?? 0) + value;
    }
  }

  const perServing: NutritionData = {};
  for (const field of NUTRITION_FIELDS) {
    const total = perRecipe[field.key];
    if (total == null) continue;
    perServing[field.key] = total / servings;
  }

  return {
    perRecipe,
    perServing,
    servings,
    isEstimated,
    hasAnyData,
    ingredients: resolutions,
    incompleteIngredients: resolutions.filter((r) => r.state === 'incomplete'),
  };
}

/**
 * Compute recipe-level price, using supermarket-specific prices when
 * available and falling back to product defaults.
 */
export function computeRecipePrice(input: RecipePriceInput): RecipePriceResult {
  const servings = Math.max(1, input.servings ?? input.recipe.metadata?.servings ?? 1);
  const ingredients = input.visibleIngredients;
  const catalogue = input.catalogueByName;
  const products = input.productsById;

  const resolutions: IngredientResolution[] = ingredients.map((ing) =>
    resolveIngredient(ing, input.productAssignments, catalogue, products, input.supermarketId)
  );

  let perRecipe = 0;
  let hasAnyData = false;
  let isEstimated = false;
  for (const res of resolutions) {
    if (res.price == null) continue;
    hasAnyData = true;
    perRecipe += res.price;
    if (res.priceEstimated) isEstimated = true;
  }

  return {
    perRecipe,
    perServing: perRecipe / servings,
    servings,
    isEstimated,
    hasAnyData,
    currency: 'EUR',
    ingredients: resolutions,
  };
}

/** Round nutrition values in-place to at most 2 decimal places (for display/snapshotting). */
export function roundNutritionValues(data: NutritionData): NutritionData {
  const out: NutritionData = {};
  for (const key of Object.keys(data) as (keyof NutritionData)[]) {
    const v = data[key];
    if (v == null) continue;
    out[key] = Math.round(v * 100) / 100;
  }
  return out;
}

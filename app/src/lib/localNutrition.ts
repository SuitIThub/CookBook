/**
 * Local live nutrition + price for a recipe, computed entirely on-device from the
 * synced ingredient catalogue + products — the offline-first counterpart of the
 * server's /api/recipes/[id]/live-nutrition endpoint, reusing the same shared
 * pure functions so results match.
 */
import { getLocalDb } from './localDb';
import type { Recipe, NutritionData } from '@shared/recipe';
import type { CatalogueIngredient, Product } from '@shared/tracker';
import {
  collectIngredientsFromGroups,
  computeRecipeNutrition,
  computeRecipePrice,
  roundNutritionValues,
  assignmentsFromCatalogueDefaults,
  applySupermarketProductAssignments,
  resolveAssignedProductId
} from '@core/recipeNutrition';
import { filterRecipeBySelection, mergeSelection } from '@core/alternatives';

export interface LiveNutrition {
  nutrition: {
    perServing: NutritionData;
    perRecipe: NutritionData;
    servings: number;
    isEstimated: boolean;
    hasAnyData: boolean;
  };
  price: {
    perServing: number;
    perRecipe: number;
    currency: string;
    isEstimated: boolean;
    hasAnyData: boolean;
  };
}

export async function computeLocalRecipeNutrition(
  recipe: Recipe,
  opts?: { servings?: number; supermarketId?: string; alternativeSelection?: Record<string, string> }
): Promise<LiveNutrition> {
  const { db } = await getLocalDb();
  const servings = opts?.servings && opts.servings > 0 ? opts.servings : recipe.metadata.servings;

  const selection = mergeSelection(recipe, opts?.alternativeSelection ?? {});
  const filtered = filterRecipeBySelection(recipe, selection);
  const visible = collectIngredientsFromGroups(filtered.ingredientGroups);

  const catalogueByName = new Map<string, CatalogueIngredient>();
  const productsById = new Map<string, Product>();
  const uniqueNames = Array.from(
    new Set(visible.map((i) => i.name.trim().toLowerCase()).filter(Boolean))
  );
  for (const name of uniqueNames) {
    const cat = db.getCatalogueIngredientByName(name);
    if (!cat) continue;
    catalogueByName.set(name, cat);
    for (const p of db.getProductsForIngredient(cat.id)) productsById.set(p.id, p);
    if (cat.defaultProductId && !productsById.has(cat.defaultProductId)) {
      const dp = db.getProduct(cat.defaultProductId);
      if (dp) productsById.set(dp.id, dp);
    }
  }
  const productAssignments = assignmentsFromCatalogueDefaults(visible, catalogueByName);

  const nutrition = computeRecipeNutrition({
    recipe,
    visibleIngredients: visible,
    servings,
    productAssignments,
    catalogueByName,
    productsById
  });
  const price = computeRecipePrice({
    recipe,
    visibleIngredients: visible,
    servings,
    productAssignments,
    catalogueByName,
    productsById,
    supermarketId: opts?.supermarketId
  });

  return {
    nutrition: {
      perServing: roundNutritionValues(nutrition.perServing),
      perRecipe: roundNutritionValues(nutrition.perRecipe),
      servings: nutrition.servings,
      isEstimated: nutrition.isEstimated,
      hasAnyData: nutrition.hasAnyData
    },
    price: {
      perServing: Math.round(price.perServing * 100) / 100,
      perRecipe: Math.round(price.perRecipe * 100) / 100,
      currency: price.currency,
      isEstimated: price.isEstimated,
      hasAnyData: price.hasAnyData
    }
  };
}

/* ------------------------------------------------------------------------ */
/* LiveNutritionPanel (recipe detail) — the full on-device counterpart of the
   website panel + /api/recipes/[id]/live-nutrition: product per ingredient,
   supermarket-based product choice, incomplete-ingredient reasons. */

export interface LivePanelIngredient {
  id: string;
  name: string;
  catalogueId?: string;
  defaultProductId?: string;
  products: { id: string; name: string; brand?: string }[];
}

export interface LivePanelResult {
  ingredients: LivePanelIngredient[];
  supermarkets: { id: string; name: string }[];
  nutrition: {
    perServing: NutritionData;
    isEstimated: boolean;
    hasAnyData: boolean;
    incomplete: { id: string; name: string; reason?: string }[];
  };
  price: { perServing: number; perRecipe: number; isEstimated: boolean; hasAnyData: boolean };
  /** Resolved product per ingredient id ('' = none). */
  productAssignments: Record<string, string>;
}

export async function computeLivePanel(
  recipe: Recipe,
  opts: {
    productAssignments?: Record<string, string>;
    supermarketId?: string;
    applySupermarket?: boolean;
    servings?: number;
  } = {}
): Promise<LivePanelResult> {
  const { db } = await getLocalDb();
  const servings = opts.servings && opts.servings > 0 ? opts.servings : recipe.metadata.servings;
  const selection = mergeSelection(recipe, {});
  const visible = collectIngredientsFromGroups(filterRecipeBySelection(recipe, selection).ingredientGroups);

  const catalogueByName = new Map<string, CatalogueIngredient>();
  const productsById = new Map<string, Product>();
  const productsByIngredientId = new Map<string, Product[]>();
  for (const name of Array.from(new Set(visible.map((i) => i.name.trim().toLowerCase()).filter(Boolean)))) {
    const cat = db.getCatalogueIngredientByName(name);
    if (!cat) continue;
    catalogueByName.set(name, cat);
    const products = db.getProductsForIngredient(cat.id) as Product[];
    productsByIngredientId.set(cat.id, products);
    for (const p of products) productsById.set(p.id, p);
    if (cat.defaultProductId && !productsById.has(cat.defaultProductId)) {
      const dp = db.getProduct(cat.defaultProductId);
      if (dp) productsById.set(dp.id, dp);
    }
  }

  let productAssignments: Record<string, string> = {
    ...assignmentsFromCatalogueDefaults(visible, catalogueByName),
    ...(opts.productAssignments ?? {})
  };
  if (opts.applySupermarket && opts.supermarketId) {
    productAssignments = applySupermarketProductAssignments({
      ingredients: visible,
      productAssignments,
      catalogueByName,
      productsByIngredientId,
      supermarketId: opts.supermarketId
    });
  }
  for (const pid of Object.values(productAssignments)) {
    if (pid && !productsById.has(pid)) {
      const p = db.getProduct(pid);
      if (p) productsById.set(p.id, p);
    }
  }

  const nutrition = computeRecipeNutrition({ recipe, visibleIngredients: visible, servings, productAssignments, catalogueByName, productsById });
  const price = computeRecipePrice({
    recipe,
    visibleIngredients: visible,
    servings,
    productAssignments,
    catalogueByName,
    productsById,
    supermarketId: opts.supermarketId
  });

  const ingredients: LivePanelIngredient[] = visible.map((ing) => {
    const cat = catalogueByName.get(ing.name.trim().toLowerCase());
    const products = cat ? productsByIngredientId.get(cat.id) ?? [] : [];
    return {
      id: ing.id,
      name: ing.name,
      catalogueId: cat?.id,
      defaultProductId: cat?.defaultProductId,
      products: products.map((p) => ({ id: p.id, name: p.name, brand: p.brand }))
    };
  });
  const resolved: Record<string, string> = {};
  for (const ing of ingredients) {
    resolved[ing.id] = resolveAssignedProductId(ing.id, productAssignments, ing.defaultProductId) || '';
  }

  return {
    ingredients,
    supermarkets: (db.getAllSupermarkets() as { id: string; name: string }[]).map((s) => ({ id: s.id, name: s.name })),
    nutrition: {
      perServing: roundNutritionValues(nutrition.perServing),
      isEstimated: nutrition.isEstimated,
      hasAnyData: nutrition.hasAnyData,
      incomplete: nutrition.incompleteIngredients.map((r: any) => ({ id: r.ingredientId, name: r.name, reason: r.reason }))
    },
    price: {
      perServing: Math.round(price.perServing * 100) / 100,
      perRecipe: Math.round(price.perRecipe * 100) / 100,
      isEstimated: price.isEstimated,
      hasAnyData: price.hasAnyData
    },
    productAssignments: resolved
  };
}

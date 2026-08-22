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
  assignmentsFromCatalogueDefaults
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

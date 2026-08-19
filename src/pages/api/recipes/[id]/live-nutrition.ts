import type { APIRoute } from 'astro';
import { db } from '../../../../lib/database';
import {
  collectIngredientsFromGroups,
  computeRecipeNutrition,
  computeRecipePrice,
  roundNutritionValues,
  applySupermarketProductAssignments,
  assignmentsFromCatalogueDefaults,
} from '../../../../lib/recipeNutrition';
import {
  filterRecipeBySelection,
  mergeSelection,
} from '../../../../lib/alternatives';
import type { CatalogueIngredient, Product } from '../../../../types/tracker';

/**
 * Recompute per-recipe / per-serving nutrition and price for a recipe using
 * a client-provided product assignment map + optional supermarket + optional
 * servings override.
 */
export const POST: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return json({ error: 'id required' }, 400);
  const recipe = db.getRecipe(id);
  if (!recipe) return json({ error: 'not found' }, 404);

  let body: any = {};
  try {
    body = await request.json();
  } catch (error) {
    body = {};
  }
  const incomingAssignments: Record<string, string> = body?.productAssignments && typeof body.productAssignments === 'object'
    ? Object.fromEntries(
        Object.entries(body.productAssignments)
          .filter(([, v]) => typeof v === 'string')
          .map(([k, v]) => [k, v as string])
      )
    : {};
  const supermarketId: string | undefined = typeof body?.supermarketId === 'string' && body.supermarketId ? body.supermarketId : undefined;
  const applySupermarket = body?.applySupermarket === true;
  const servingsRaw = Number(body?.servings);
  const servings = Number.isFinite(servingsRaw) && servingsRaw > 0 ? servingsRaw : recipe.metadata.servings;

  const alternativeSelection = mergeSelection(recipe, body?.alternativeSelection ?? {});
  const filtered = filterRecipeBySelection(recipe, alternativeSelection);
  const visible = collectIngredientsFromGroups(filtered.ingredientGroups);

  const catalogueByName = new Map<string, CatalogueIngredient>();
  const productsById = new Map<string, Product>();
  const productsByIngredientId = new Map<string, Product[]>();
  const uniqueNames = Array.from(new Set(visible.map((i) => i.name.trim().toLowerCase()).filter(Boolean)));
  for (const name of uniqueNames) {
    const cat = db.getCatalogueIngredientByName(name);
    if (!cat) continue;
    catalogueByName.set(name, cat);
    const products = db.getProductsForIngredient(cat.id);
    productsByIngredientId.set(cat.id, products);
    for (const product of products) productsById.set(product.id, product);
    if (cat.defaultProductId && !productsById.has(cat.defaultProductId)) {
      const dp = db.getProduct(cat.defaultProductId);
      if (dp) productsById.set(dp.id, dp);
    }
  }
  let productAssignments: Record<string, string> = {
    ...assignmentsFromCatalogueDefaults(visible, catalogueByName),
    ...incomingAssignments,
  };
  if (applySupermarket && supermarketId) {
    productAssignments = applySupermarketProductAssignments({
      ingredients: visible,
      productAssignments,
      catalogueByName,
      productsByIngredientId,
      supermarketId,
    });
  }
  for (const productId of Object.values(productAssignments)) {
    if (productId && !productsById.has(productId)) {
      const p = db.getProduct(productId);
      if (p) productsById.set(p.id, p);
    }
  }

  const nutrition = computeRecipeNutrition({
    recipe,
    visibleIngredients: visible,
    servings,
    productAssignments,
    catalogueByName,
    productsById,
  });
  const price = computeRecipePrice({
    recipe,
    visibleIngredients: visible,
    servings,
    productAssignments,
    catalogueByName,
    productsById,
    supermarketId,
  });

  return json({
    nutrition: {
      perRecipe: roundNutritionValues(nutrition.perRecipe),
      perServing: roundNutritionValues(nutrition.perServing),
      servings: nutrition.servings,
      isEstimated: nutrition.isEstimated,
      hasAnyData: nutrition.hasAnyData,
      incomplete: nutrition.incompleteIngredients.map((r) => ({ id: r.ingredientId, name: r.name, reason: r.reason })),
    },
    price: {
      perRecipe: Math.round(price.perRecipe * 100) / 100,
      perServing: Math.round(price.perServing * 100) / 100,
      servings: price.servings,
      isEstimated: price.isEstimated,
      hasAnyData: price.hasAnyData,
      currency: price.currency,
    },
    productAssignments,
    supermarketId: supermarketId || null,
  });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

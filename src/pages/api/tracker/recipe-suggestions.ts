import type { APIRoute } from 'astro';
import { db } from '../../../lib/database.server';
import { collectIngredientsFromGroups, computeRecipeNutrition } from '../../../lib/recipeNutrition';
import { filterRecipeBySelection, getDefaultSelection, resolveSelection } from '../../../lib/alternatives';
import type { CatalogueIngredient, Product } from '../../../types/tracker';

/**
 * Recipes that fit the remaining daily budget: given `kcal` (and optionally
 * `protein`) left for today, return published recipes whose per-serving values
 * meaningfully fill that budget without blowing it. Uses the same live nutrition
 * engine as the recipe view, falling back to the recipe's manual per-serving
 * nutrition when nothing is computable.
 */
export const GET: APIRoute = async ({ url }) => {
  const params = new URL(url).searchParams;
  const remainingKcal = Number(params.get('kcal'));
  const remainingProtein = Number(params.get('protein'));
  const limit = Math.min(20, Math.max(1, Number.parseInt(params.get('limit') || '6', 10) || 6));
  if (!Number.isFinite(remainingKcal) || remainingKcal <= 0) {
    return json({ remainingKcal: 0, suggestions: [] });
  }

  // Build catalogue + product lookup maps once so per-recipe compute stays cheap.
  const catalogueByName = new Map<string, CatalogueIngredient>();
  for (const cat of db.getAllCatalogueIngredients()) {
    catalogueByName.set(cat.name.trim().toLowerCase(), cat);
  }
  const productsById = new Map<string, Product>();
  for (const product of db.getAllProducts()) productsById.set(product.id, product);

  const minKcal = remainingKcal * 0.35; // ignore tiny snacks that barely use the budget
  const maxKcal = remainingKcal * 1.1; // small overshoot tolerated
  const wantProtein = Number.isFinite(remainingProtein) && remainingProtein > 0;

  interface Scored {
    id: string;
    title: string;
    imageUrl?: string;
    kcal: number;
    protein: number;
    estimated: boolean;
    score: number;
  }
  const scored: Scored[] = [];

  for (const recipe of db.getAllRecipes()) {
    const selection = resolveSelection(recipe, getDefaultSelection(recipe));
    const filtered = filterRecipeBySelection(recipe, selection);
    const visible = collectIngredientsFromGroups(filtered.ingredientGroups);
    const res = computeRecipeNutrition({
      recipe,
      visibleIngredients: visible,
      servings: recipe.metadata?.servings,
      catalogueByName,
      productsById,
    });

    let kcal = res.perServing.calories ?? undefined;
    let protein = res.perServing.protein ?? undefined;
    let estimated = res.isEstimated;
    if (kcal == null && recipe.metadata?.nutrition?.calories != null) {
      kcal = recipe.metadata.nutrition.calories;
      protein = recipe.metadata.nutrition.protein ?? undefined;
      estimated = true; // manual recipe figure, not computed from products
    }
    if (kcal == null || !(kcal > 0) || kcal < minKcal || kcal > maxKcal) continue;

    const p = Number(protein) || 0;
    // Prefer protein density when protein is the constraint; otherwise the recipe
    // that best fills the remaining calories.
    const score = wantProtein ? p / Math.max(1, kcal) : -Math.abs(kcal - remainingKcal);
    scored.push({
      id: recipe.id,
      title: recipe.title,
      imageUrl: recipe.imageUrl || recipe.images?.[0]?.url,
      kcal: Math.round(kcal),
      protein: Math.round(p),
      estimated,
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const suggestions = scored.slice(0, limit).map(({ score: _score, ...rest }) => rest);
  return json({ remainingKcal: Math.round(remainingKcal), suggestions });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

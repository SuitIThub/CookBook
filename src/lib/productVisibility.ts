import type {
  Ingredient,
  IngredientGroup,
  PreparationGroup,
  PreparationStep,
  ProductVisibilityCondition,
  Recipe,
} from '../types/recipe';

/**
 * Product-selection visibility is a SEPARATE, RUNTIME-only axis from the
 * alternatives system. It is intentionally not part of `alternatives.ts` so
 * that:
 *   - server-side consumers (shopping list, cooking mode, `filterRecipeBySelection`)
 *     do not need to know about the ephemeral product assignments,
 *   - `VisibilityCondition.optionIds` keeps referring to alternative Ingredient
 *     IDs only,
 *   - and the alternative fix-point iteration stays unchanged.
 *
 * Apply this AFTER the alternative filter has run: nodes filtered out by
 * alternatives are already gone; product visibility just further hides nodes
 * from view when the required products are not currently assigned.
 */

/** True when a product-visibility condition is satisfied by the set of currently assigned product IDs. */
export function isProductVisibilitySatisfied(
  condition: ProductVisibilityCondition | undefined,
  assignedProductIds: ReadonlySet<string>
): boolean {
  if (!condition || !Array.isArray(condition.productIds) || condition.productIds.length === 0) {
    return true;
  }
  return condition.productIds.some((id) => assignedProductIds.has(id));
}

/** Compute the set of assigned product IDs from a `productAssignments` map. */
export function assignedProductIdSet(assignments: Record<string, string> | undefined): Set<string> {
  const set = new Set<string>();
  if (!assignments) return set;
  for (const value of Object.values(assignments)) {
    if (typeof value === 'string' && value) set.add(value);
  }
  return set;
}

/**
 * Recursively filter ingredient groups by product visibility, dropping any
 * node whose `visibleWhenProducts` is not satisfied.
 */
export function filterIngredientGroupsByProducts(
  groups: (Ingredient | IngredientGroup)[] | undefined,
  assigned: ReadonlySet<string>
): (Ingredient | IngredientGroup)[] {
  if (!Array.isArray(groups)) return [];
  const out: (Ingredient | IngredientGroup)[] = [];
  for (const item of groups) {
    if (!item) continue;
    if (Array.isArray((item as IngredientGroup).ingredients)) {
      const group = item as IngredientGroup;
      if (!isProductVisibilitySatisfied(group.visibleWhenProducts, assigned)) continue;
      out.push({
        ...group,
        ingredients: filterIngredientGroupsByProducts(group.ingredients, assigned),
      });
      continue;
    }
    const ing = item as Ingredient;
    if (!isProductVisibilitySatisfied(ing.visibleWhenProducts, assigned)) continue;
    out.push(ing);
  }
  return out;
}

/** Same as `filterIngredientGroupsByProducts` but for preparation groups/steps. */
export function filterPreparationGroupsByProducts(
  groups: (PreparationStep | PreparationGroup)[] | undefined,
  assigned: ReadonlySet<string>
): (PreparationStep | PreparationGroup)[] {
  if (!Array.isArray(groups)) return [];
  const out: (PreparationStep | PreparationGroup)[] = [];
  for (const item of groups) {
    if (!item) continue;
    if (Array.isArray((item as PreparationGroup).steps)) {
      const group = item as PreparationGroup;
      if (!isProductVisibilitySatisfied(group.visibleWhenProducts, assigned)) continue;
      out.push({
        ...group,
        steps: filterPreparationGroupsByProducts(group.steps, assigned),
      });
      continue;
    }
    const step = item as PreparationStep;
    if (!isProductVisibilitySatisfied(step.visibleWhenProducts, assigned)) continue;
    out.push(step);
  }
  return out;
}

/**
 * Convenience: apply product-visibility filtering to a whole recipe.
 * The caller is expected to have already applied `filterRecipeBySelection`
 * for alternatives.
 */
export function filterRecipeByProducts(recipe: Recipe, assignments: Record<string, string> | undefined): Recipe {
  // Nodes without a condition always stay visible; nodes WITH a condition are
  // only kept when one of their products is in the assigned set (so with an
  // empty set, conditional nodes are hidden). Both cases are handled uniformly
  // by isProductVisibilitySatisfied, so no special-casing of the empty set.
  const assigned = assignedProductIdSet(assignments);
  return {
    ...recipe,
    ingredientGroups: filterIngredientGroupsByProducts(recipe.ingredientGroups, assigned) as IngredientGroup[],
    preparationGroups: filterPreparationGroupsByProducts(recipe.preparationGroups, assigned) as PreparationGroup[],
  };
}

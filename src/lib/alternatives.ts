import type {
  Recipe,
  Ingredient,
  IngredientGroup,
  PreparationStep,
  PreparationGroup,
  VisibilityCondition,
} from '../types/recipe';

// Central, isomorphic logic for alternative ingredients and dependency visibility.
// Used both server-side (shopping list, cooking mode) and client-side (recipe view).

export interface AlternativeOption {
  id: string;
  name: string;
}

export interface AlternativeGroupInfo {
  id: string;
  label?: string;
  options: AlternativeOption[];
  defaultOptionId: string;
}

// Maps an alternative group id to the currently selected option id.
export type AlternativeSelection = Record<string, string>;

function isIngredientGroup(item: Ingredient | IngredientGroup): item is IngredientGroup {
  return Array.isArray((item as IngredientGroup).ingredients);
}

function isPreparationGroup(step: PreparationStep | PreparationGroup): step is PreparationGroup {
  return Array.isArray((step as PreparationGroup).steps);
}

/**
 * Collect all alternative groups defined in a recipe (recursively across nested
 * ingredient groups). Each group lists its member options (the alternative
 * ingredients) and the default option id.
 */
export function getAlternativeGroups(recipe: Recipe): Map<string, AlternativeGroupInfo> {
  const groups = new Map<string, AlternativeGroupInfo>();

  const walk = (items: (Ingredient | IngredientGroup)[] | undefined): void => {
    for (const item of items || []) {
      if (isIngredientGroup(item)) {
        walk(item.ingredients);
        continue;
      }
      const ing = item as Ingredient;
      if (ing.alternativeGroupId) {
        let info = groups.get(ing.alternativeGroupId);
        if (!info) {
          info = {
            id: ing.alternativeGroupId,
            label: ing.alternativeGroupLabel,
            options: [],
            defaultOptionId: '',
          };
          groups.set(ing.alternativeGroupId, info);
        }
        if (!info.label && ing.alternativeGroupLabel) {
          info.label = ing.alternativeGroupLabel;
        }
        info.options.push({ id: ing.id, name: ing.name });
        if (ing.isAlternativeDefault && !info.defaultOptionId) {
          info.defaultOptionId = ing.id;
        }
      }
    }
  };

  for (const group of recipe.ingredientGroups || []) {
    walk(group.ingredients);
  }

  // Ensure every group has a default; fall back to the first option.
  for (const info of groups.values()) {
    if (!info.defaultOptionId && info.options.length > 0) {
      info.defaultOptionId = info.options[0].id;
    }
  }

  return groups;
}

/** Build a map from option id (alternative ingredient id) to its group id. */
export function getOptionToGroupMap(recipe: Recipe): Map<string, string> {
  const map = new Map<string, string>();
  for (const [groupId, info] of getAlternativeGroups(recipe)) {
    for (const option of info.options) {
      map.set(option.id, groupId);
    }
  }
  return map;
}

/** The default selection: for each alternative group, the default option id. */
export function getDefaultSelection(recipe: Recipe): AlternativeSelection {
  const selection: AlternativeSelection = {};
  for (const [groupId, info] of getAlternativeGroups(recipe)) {
    selection[groupId] = info.defaultOptionId;
  }
  return selection;
}

/**
 * Whether a visibleWhen condition is satisfied for the given selection.
 * An empty/absent condition is always satisfied. If a referenced option no
 * longer exists, the dependency is considered void (item stays visible).
 */
export function isVisibleWhenSatisfied(
  visibleWhen: VisibilityCondition | undefined,
  selection: AlternativeSelection,
  optionToGroup: Map<string, string>,
): boolean {
  if (!visibleWhen || !visibleWhen.optionIds || visibleWhen.optionIds.length === 0) {
    return true;
  }
  for (const optionId of visibleWhen.optionIds) {
    const groupId = optionToGroup.get(optionId);
    if (!groupId) {
      // Referenced option was deleted -> dependency void -> visible.
      return true;
    }
    if (selection[groupId] === optionId) {
      return true;
    }
  }
  return false;
}

type AnyNode = Ingredient | IngredientGroup | PreparationStep | PreparationGroup;

/**
 * Whether a node (ingredient, group, step) is visible for the given selection.
 * Considers both alternative membership (an alternative ingredient is only
 * visible when it is the selected option) and visibleWhen dependencies.
 */
export function isNodeVisible(
  node: AnyNode,
  selection: AlternativeSelection,
  optionToGroup: Map<string, string>,
): boolean {
  const altId = (node as Ingredient).alternativeGroupId;
  if (altId) {
    const selected = selection[altId];
    if (selected && selected !== (node as Ingredient).id) {
      return false;
    }
  }
  return isVisibleWhenSatisfied((node as { visibleWhen?: VisibilityCondition }).visibleWhen, selection, optionToGroup);
}

/** Merge a partial override selection on top of the recipe's default selection. */
export function mergeSelection(recipe: Recipe, override?: AlternativeSelection | null): AlternativeSelection {
  const base = getDefaultSelection(recipe);
  if (!override) return base;
  const groups = getAlternativeGroups(recipe);
  for (const [groupId, optionId] of Object.entries(override)) {
    const info = groups.get(groupId);
    // Only accept overrides that reference an existing option of the group.
    if (info && info.options.some((o) => o.id === optionId)) {
      base[groupId] = optionId;
    }
  }
  return base;
}

/**
 * Return a deep-ish copy of the recipe containing only the items visible for
 * the given selection (defaults to the recipe's default selection). Used by the
 * shopping list, cooking mode and other server-side consumers.
 */
export function filterRecipeBySelection(recipe: Recipe, selection?: AlternativeSelection): Recipe {
  const optionToGroup = getOptionToGroupMap(recipe);
  const sel = selection || getDefaultSelection(recipe);

  const filterIngredients = (
    items: (Ingredient | IngredientGroup)[] | undefined,
  ): (Ingredient | IngredientGroup)[] => {
    const out: (Ingredient | IngredientGroup)[] = [];
    for (const item of items || []) {
      if (isIngredientGroup(item)) {
        if (!isVisibleWhenSatisfied(item.visibleWhen, sel, optionToGroup)) continue;
        out.push({ ...item, ingredients: filterIngredients(item.ingredients) });
      } else {
        if (!isNodeVisible(item, sel, optionToGroup)) continue;
        out.push({ ...item });
      }
    }
    return out;
  };

  const filterSteps = (
    items: (PreparationStep | PreparationGroup)[] | undefined,
  ): (PreparationStep | PreparationGroup)[] => {
    const out: (PreparationStep | PreparationGroup)[] = [];
    for (const item of items || []) {
      if (isPreparationGroup(item)) {
        if (!isVisibleWhenSatisfied(item.visibleWhen, sel, optionToGroup)) continue;
        out.push({ ...item, steps: filterSteps(item.steps) });
      } else {
        if (!isVisibleWhenSatisfied(item.visibleWhen, sel, optionToGroup)) continue;
        out.push({ ...item });
      }
    }
    return out;
  };

  return {
    ...recipe,
    ingredientGroups: (recipe.ingredientGroups || [])
      .filter((g) => isVisibleWhenSatisfied(g.visibleWhen, sel, optionToGroup))
      .map((g) => ({ ...g, ingredients: filterIngredients(g.ingredients) })),
    preparationGroups: (recipe.preparationGroups || [])
      .filter((g) => isVisibleWhenSatisfied(g.visibleWhen, sel, optionToGroup))
      .map((g) => ({ ...g, steps: filterSteps(g.steps) })),
  };
}

/**
 * Build the alternativeSelections structure stored on a ShoppingListRecipe.
 */
export function buildShoppingAlternativeSelections(
  recipe: Recipe,
  selection?: AlternativeSelection,
): { groupId: string; label?: string; selectedOptionId: string; options: AlternativeOption[] }[] {
  const sel = selection || getDefaultSelection(recipe);
  const result: { groupId: string; label?: string; selectedOptionId: string; options: AlternativeOption[] }[] = [];
  for (const [groupId, info] of getAlternativeGroups(recipe)) {
    result.push({
      groupId,
      label: info.label,
      selectedOptionId: sel[groupId] || info.defaultOptionId,
      options: info.options,
    });
  }
  return result;
}

/**
 * Recipe entities to Markdown. Each entity type has a corresponding toMarkdown
 * function so the format lives in one place and the API can expose it.
 */

import type {
  Recipe,
  RecipeMetadata,
  TimeEntry,
  Ingredient,
  IngredientGroup,
  Quantity,
  PreparationStep,
  PreparationGroup,
} from '../types/recipe';

export function timeEntryToMarkdown(entry: TimeEntry): string {
  return `- ${entry.label}: ${entry.minutes} Min`;
}

export function metadataToMarkdown(meta: RecipeMetadata): string {
  const lines: string[] = [`Portionen: ${meta.servings}`];
  if (meta.difficulty) {
    lines.push(`Schwierigkeit: ${meta.difficulty}`);
  }
  if (meta.timeEntries?.length) {
    lines.push('Zeiten:');
    meta.timeEntries.forEach((e) => lines.push(timeEntryToMarkdown(e)));
  }
  if (meta.nutrition && typeof meta.nutrition === 'object') {
    const n = meta.nutrition;
    const parts: string[] = [];
    if (n.calories != null) parts.push(`${n.calories} kcal`);
    if (n.carbohydrates != null) parts.push(`${n.carbohydrates} g Kohlenhydrate`);
    if (n.protein != null) parts.push(`${n.protein} g Protein`);
    if (n.fat != null) parts.push(`${n.fat} g Fett`);
    if (parts.length) lines.push(`Nährwerte (pro Portion): ${parts.join(', ')}`);
  }
  return lines.join('\n');
}

export function quantityToMarkdown(q: Quantity): string {
  const u = (q.unit || '').trim();
  return u ? `${q.amount} ${u}` : String(q.amount);
}

export function ingredientToMarkdown(ing: Ingredient): string {
  const amt =
    ing.quantities?.length > 0
      ? quantityToMarkdown(ing.quantities[0])
      : '';
  const desc = ing.description?.trim() ? ` (${ing.description})` : '';
  return amt ? `- ${ing.name}: ${amt}${desc}` : `- ${ing.name}${desc}`;
}

function isIngredientGroup(item: Ingredient | IngredientGroup): item is IngredientGroup {
  return Array.isArray((item as IngredientGroup).ingredients);
}

export function ingredientGroupToMarkdown(group: IngredientGroup): string {
  const lines: string[] = [];
  if (group.title?.trim()) {
    lines.push(`## ${group.title}`);
  }
  (group.ingredients || []).forEach((item) => {
    if (isIngredientGroup(item)) {
      lines.push(ingredientGroupToMarkdown(item));
    } else if (item?.name) {
      lines.push(ingredientToMarkdown(item));
    }
  });
  return lines.join('\n');
}

export function preparationStepToMarkdown(step: PreparationStep, index: number): string {
  return `${index + 1}. ${step.text || ''}`;
}

function isPreparationGroup(step: PreparationStep | PreparationGroup): step is PreparationGroup {
  return Array.isArray((step as PreparationGroup).steps);
}

export function preparationGroupToMarkdown(group: PreparationGroup): string {
  const lines: string[] = [];
  if (group.title?.trim()) {
    lines.push(`## ${group.title}`);
  }
  (group.steps || []).forEach((step, i) => {
    if (isPreparationGroup(step)) {
      lines.push(preparationGroupToMarkdown(step));
    } else if (step?.text) {
      lines.push(preparationStepToMarkdown(step, i));
    }
  });
  return lines.join('\n');
}

/**
 * Convert a full recipe to Markdown. Used by the recipe markdown API and
 * by any consumer that needs the canonical recipe-as-document format.
 */
export function recipeToMarkdown(recipe: Recipe): string {
  const sections: string[] = [];

  sections.push(`# ${recipe.title}`);
  if (recipe.subtitle?.trim()) {
    sections.push(`## ${recipe.subtitle}`);
  }
  if (recipe.description?.trim()) {
    sections.push('## Beschreibung\n\n' + recipe.description);
  }

  sections.push('## Metadaten\n\n' + metadataToMarkdown(recipe.metadata));

  if (recipe.category?.trim()) {
    sections.push(`**Kategorie:** ${recipe.category}`);
  }
  if (recipe.tags?.length) {
    sections.push(`**Tags:** ${recipe.tags.join(', ')}`);
  }

  if (recipe.ingredientGroups?.length) {
    sections.push('## Zutaten\n');
    recipe.ingredientGroups.forEach((group) => {
      sections.push(ingredientGroupToMarkdown(group));
    });
  }

  if (recipe.preparationGroups?.length) {
    sections.push('## Zubereitung\n');
    recipe.preparationGroups.forEach((group) => {
      sections.push(preparationGroupToMarkdown(group));
    });
  }

  if (recipe.sourceUrl?.trim()) {
    sections.push(`\n**Quelle:** ${recipe.sourceUrl}`);
  }

  return sections.join('\n\n');
}

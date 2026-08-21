/**
 * Domain types re-exported from the Astro app's shared declarations
 * (../src/types via the @shared alias) so the two frontends never drift.
 */
export type {
  Recipe,
  RecipeMetadata,
  NutritionData,
  Ingredient,
  IngredientGroup,
  PreparationStep,
  PreparationGroup,
  Quantity,
  TimeEntry,
  RecipeImage
} from '@shared/recipe';

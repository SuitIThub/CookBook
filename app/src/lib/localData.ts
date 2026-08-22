/**
 * Local-first reads: the app renders from its sql.js replica (fast, offline),
 * while a background sync keeps it in step with the server. These wrap the
 * shared CookbookDatabase so pages don't touch the DB directly.
 */
import { getLocalDb } from './localDb';
import type { Recipe, NutritionData } from '@shared/recipe';
import type { Product, Supermarket, CatalogueIngredient } from '@shared/tracker';

export async function localRecipes(): Promise<Recipe[]> {
  const { db } = await getLocalDb();
  return db.getAllRecipes();
}

export async function localRecipe(id: string): Promise<Recipe | null> {
  const { db } = await getLocalDb();
  return db.getRecipe(id);
}

export async function localVariants(id: string): Promise<Recipe[]> {
  const { db } = await getLocalDb();
  return db.getVariantsForRecipe(id);
}

export async function setLocalRecipePrivate(id: string, isPrivate: boolean): Promise<void> {
  const { db, persist } = await getLocalDb();
  db.setRecipePrivate(id, isPrivate);
  await persist();
}

/** Create (id null) or update a recipe locally via the real shared-core methods. */
export async function saveLocalRecipe(id: string | null, data: any): Promise<Recipe> {
  const { db, persist } = await getLocalDb();
  const saved = id ? db.updateRecipe(id, data) : db.createRecipe(data);
  await persist();
  return saved as Recipe;
}

export async function deleteLocalRecipe(id: string): Promise<void> {
  const { db, persist } = await getLocalDb();
  db.deleteRecipe(id);
  await persist();
}

/** Create a variant of a recipe (copy of its content, linked to the root original). */
export async function createLocalVariant(recipe: Recipe, variantName: string): Promise<Recipe> {
  const rootId = recipe.parentRecipeId ?? recipe.id;
  return saveLocalRecipe(null, {
    title: recipe.title,
    subtitle: recipe.subtitle,
    description: recipe.description,
    category: recipe.category,
    tags: recipe.tags,
    ingredientGroups: recipe.ingredientGroups,
    preparationGroups: recipe.preparationGroups,
    metadata: recipe.metadata,
    imageUrl: recipe.imageUrl,
    images: recipe.images,
    sourceUrl: recipe.sourceUrl,
    parentRecipeId: rootId,
    variantName: variantName.trim()
  });
}

export async function localProducts(): Promise<Product[]> {
  const { db } = await getLocalDb();
  return db.getAllProducts();
}

export async function localSupermarkets(): Promise<Supermarket[]> {
  const { db } = await getLocalDb();
  return db.getAllSupermarkets();
}

/** Full catalogue (all known ingredients incl. nutrition) — used for editing / live nutrition. */
export async function localIngredients(): Promise<CatalogueIngredient[]> {
  const { db } = await getLocalDb();
  return db.getAllCatalogueIngredients();
}

/** Ingredients actually used across recipes, with usage counts — matches the website /zutaten list. */
export async function localRecipeIngredients(): Promise<{ name: string; usageCount: number }[]> {
  const { db } = await getLocalDb();
  return db.getAllIngredientsFromRecipes();
}

export interface ProductInput {
  id?: string;
  name: string;
  brand?: string;
  ean?: string;
  netGrams?: number;
  packageLabel?: string;
  defaultPrice?: number;
  nutritionPer100g?: NutritionData | null;
  source?: 'manual' | 'openfoodfacts';
}

// User-initiated local writes go through the REAL shared-core methods (same
// logic as the website), fire the sync triggers, and are pushed by background
// sync when a token is configured.
export async function saveLocalProduct(input: ProductInput): Promise<Product> {
  const { db, persist } = await getLocalDb();
  const p = db.upsertProduct(input);
  await persist();
  return p;
}

export async function deleteLocalProduct(id: string): Promise<void> {
  const { db, persist } = await getLocalDb();
  db.deleteProduct(id);
  await persist();
}

export async function saveLocalSupermarket(input: { id?: string; name: string }): Promise<Supermarket> {
  const { db, persist } = await getLocalDb();
  const s = db.upsertSupermarket(input);
  await persist();
  return s;
}

export async function deleteLocalSupermarket(id: string): Promise<void> {
  const { db, persist } = await getLocalDb();
  db.deleteSupermarket(id);
  await persist();
}

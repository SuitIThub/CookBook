/**
 * Local-first reads: the app renders from its sql.js replica (fast, offline),
 * while a background sync keeps it in step with the server. These wrap the
 * shared CookbookDatabase so pages don't touch the DB directly.
 */
import { getLocalDb } from './localDb';
import type { Recipe, NutritionData, ShoppingList, ShoppingListItem } from '@shared/recipe';
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

// ---- Shopping lists (local-first; the shared core holds the CRUD + logic) ----

export async function localShoppingLists(): Promise<ShoppingList[]> {
  const { db } = await getLocalDb();
  return db.getAllShoppingLists();
}

export async function localShoppingList(id: string): Promise<ShoppingList | null> {
  const { db } = await getLocalDb();
  return db.getShoppingList(id);
}

export async function createLocalShoppingList(title: string, description?: string): Promise<ShoppingList> {
  const { db, persist } = await getLocalDb();
  const list = db.createShoppingList(title, description);
  await persist();
  return list;
}

export async function updateLocalShoppingList(id: string, updates: Partial<ShoppingList>): Promise<ShoppingList | null> {
  const { db, persist } = await getLocalDb();
  const list = db.updateShoppingList(id, updates);
  await persist();
  return list;
}

export async function deleteLocalShoppingList(id: string): Promise<boolean> {
  const { db, persist } = await getLocalDb();
  const ok = db.deleteShoppingList(id);
  await persist();
  return ok;
}

export async function addRecipeToLocalShoppingList(listId: string, recipeId: string): Promise<ShoppingList | null> {
  const { db, persist } = await getLocalDb();
  const list = db.addRecipeToShoppingList(listId, recipeId);
  await persist();
  return list;
}

export async function removeRecipeFromLocalShoppingList(listId: string, recipeId: string): Promise<ShoppingList | null> {
  const { db, persist } = await getLocalDb();
  const list = db.removeRecipeFromShoppingList(listId, recipeId);
  await persist();
  return list;
}

export async function setLocalRecipeServings(listId: string, recipeId: string, servings: number): Promise<ShoppingList | null> {
  const { db, persist } = await getLocalDb();
  const list = db.updateRecipeServingsInShoppingList(listId, recipeId, servings);
  await persist();
  return list;
}

export async function addItemToLocalShoppingList(listId: string, item: Omit<ShoppingListItem, 'id'>): Promise<ShoppingList | null> {
  const { db, persist } = await getLocalDb();
  const list = db.addItemToShoppingList(listId, item);
  await persist();
  return list;
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
  gramsByUnit?: Record<string, number> | null;
  imageUrl?: string | null;
  offCode?: string | null;
  supermarkets?: { supermarketId: string; price: number }[];
  ingredientIds?: string[];
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

/** Ensure a catalogue ingredient exists by name (create if missing) and return it. */
export async function ensureLocalCatalogueIngredient(name: string): Promise<CatalogueIngredient> {
  const { db, persist } = await getLocalDb();
  const ing = db.upsertCatalogueIngredient({ name: name.trim() });
  await persist();
  return ing;
}

/** Full catalogue upsert (nutrition, density, grams-per-unit) used by the Nährwerte editor. */
export async function saveLocalCatalogueIngredient(input: {
  name: string;
  nutritionPer100g?: NutritionData | null;
  densityGPerMl?: number | null;
  gramsByUnit?: Record<string, number> | null;
}): Promise<CatalogueIngredient> {
  const { db, persist } = await getLocalDb();
  const ing = db.upsertCatalogueIngredient(input);
  await persist();
  return ing;
}

export async function localCatalogueIngredient(name: string): Promise<CatalogueIngredient | null> {
  const { db } = await getLocalDb();
  return db.getCatalogueIngredientByName(name);
}

/** Recipes that use an ingredient (by name) — for the "Rezepte" list. */
export async function localRecipesByIngredient(name: string): Promise<Array<{ id: string; title: string }>> {
  const { db } = await getLocalDb();
  return db.getRecipesByIngredient(name);
}

/** Rename or merge an ingredient across all recipes + shopping lists (last-write-wins sync). */
export async function unifyLocalIngredients(oldName: string, newName: string): Promise<{ updated: number; shoppingListsUpdated: number }> {
  const { db, persist } = await getLocalDb();
  const res = db.unifyIngredients(oldName, newName);
  await persist();
  return res;
}

/** Link/unlink a local product to a catalogue ingredient by toggling the product's ingredientIds. */
export async function setProductIngredientLink(productId: string, ingredientId: string, linked: boolean): Promise<void> {
  const { db, persist } = await getLocalDb();
  const p = db.getProduct(productId);
  if (!p) return;
  const ids = new Set(p.ingredientIds ?? []);
  if (linked) ids.add(ingredientId);
  else ids.delete(ingredientId);
  db.setProductIngredients(productId, Array.from(ids));
  await persist();
}

// ---- Shopping lists: Sammelliste / Vorlage / alternatives (shared core, offline) ----

export async function localPermanentShoppingList(): Promise<ShoppingList | null> {
  const { db } = await getLocalDb();
  return db.getPermanentShoppingList();
}

export async function localGlobalTemplateShoppingList(): Promise<ShoppingList | null> {
  const { db } = await getLocalDb();
  return db.getGlobalTemplateShoppingList();
}

/** Move Sammelliste content into `targetListId` (see CookbookDatabase.transferFromPermanentList). */
export async function transferFromLocalPermanentList(targetListId: string, addPortionsForRecipeIds: string[] = []) {
  const { db, persist } = await getLocalDb();
  const res = db.transferFromPermanentList(targetListId, addPortionsForRecipeIds);
  await persist();
  return res;
}

/** Copy the global Vorlage into `targetListId`. */
export async function applyLocalGlobalTemplate(targetListId: string) {
  const { db, persist } = await getLocalDb();
  const res = db.applyGlobalTemplateToList(targetListId);
  await persist();
  return res;
}

export async function previewLocalAlternativeChange(listId: string, recipeId: string, groupId: string, optionId: string) {
  const { db } = await getLocalDb();
  return db.previewRecipeAlternativeChange(listId, recipeId, groupId, optionId);
}

export async function switchLocalAlternative(listId: string, recipeId: string, groupId: string, optionId: string) {
  const { db, persist } = await getLocalDb();
  const list = db.updateRecipeAlternativeInShoppingList(listId, recipeId, groupId, optionId);
  await persist();
  return list;
}

/** Add several recipes (uses the catalogue defaults the user chose, like the website). */
export async function addRecipesToLocalShoppingList(listId: string, recipeIds: string[]): Promise<string[]> {
  const { db, persist } = await getLocalDb();
  let defaults: Record<string, string> | undefined;
  try {
    defaults = JSON.parse(localStorage.getItem('cookbook.ingredient.defaults') || '{}');
  } catch {
    defaults = undefined;
  }
  const failed: string[] = [];
  for (const id of recipeIds) if (!db.addRecipeToShoppingList(listId, id, defaults)) failed.push(id);
  await persist();
  return failed;
}

/**
 * Local-first reads: the app renders from its sql.js replica (fast, offline),
 * while a background sync keeps it in step with the server. These wrap the
 * shared CookbookDatabase so pages don't touch the DB directly.
 */
import { getLocalDb } from './localDb';
import type { Recipe } from '@shared/recipe';

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

import type { Recipe } from '../types/recipe';

export interface DraftRecipe extends Recipe {
  lastUpdated: string; // ISO string
}

const DRAFT_STORAGE_PREFIX = 'recipe_draft_';

/**
 * Get the storage key for a recipe draft
 */
function getDraftKey(recipeId: string): string {
  return `${DRAFT_STORAGE_PREFIX}${recipeId}`;
}

/**
 * Save a draft recipe to localStorage
 */
export function saveDraft(recipeId: string, recipe: Recipe): void {
  try {
    const draft: DraftRecipe = {
      ...recipe,
      lastUpdated: new Date().toISOString()
    };
    const key = getDraftKey(recipeId);
    localStorage.setItem(key, JSON.stringify(draft));
  } catch (error) {
    console.error('Error saving draft:', error);
    // If storage is full, try to clear old drafts
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      clearOldDrafts();
      try {
        const draft: DraftRecipe = {
          ...recipe,
          lastUpdated: new Date().toISOString()
        };
        const key = getDraftKey(recipeId);
        localStorage.setItem(key, JSON.stringify(draft));
      } catch (retryError) {
        console.error('Error saving draft after cleanup:', retryError);
      }
    }
  }
}

/**
 * Load a draft recipe from localStorage
 */
export function loadDraft(recipeId: string): DraftRecipe | null {
  try {
    const key = getDraftKey(recipeId);
    const draftJson = localStorage.getItem(key);
    if (!draftJson) {
      return null;
    }
    const draft = JSON.parse(draftJson) as DraftRecipe;
    return draft;
  } catch (error) {
    console.error('Error loading draft:', error);
    return null;
  }
}

/**
 * Delete a draft recipe from localStorage
 */
export function deleteDraft(recipeId: string): void {
  try {
    const key = getDraftKey(recipeId);
    localStorage.removeItem(key);
  } catch (error) {
    console.error('Error deleting draft:', error);
  }
}

/**
 * Check if a draft exists for a recipe
 */
export function hasDraft(recipeId: string): boolean {
  try {
    const key = getDraftKey(recipeId);
    return localStorage.getItem(key) !== null;
  } catch (error) {
    console.error('Error checking draft:', error);
    return false;
  }
}

/**
 * Get all draft recipe IDs
 */
export function getAllDraftIds(): string[] {
  try {
    const draftIds: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(DRAFT_STORAGE_PREFIX)) {
        const recipeId = key.substring(DRAFT_STORAGE_PREFIX.length);
        draftIds.push(recipeId);
      }
    }
    return draftIds;
  } catch (error) {
    console.error('Error getting draft IDs:', error);
    return [];
  }
}

/**
 * Clear old drafts (older than 30 days) to free up storage
 */
function clearOldDrafts(): void {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const keysToDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(DRAFT_STORAGE_PREFIX)) {
        try {
          const draftJson = localStorage.getItem(key);
          if (draftJson) {
            const draft = JSON.parse(draftJson) as DraftRecipe;
            const lastUpdated = new Date(draft.lastUpdated);
            if (lastUpdated < thirtyDaysAgo) {
              keysToDelete.push(key);
            }
          }
        } catch (error) {
          // If we can't parse it, delete it
          keysToDelete.push(key);
        }
      }
    }
    
    keysToDelete.forEach(key => localStorage.removeItem(key));
    if (keysToDelete.length > 0) {
      console.log(`Cleared ${keysToDelete.length} old drafts`);
    }
  } catch (error) {
    console.error('Error clearing old drafts:', error);
  }
}


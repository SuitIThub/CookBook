/**
 * Recipe image upload/delete. Images are binary files stored on the server
 * (under /uploads) and referenced from the recipe, so these are online-only and
 * token-gated — same shape as recipe import. After a change the caller re-syncs
 * so the local replica picks up the recipe's updated images[].
 */
import type { RecipeImage } from '@/types';
import { apiUpload, apiDelete } from './api';

export async function uploadRecipeImage(recipeId: string, file: File): Promise<RecipeImage> {
  const form = new FormData();
  form.append('image', file);
  form.append('recipeId', recipeId);
  return apiUpload<RecipeImage>('/api/recipes/images', form);
}

export async function deleteRecipeImage(recipeId: string, imageId: string): Promise<void> {
  await apiDelete(
    `/api/recipes/images?recipeId=${encodeURIComponent(recipeId)}&imageId=${encodeURIComponent(imageId)}`
  );
}

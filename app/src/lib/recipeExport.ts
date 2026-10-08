/**
 * Recipe export, generated locally so it works fully offline. Markdown reuses
 * the shared core (`recipeToMarkdown`) so the format matches the website; JSON
 * is the raw recipe. Files are saved via lib/fileSave (download in the browser,
 * share sheet on device). Bulk exports mirror /api/recipes/export.
 */
import type { Recipe } from '@/types';
import { recipeToMarkdown } from '@core/recipeMarkdown';
import { saveTextFile } from './fileSave';
import { apiGet } from './api';

export function recipeMarkdown(recipe: Recipe): string {
  return recipeToMarkdown(recipe);
}

export function recipeJson(recipe: Recipe): string {
  return JSON.stringify(recipe, null, 2);
}

function slug(title: string): string {
  const s = (title || '')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return s || 'rezept';
}

export function downloadText(filename: string, text: string, mime: string): void {
  void saveTextFile(filename, text, mime).catch((e) => console.error('Export failed', e));
}

export function exportRecipeMarkdown(recipe: Recipe): void {
  downloadText(`${slug(recipe.title)}.md`, recipeMarkdown(recipe), 'text/markdown;charset=utf-8');
}

export function exportRecipeJson(recipe: Recipe): void {
  downloadText(`${slug(recipe.title)}.json`, recipeJson(recipe), 'application/json;charset=utf-8');
}

/** Copy the Markdown to the clipboard; returns false if the clipboard API is unavailable. */
export async function copyRecipeMarkdown(recipe: Recipe): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(recipeMarkdown(recipe));
    return true;
  } catch {
    return false;
  }
}

/** JSON export like /api/recipes/export?format=json (all = no images, selection = external images only). */
export function exportRecipesJson(recipes: Recipe[], selection: boolean): void {
  const data = recipes.map((r) => {
    if (!selection) {
      const { images: _i, imageUrl: _u, ...clean } = r as any;
      return clean;
    }
    return {
      ...r,
      images: (r.images ?? [])
        .filter((img) => img.url && !img.url.startsWith('/uploads/'))
        .map((img) => ({ id: img.id, filename: img.filename, url: img.url, uploadedAt: img.uploadedAt }))
    };
  });
  downloadText(selection ? 'selected_recipes.json' : 'recipes.json', JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
}

/** Full export with embedded images (.rcb) — built by the server, so online only. */
export async function exportRecipesRcb(ids?: string[]): Promise<void> {
  const q = ids && ids.length ? `&ids=${ids.join(',')}` : '';
  const data = await apiGet<unknown>(`/api/recipes/export?format=rcb${q}`, { timeoutMs: 180000 });
  const list = Array.isArray(data) ? data : [];
  const filename = list.length === 1 ? `${String((list[0] as any).title || 'rezept').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.rcb` : 'recipes.rcb';
  await saveTextFile(filename, JSON.stringify(data, null, 2), 'application/json');
}

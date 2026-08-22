/**
 * Recipe export, generated locally so it works fully offline. Markdown reuses
 * the shared core (`recipeToMarkdown`) so the format matches the website; JSON
 * is the raw recipe. Downloads go through a Blob + anchor, which works in the
 * Capacitor webview as well as the browser.
 */
import type { Recipe } from '@/types';
import { recipeToMarkdown } from '@core/recipeMarkdown';

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
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

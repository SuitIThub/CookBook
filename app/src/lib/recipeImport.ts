/**
 * Recipe import. The extraction (URL fetch/parse, text JSON) runs server-side,
 * so these POST to the server import endpoints (token-gated). The created recipe
 * is then pulled into the local replica by a sync. Online-only by nature.
 */
import { apiPost } from './api';

interface ImportResponse {
  recipeId?: string;
  recipes?: { id: string }[];
}

export async function importFromUrl(url: string): Promise<string> {
  const r = await apiPost<ImportResponse>('/api/recipes/import/url', { url });
  const id = r.recipeId ?? r.recipes?.[0]?.id;
  if (!id) throw new Error('Import lieferte kein Rezept.');
  return id;
}

export async function importFromText(text: string): Promise<string> {
  const r = await apiPost<ImportResponse>('/api/recipes/import/text', { text });
  const id = r.recipeId ?? r.recipes?.[0]?.id;
  if (!id) throw new Error('Import lieferte kein Rezept.');
  return id;
}

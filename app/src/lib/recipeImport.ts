/**
 * Recipe import. The extraction (URL fetch/parse, text JSON) runs server-side,
 * so these POST to the server import endpoints (token-gated). The created recipe
 * is then pulled into the local replica by a sync. Online-only by nature.
 */
import { ApiError, apiGet, apiPost } from './api';
import { getAiSettings } from './settings';

interface ImportResponse {
  recipeId?: string;
  recipes?: { id: string }[];
}

/**
 * URL import. Pages without recipe data (server answers 422 NO_RECIPE_DATA)
 * are read by the AI instead — same job flow as reels, with progress.
 * With `review` the normal import is checked/completed by the AI against the page.
 */
export async function importFromUrl(
  url: string,
  onProgress: (message: string) => void,
  review = false
): Promise<{ recipeId: string; warnings: string[] }> {
  if (review) return importViaAi('web', url, onProgress, true);
  let r: ImportResponse;
  try {
    r = await apiPost<ImportResponse>('/api/recipes/import/url', { url });
  } catch (e) {
    if (e instanceof ApiError && e.status === 422) {
      onProgress('Keine Rezept-Daten gefunden — die KI liest die Seite …');
      return importViaAi('web', url, onProgress);
    }
    throw e;
  }
  const id = r.recipeId ?? r.recipes?.[0]?.id;
  if (!id) throw new Error('Import lieferte kein Rezept.');
  return { recipeId: id, warnings: [] };
}

export async function importFromText(text: string): Promise<string> {
  const r = await apiPost<ImportResponse>('/api/recipes/import/text', { text });
  const id = r.recipeId ?? r.recipes?.[0]?.id;
  if (!id) throw new Error('Import lieferte kein Rezept.');
  return id;
}

/** Instagram reel links are imported via AI (caption, speech, frames) instead of page parsing. */
export function isReelUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return /(^|\.)instagram\.com$/i.test(u.hostname) && /^\/(reels?|p|tv)\//i.test(u.pathname);
  } catch {
    return false;
  }
}

interface ImportJob {
  jobId?: string;
  stage: string;
  message: string;
  recipeId?: string;
  warnings?: string[];
  error?: string;
}

/** Reel import: caption, speech and frames analysed by AI. */
export function importFromReel(url: string, onProgress: (message: string) => void): Promise<{ recipeId: string; warnings: string[] }> {
  return importViaAi('reel', url, onProgress);
}

/**
 * AI import (website: same endpoints). The server works on it for 10 s – 2 min
 * as a background job; this polls its progress. Returns the recipe id + warnings.
 */
async function importViaAi(
  kind: 'reel' | 'web',
  url: string,
  onProgress: (message: string) => void,
  review = false
): Promise<{ recipeId: string; warnings: string[] }> {
  const started = await apiPost<ImportJob>(`/api/recipes/import/${kind}`, { url: url.trim(), ai: getAiSettings(), review });
  onProgress(started.message);
  let job = started;
  while (job.stage !== 'done' && job.stage !== 'error') {
    await new Promise((r) => setTimeout(r, 2000));
    job = await apiGet<ImportJob>(`/api/recipes/import/${kind}?job=${encodeURIComponent(started.jobId!)}`);
    onProgress(job.message);
  }
  if (job.stage === 'error' || !job.recipeId) throw new Error(job.error || (kind === 'reel' ? 'Reel-Import fehlgeschlagen.' : 'KI-Import fehlgeschlagen.'));
  return { recipeId: job.recipeId, warnings: job.warnings ?? [] };
}

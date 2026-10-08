/**
 * Recipe import. The extraction (URL fetch/parse, text JSON) runs server-side,
 * so these POST to the server import endpoints (token-gated). The created recipe
 * is then pulled into the local replica by a sync. Online-only by nature.
 */
import { apiGet, apiPost } from './api';
import { getAiSettings } from './settings';

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

/** Instagram reel links are imported via AI (caption, speech, frames) instead of page parsing. */
export function isReelUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return /(^|\.)instagram\.com$/i.test(u.hostname) && /^\/(reels?|p|tv)\//i.test(u.pathname);
  } catch {
    return false;
  }
}

interface ReelJob {
  jobId?: string;
  stage: string;
  message: string;
  recipeId?: string;
  warnings?: string[];
  error?: string;
}

/**
 * Reel import (website: same endpoint). The server works on it for 30 s – 2 min
 * as a background job; this polls its progress. Returns the recipe id + warnings.
 */
export async function importFromReel(url: string, onProgress: (message: string) => void): Promise<{ recipeId: string; warnings: string[] }> {
  const started = await apiPost<ReelJob>('/api/recipes/import/reel', { url: url.trim(), ai: getAiSettings() });
  onProgress(started.message);
  let job = started;
  while (job.stage !== 'done' && job.stage !== 'error') {
    await new Promise((r) => setTimeout(r, 2000));
    job = await apiGet<ReelJob>(`/api/recipes/import/reel?job=${encodeURIComponent(started.jobId!)}`);
    onProgress(job.message);
  }
  if (job.stage === 'error' || !job.recipeId) throw new Error(job.error || 'Reel-Import fehlgeschlagen.');
  return { recipeId: job.recipeId, warnings: job.warnings ?? [] };
}

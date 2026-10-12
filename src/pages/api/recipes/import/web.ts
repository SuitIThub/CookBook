import type { APIRoute } from 'astro';
import { getImportJob } from '../../../../lib/importJobs.server';
import { startWebImport } from '../../../../lib/webImport.server';
import { taskRequestConfig, type AiSettingsLike } from '../../../../lib/aiTasks';

/**
 * AI import of web pages without recipe data (see lib/webImport.server.ts).
 * The URL import answers 422 { code: 'NO_RECIPE_DATA' } for such pages; the
 * client then starts this job. With `review: true` (checkbox "Mit KI prüfen")
 * the page is imported normally first and the AI checks/completes the result.
 *   POST { url, ai: <the client's AI settings incl. tasks>, review?: boolean } → { jobId }
 *   GET  ?job=<id> → { stage, message, recipeId?, warnings?, error? }
 * POST is a write (alias token required by the middleware).
 */
export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!isHttpUrl(url)) return json({ error: 'Bitte einen gültigen Link (http/https) angeben.' }, 400);
  const settings = (body?.ai ?? {}) as AiSettingsLike;
  const job = startWebImport(url, { ai: taskRequestConfig(settings, 'structure'), review: body?.review === true });
  return json({ jobId: job.id, stage: job.stage, message: job.message });
};

export const GET: APIRoute = async ({ url }) => {
  const id = new URL(url).searchParams.get('job') || '';
  const job = getImportJob(id);
  if (!job) return json({ error: 'Import-Auftrag nicht gefunden (abgelaufen?)' }, 404);
  return json(job);
};

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

import type { APIRoute } from 'astro';
import { getReelJob, isReelUrl, startReelImport } from '../../../../lib/reelImport.server';
import { resolveTasks, taskRequestConfig, type AiSettingsLike } from '../../../../lib/aiTasks';

/**
 * Instagram reel import (see lib/reelImport.server.ts).
 *   POST { url, ai: <the client's AI settings incl. tasks> } → { jobId }
 *   GET  ?job=<id> → { stage, message, recipeId?, warnings?, error? }
 * POST is a write (alias token required by the middleware).
 */
export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!isReelUrl(url)) return json({ error: 'Bitte einen Instagram-Reel-Link angeben.' }, 400);
  // The client sends its AI settings; the task models decide which model
  // structures the recipe and which one reads the frames.
  const settings = (body?.ai ?? {}) as AiSettingsLike;
  const vision = resolveTasks(settings).vision;
  const job = startReelImport(url, {
    ai: taskRequestConfig(settings, 'structure'),
    vision: vision.mode,
    visionModel: vision.model || undefined
  });
  return json({ jobId: job.id, stage: job.stage, message: job.message });
};

export const GET: APIRoute = async ({ url }) => {
  const id = new URL(url).searchParams.get('job') || '';
  const job = getReelJob(id);
  if (!job) return json({ error: 'Import-Auftrag nicht gefunden (abgelaufen?)' }, 404);
  return json(job);
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

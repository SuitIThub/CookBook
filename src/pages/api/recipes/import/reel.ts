import type { APIRoute } from 'astro';
import { getReelJob, isReelUrl, startReelImport } from '../../../../lib/reelImport.server';
import type { AIRequestConfig, ReelVisionMode } from '../../../../lib/ai';

/**
 * Instagram reel import (see lib/reelImport.server.ts).
 *   POST { url, ai: { provider, model, openRouterApiKey?, reelVision?, reelVisionModel? } } → { jobId }
 *   GET  ?job=<id> → { stage, message, recipeId?, warnings?, error? }
 * POST is a write (alias token required by the middleware).
 */
const VISION_MODES: ReelVisionMode[] = ['none', 'ocr', 'openrouter', 'ollama'];

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!isReelUrl(url)) return json({ error: 'Bitte einen Instagram-Reel-Link angeben.' }, 400);
  const ai = (body?.ai ?? {}) as Record<string, unknown>;
  const config: AIRequestConfig = {
    provider: ai.provider === 'openrouter' ? 'openrouter' : 'ollama',
    model: typeof ai.model === 'string' ? ai.model : undefined,
    openRouterApiKey: typeof ai.openRouterApiKey === 'string' ? ai.openRouterApiKey : undefined
  };
  const vision = VISION_MODES.includes(ai.reelVision as ReelVisionMode) ? (ai.reelVision as ReelVisionMode) : 'ocr';
  const job = startReelImport(url, {
    ai: config,
    vision,
    visionModel: typeof ai.reelVisionModel === 'string' ? ai.reelVisionModel : undefined
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

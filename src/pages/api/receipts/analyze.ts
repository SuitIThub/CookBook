import type { APIRoute } from 'astro';
import { getReceiptJob, startReceiptImport } from '../../../lib/receiptImport.server';
import { resolveTasks, taskRequestConfig, type AiSettingsLike } from '../../../lib/aiTasks';

/**
 * Receipt / invoice import (lib/receiptImport.server.ts).
 *   POST multipart: file (1..n images or PDFs), supermarketId?, ai (JSON of the AI settings) → { jobId }
 *   GET  ?job=<id> → { stage, message, result?, error? }
 * Files live only in memory/temp until the job is done.
 */
const MAX_BYTES = 25 * 1024 * 1024;
const OK_TYPES = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

export const POST: APIRoute = async ({ request }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Formular konnte nicht gelesen werden.' }, 400);
  }
  const files: { name: string; mime: string; data: Buffer }[] = [];
  let bytes = 0;
  for (const entry of form.getAll('file')) {
    if (typeof entry === 'string') continue;
    const mime = entry.type || (entry.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
    if (!OK_TYPES.test(mime)) return json({ error: `Dateityp nicht unterstützt: ${entry.name} (Bilder oder PDF)` }, 400);
    const data = Buffer.from(await entry.arrayBuffer());
    bytes += data.length;
    files.push({ name: entry.name || 'beleg', mime, data });
  }
  if (!files.length) return json({ error: 'Bitte ein Foto oder PDF des Belegs hochladen.' }, 400);
  if (bytes > MAX_BYTES) return json({ error: 'Dateien sind zu groß (max. 25 MB).' }, 400);

  let settings: AiSettingsLike = {};
  try {
    settings = JSON.parse(String(form.get('ai') || '{}'));
  } catch {
    /* defaults */
  }
  const vision = resolveTasks(settings).vision;
  const textAi = taskRequestConfig(settings, 'matching');
  const job = startReceiptImport(files, {
    vision,
    textAi,
    openRouterApiKey: settings.openRouterApiKey,
    supermarketId: String(form.get('supermarketId') || '') || null
  });
  return json({ jobId: job.id, stage: job.stage, message: job.message });
};

export const GET: APIRoute = async ({ url }) => {
  const job = getReceiptJob(new URL(url).searchParams.get('job') || '');
  if (!job) return json({ error: 'Auftrag nicht gefunden (abgelaufen?)' }, 404);
  return json(job);
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

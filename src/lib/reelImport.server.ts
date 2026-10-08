/**
 * Recipe import from Instagram reels (server-only).
 *
 * Pipeline per reel, run as a background job with progress (a reel takes
 * 30 s – 2 min; HTTPS tunnels cut long requests, so clients poll):
 *   1. yt-dlp: caption (description) + video, no Instagram API / account
 *      (optional cookies file for when Instagram rate-limits anonymous access)
 *   2. ffmpeg: mono 16 kHz audio + up to N key frames (scene changes)
 *   3. faster-whisper (scripts/transcribe.py): speech → text, locally
 *   4. frames per setting: none | ocr (tesseract, local) | openrouter | ollama (vision model)
 *   5. LLM (the user's chat provider/model): all material → recipe JSON
 *   6. recipe created like the URL import (sourceUrl, thumbnail as image), user reviews in the editor
 *
 * Server setup (Linux): apt install ffmpeg tesseract-ocr tesseract-ocr-deu;
 * python3 -m venv ~/reel-venv && ~/reel-venv/bin/pip install yt-dlp faster-whisper.
 * Env: REEL_PYTHON (venv python with yt-dlp + faster-whisper), YTDLP_BIN (optional standalone yt-dlp), FFMPEG_BIN,
 * TESSERACT_BIN, WHISPER_MODEL (default "small"), INSTAGRAM_COOKIES (Netscape cookies.txt).
 */
import { bin, run } from './proc.server';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { db } from './database.server';
import { describeReelFrames, defaultReelVisionModel, recipeFromReelSources, type AIRequestConfig, type ReelVisionMode } from './ai';
import { sanitizeRecipeData } from './aiRecipeSanitize';
import { catalogueCandidates, enrichRecipeData } from './recipeEnrich';
import type { RecipeImage } from '../types/recipe';

const MAX_FRAMES = 12;

export function isReelUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)instagram\.com$/i.test(u.hostname) && /^\/(reels?|p|tv)\//i.test(u.pathname);
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------- jobs */

export type ReelStage = 'download' | 'audio' | 'transcribe' | 'frames' | 'vision' | 'recipe' | 'done' | 'error';
export interface ReelJob {
  id: string;
  stage: ReelStage;
  message: string;
  recipeId?: string;
  warnings?: string[];
  error?: string;
  createdAt: number;
}
const jobs = new Map<string, ReelJob>();

function pruneJobs() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs) if (job.createdAt < cutoff) jobs.delete(id);
}

export function getReelJob(id: string): ReelJob | undefined {
  return jobs.get(id);
}

export interface ReelImportOptions {
  ai: AIRequestConfig;
  vision: ReelVisionMode;
  visionModel?: string;
}

/** Start a reel import in the background; poll with getReelJob(). */
export function startReelImport(url: string, options: ReelImportOptions): ReelJob {
  pruneJobs();
  const job: ReelJob = { id: randomUUID(), stage: 'download', message: 'Reel wird geladen …', createdAt: Date.now() };
  jobs.set(job.id, job);
  const set = (stage: ReelStage, message: string) => Object.assign(job, { stage, message });
  void runReelImport(url, options, set)
    .then((r) => Object.assign(job, { stage: 'done', message: 'Fertig', recipeId: r.recipeId, warnings: r.warnings }))
    .catch((e) => {
      console.error('Reel import failed:', e);
      Object.assign(job, { stage: 'error', message: 'Fehlgeschlagen', error: (e as Error).message || String(e) });
    });
  return job;
}

/* ----------------------------------------------------------- pipeline */



async function runReelImport(
  url: string,
  options: ReelImportOptions,
  set: (stage: ReelStage, message: string) => void
): Promise<{ recipeId: string; warnings: string[] }> {
  const work = await mkdtemp(join(tmpdir(), 'cookbook-reel-'));
  const warnings: string[] = ['Aus einem Reel per KI erstellt — bitte Zutaten, Mengen und Schritte prüfen.'];
  try {
    // 1. caption + video
    // yt-dlp from the same Python venv as faster-whisper (python -m yt_dlp),
    // unless YTDLP_BIN points to a standalone binary.
    const python = bin(process.env.REEL_PYTHON, 'python3');
    const ytdlp = process.env.YTDLP_BIN?.trim() ? [process.env.YTDLP_BIN.trim()] : [python, '-m', 'yt_dlp'];
    const cookies = process.env.INSTAGRAM_COOKIES;
    await run(
      ytdlp[0],
      [
        ...ytdlp.slice(1),
        '--no-playlist',
        '--no-progress',
        '-f', 'best[height<=720]/best',
        '-o', 'video.%(ext)s',
        '--write-info-json',
        '--write-thumbnail',
        '--convert-thumbnails', 'jpg',
        ...(cookies ? ['--cookies', cookies] : []),
        url
      ],
      { cwd: work }
    ).catch((e: Error) => {
      throw new Error(
        /login|rate|429|401|cookies/i.test(e.message)
          ? 'Instagram hat den Abruf verweigert (Anmeldung nötig oder zu viele Anfragen). Auf dem Server INSTAGRAM_COOKIES setzen oder später erneut versuchen.'
          : `Reel konnte nicht geladen werden: ${e.message}`
      );
    });
    const files = await readdir(work);
    const video = files.find((f) => f.startsWith('video.') && !f.endsWith('.json') && !f.endsWith('.jpg'));
    const infoFile = files.find((f) => f.endsWith('.info.json'));
    const info = infoFile ? JSON.parse(await readFile(join(work, infoFile), 'utf8')) : {};
    const caption: string = String(info.description || '').trim();
    const uploader: string = String(info.uploader || info.channel || '').trim();
    if (!video) throw new Error('Im Reel wurde kein Video gefunden.');

    const ffmpeg = bin(process.env.FFMPEG_BIN, 'ffmpeg');

    // 2+3. speech → text
    set('audio', 'Ton wird extrahiert …');
    let transcript = '';
    try {
      await run(ffmpeg, ['-y', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', 'audio.wav'], { cwd: work });
      set('transcribe', 'Gesprochener Text wird erkannt …');
      const script = join(process.cwd(), 'scripts', 'transcribe.py');
      const { stdout } = await run(python, [script, join(work, 'audio.wav'), bin(process.env.WHISPER_MODEL, 'small')]);
      transcript = stdout.trim();
    } catch (e) {
      // Reels without speech / no audio track are common — not fatal.
      if (!/does not contain any stream|Output file .* does not contain/i.test((e as Error).message)) {
        warnings.push(`Ton konnte nicht ausgewertet werden: ${(e as Error).message}`);
      }
    }

    // 4. key frames → on-screen text / description
    let frameText = '';
    if (options.vision !== 'none') {
      set('frames', 'Standbilder werden ausgewählt …');
      const frames = await extractFrames(ffmpeg, work, video, Number(info.duration) || 0);
      if (frames.length) {
        if (options.vision === 'ocr') {
          set('vision', 'Eingeblendeter Text wird gelesen (OCR) …');
          frameText = await ocrFrames(work, frames).catch((e) => {
            warnings.push(`Texterkennung fehlgeschlagen: ${(e as Error).message}`);
            return '';
          });
        } else {
          set('vision', 'Standbilder werden per KI analysiert …');
          const model = options.visionModel?.trim() || defaultReelVisionModel(options.vision);
          const images = await Promise.all(frames.map(async (f) => (await readFile(join(work, f))).toString('base64')));
          frameText = await describeReelFrames(images, options.vision, model, options.ai.openRouterApiKey).catch((e) => {
            warnings.push(`Bildanalyse fehlgeschlagen: ${(e as Error).message}`);
            return '';
          });
        }
      }
    }

    if (!caption && !transcript && !frameText) {
      throw new Error('Im Reel wurden weder Beschreibung noch gesprochener oder eingeblendeter Text gefunden.');
    }

    // 5. everything → recipe JSON
    set('recipe', 'Rezept wird erstellt …');
    const sources = [
      caption && `## Beschreibung des Reels${uploader ? ` (von ${uploader})` : ''}\n${caption}`,
      transcript && `## Gesprochener Text (automatisch transkribiert)\n${transcript}`,
      frameText && `## Eingeblendeter Text / Bildinhalt (${options.vision === 'ocr' ? 'OCR' : 'KI-Bildanalyse'})\n${frameText}`
    ]
      .filter(Boolean)
      .join('\n\n');
    // Existing catalogue ingredients that occur in the material → the model reuses their names.
    const catalogue = db.getAllCatalogueIngredients().map((c) => c.name);
    const raw = await recipeFromReelSources(sources, options.ai, catalogueCandidates(sources, catalogue));
    // Deterministic safety net: catalogue spellings + ingredient links in every step.
    const { data } = enrichRecipeData(sanitizeRecipeData(raw, String(info.title || 'Rezept aus Reel')), catalogue);

    // 6. thumbnail as recipe image, create the recipe
    const images: RecipeImage[] = [];
    const thumb = (await readdir(work)).find((f) => f.endsWith('.jpg') && !f.startsWith('frame_'));
    if (thumb) {
      const saved = await saveRecipeImage(await readFile(join(work, thumb))).catch(() => null);
      if (saved) images.push(saved);
    }
    const recipe = db.createRecipe({
      ...(data as any),
      description: [data.description, uploader ? `Quelle: Instagram-Reel von ${uploader}` : ''].filter(Boolean).join('\n\n'),
      imageUrl: images[0]?.url,
      images,
      sourceUrl: url
    });
    if (!transcript) warnings.push('Im Reel wurde kein gesprochener Text erkannt.');
    return { recipeId: recipe.id, warnings };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/** Up to MAX_FRAMES frames at scene changes; evenly spaced fallback for static videos. */
async function extractFrames(ffmpeg: string, work: string, video: string, duration: number): Promise<string[]> {
  await run(ffmpeg, ['-y', '-i', video, '-vf', "select='gt(scene,0.25)',scale=720:-2", '-vsync', 'vfr', '-q:v', '4', 'scene_%03d.jpg'], { cwd: work }).catch(() => {});
  let frames = (await readdir(work)).filter((f) => f.startsWith('scene_')).sort();
  if (frames.length < 4) {
    const fps = duration > 0 ? Math.min(1, MAX_FRAMES / duration) : 0.5;
    await run(ffmpeg, ['-y', '-i', video, '-vf', `fps=${fps.toFixed(3)},scale=720:-2`, '-q:v', '4', 'even_%03d.jpg'], { cwd: work });
    frames = [...frames, ...(await readdir(work)).filter((f) => f.startsWith('even_')).sort()];
  }
  if (frames.length <= MAX_FRAMES) return frames;
  const step = frames.length / MAX_FRAMES;
  return Array.from({ length: MAX_FRAMES }, (_, i) => frames[Math.floor(i * step)]);
}

/** On-screen text via tesseract (German + English), de-duplicated across frames. */
async function ocrFrames(work: string, frames: string[]): Promise<string> {
  const tesseract = bin(process.env.TESSERACT_BIN, 'tesseract');
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const f of frames) {
    const { stdout } = await run(tesseract, [join(work, f), 'stdout', '-l', 'deu+eng', '--psm', '11'], { timeoutMs: 60_000 });
    for (const raw of stdout.split('\n')) {
      const line = raw.replace(/\s+/g, ' ').trim();
      // Drop OCR noise: very short fragments and lines without letters.
      if (line.length < 3 || !/[a-zäöüß]{2}/i.test(line)) continue;
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
  }
  return lines.join('\n');
}

/** Store an image like a recipe image upload (public/uploads/recipes). */
async function saveRecipeImage(data: Buffer): Promise<RecipeImage> {
  const dir = join(process.cwd(), 'public', 'uploads', 'recipes');
  await mkdir(dir, { recursive: true });
  const id = randomUUID();
  const filename = `${id}.jpg`;
  await writeFile(join(dir, filename), data);
  return { id, filename, url: `/uploads/recipes/${filename}`, uploadedAt: new Date() };
}

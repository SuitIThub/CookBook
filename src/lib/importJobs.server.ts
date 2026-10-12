/**
 * Background import jobs with progress (server-only). AI imports take
 * 10 s – 2 min and HTTPS tunnels cut long requests, so clients start a job
 * and poll it. Used by the reel import and the AI web-page import.
 */
import { randomUUID } from 'node:crypto';

export interface ImportJob<Stage extends string = string> {
  id: string;
  stage: Stage | 'done' | 'error';
  message: string;
  recipeId?: string;
  warnings?: string[];
  error?: string;
  createdAt: number;
}

const jobs = new Map<string, ImportJob>();

function pruneJobs() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs) if (job.createdAt < cutoff) jobs.delete(id);
}

export function getImportJob(id: string): ImportJob | undefined {
  return jobs.get(id);
}

/** Run `work` in the background; it reports progress through `set`. */
export function startImportJob<Stage extends string>(
  stage: Stage,
  message: string,
  work: (set: (stage: Stage, message: string) => void) => Promise<{ recipeId: string; warnings: string[] }>
): ImportJob<Stage> {
  pruneJobs();
  const job: ImportJob<Stage> = { id: randomUUID(), stage, message, createdAt: Date.now() };
  jobs.set(job.id, job);
  const set = (s: Stage, m: string) => Object.assign(job, { stage: s, message: m });
  void work(set)
    .then((r) => Object.assign(job, { stage: 'done', message: 'Fertig', recipeId: r.recipeId, warnings: r.warnings }))
    .catch((e) => {
      console.error('Import job failed:', e);
      Object.assign(job, { stage: 'error', message: 'Fehlgeschlagen', error: (e as Error).message || String(e) });
    });
  return job;
}

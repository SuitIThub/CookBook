import type { APIRoute } from 'astro';
import { db } from '../../../lib/database';

function normalizeAlias(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 128);
}

export const GET: APIRoute = async ({ url }) => {
  const alias = normalizeAlias(new URL(url).searchParams.get('alias'));
  if (!alias) return json({ error: 'alias required' }, 400);
  return json({ alias, logs: db.getWeightLogs(alias) });
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const alias = normalizeAlias(body?.alias);
    if (!alias) return json({ error: 'alias required' }, 400);
    const weightKg = Number(body?.weightKg);
    if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 500) {
      return json({ error: 'weightKg must be a positive number' }, 400);
    }
    const loggedAt = body?.loggedAt ? new Date(body.loggedAt) : new Date();
    if (Number.isNaN(loggedAt.getTime())) return json({ error: 'invalid loggedAt' }, 400);
    const log = db.addWeightLog(alias, weightKg, loggedAt);
    return json(log);
  } catch (error) {
    console.error('POST /api/tracker/weight error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};

export const DELETE: APIRoute = async ({ url }) => {
  const id = new URL(url).searchParams.get('id');
  if (!id) return json({ error: 'id required' }, 400);
  return json({ deleted: db.deleteWeightLog(id) });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

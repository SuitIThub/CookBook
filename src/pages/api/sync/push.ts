import type { APIRoute } from 'astro';
import { db } from '../../../lib/database.server';
import type { Recipe } from '../../../types/recipe';

/**
 * Push endpoint (client -> server). Applies client changes with last-write-wins
 * (server keeps the newer row by updated_at). Applied writes are logged in the
 * server's change log (this endpoint never sets the echo-suppression flag), so
 * OTHER clients receive them on their next pull.
 *
 * Phase 2 / Y-sync-2: recipes only; the registry mirrors pull.ts.
 */
type PushChange = { type: string; id: string; op: 'upsert' | 'delete'; data?: any };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

const ms = (v: unknown): number => {
  const t = new Date(v as string).getTime();
  return Number.isFinite(t) ? t : 0;
};

const HANDLERS: Record<
  string,
  { applyUpsert: (data: any) => void; applyDelete: (id: string) => void; existingUpdatedAt: (id: string) => number | null }
> = {
  recipe: {
    applyUpsert: (data: Recipe) => db.upsertRecipe(data),
    applyDelete: (id: string) => db.deleteRecipeForSync(id),
    existingUpdatedAt: (id: string) => {
      const r = db.getRecipe(id);
      return r ? ms(r.updatedAt) : null;
    }
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as { changes?: PushChange[] };
    const changes = Array.isArray(body?.changes) ? body.changes : [];

    let applied = 0;
    let skipped = 0;
    let deleted = 0;

    for (const ch of changes) {
      const handler = HANDLERS[ch.type];
      if (!handler) {
        skipped++;
        continue;
      }
      if (ch.op === 'delete') {
        handler.applyDelete(ch.id);
        deleted++;
      } else if (ch.data) {
        // Last-write-wins: apply only if the incoming row is at least as new.
        const existing = handler.existingUpdatedAt(ch.id);
        if (existing === null || ms(ch.data.updatedAt) >= existing) {
          handler.applyUpsert(ch.data);
          applied++;
        } else {
          skipped++;
        }
      }
    }

    return json({ ok: true, applied, deleted, skipped, cursor: db.getMaxSyncSeq() });
  } catch (error) {
    console.error('sync/push error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};

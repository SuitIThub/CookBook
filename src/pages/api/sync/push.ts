import type { APIRoute } from 'astro';
import { db } from '../../../lib/database.server';
import { eventBus, EVENTS } from '../../../lib/events';
import type { Recipe } from '../../../types/recipe';
import type { Product, Supermarket, CatalogueIngredient } from '../../../types/tracker';
import type { ShoppingList } from '../../../types/recipe';
import { mergeShoppingList, sameShoppingListContent, stripShoppingListNotes } from '../../../lib/syncMerge';

/**
 * Push endpoint (client -> server). Applies client changes with last-write-wins
 * (server keeps the newer row by updated_at). Applied writes are logged in the
 * server's change log (this endpoint never sets the echo-suppression flag), so
 * OTHER clients receive them on their next pull.
 *
 * Deletes are last-write-wins too (client `deletedAt` vs row `updatedAt`, and
 * the server tombstone vs an incoming edit). Shopping lists pushed with their
 * `base` are three-way merged per item instead (syncMerge.ts). Whenever the
 * server doesn't take a change verbatim it returns its resulting row in
 * `results`, so the client converges without waiting for a pull.
 */
type PushChange = {
  type: string;
  id: string;
  op: 'upsert' | 'delete';
  data?: any;
  /** Client-side delete time (epoch ms) — delete-vs-edit last-write-wins. */
  deletedAt?: number;
  /** Common ancestor the client edited from (shopping lists → three-way merge). */
  base?: any;
};
/** Server's resulting row for a change it did not take verbatim, so the client converges. */
type PushResult = { type: string; id: string; op: 'upsert' | 'delete'; data?: unknown; deletedAt?: number };

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
  {
    applyUpsert: (data: any) => void;
    applyDelete: (id: string) => void;
    existingUpdatedAt: (id: string) => number | null;
    /** Current server row, in the shape the pull endpoint sends. */
    current: (id: string) => unknown;
  }
> = {
  recipe: {
    applyUpsert: (data: Recipe) => db.upsertRecipe(data),
    applyDelete: (id: string) => db.deleteRecipeForSync(id),
    existingUpdatedAt: (id: string) => {
      const r = db.getRecipe(id);
      return r ? ms(r.updatedAt) : null;
    },
    current: (id) => db.getRecipe(id)
  },
  product: {
    applyUpsert: (data: Product) => db.upsertProductForSync(data),
    applyDelete: (id: string) => db.deleteProductForSync(id),
    existingUpdatedAt: (id: string) => {
      const p = db.getProduct(id);
      return p ? ms(p.updatedAt) : null;
    },
    current: (id) => db.getProduct(id)
  },
  supermarket: {
    applyUpsert: (data: Supermarket) => db.upsertSupermarketForSync(data),
    applyDelete: (id: string) => db.deleteSupermarketForSync(id),
    existingUpdatedAt: (id: string) => {
      const s = db.getSupermarket(id);
      return s ? ms(s.updatedAt) : null;
    },
    current: (id) => db.getSupermarket(id)
  },
  ingredient: {
    applyUpsert: (data: CatalogueIngredient) => db.upsertIngredientForSync(data),
    applyDelete: (id: string) => db.deleteIngredientForSync(id),
    // ingredients have no updated_at column → no LWW guard, always apply.
    existingUpdatedAt: () => null,
    current: (id) => db.getCatalogueIngredientById(id)
  },
  shopping_list: {
    applyUpsert: (data: ShoppingList) => {
      // The pull strips item notes (they can be huge base64 blobs the app never
      // renders); re-attach them from the stored list by item id so an app push
      // — which carries no notes — doesn't wipe notes authored on the website.
      const existing = db.getShoppingList(data.id);
      if (existing) {
        const notes = new Map(existing.items.filter((i) => i.note != null).map((i) => [i.id, i.note]));
        if (notes.size && Array.isArray(data.items)) {
          for (const it of data.items) if (it.note == null && notes.has(it.id)) it.note = notes.get(it.id);
        }
      }
      db.upsertShoppingListForSync(data);
      // Notify live (SSE) clients — e.g. the website's open list view — so an
      // app edit shows up without a manual page reload. (upsertShoppingListForSync
      // is the silent sync-apply path and doesn't emit this itself.)
      eventBus.emit(EVENTS.SHOPPING_LIST_UPDATED, { listId: data.id, list: db.getShoppingList(data.id) });
    },
    applyDelete: (id: string) => {
      db.deleteShoppingListForSync(id);
      eventBus.emit(EVENTS.SHOPPING_LIST_DELETED, { listId: id });
    },
    existingUpdatedAt: (id: string) => {
      const l = db.getShoppingList(id);
      return l ? ms(l.updatedAt) : null;
    },
    current: (id) => {
      const l = db.getShoppingList(id);
      return l ? stripShoppingListNotes(l) : null;
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
    let merged = 0;
    const results: PushResult[] = [];
    const now = Date.now();
    const resultFor = (type: string, id: string) => {
      const row = HANDLERS[type].current(id);
      if (row) results.push({ type, id, op: 'upsert', data: row });
      else results.push({ type, id, op: 'delete', deletedAt: db.getTombstoneTime(type, id) ?? undefined });
    };

    for (const ch of changes) {
      const handler = HANDLERS[ch.type];
      if (!handler) {
        skipped++;
        continue;
      }
      const existing = handler.existingUpdatedAt(ch.id);
      if (ch.op === 'delete') {
        // Delete-vs-edit LWW: someone edited the row after this client deleted
        // it (offline) → keep the edit and send it back so the client restores it.
        const deletedAt = Number(ch.deletedAt) || 0;
        if (existing !== null && deletedAt > 0 && existing > deletedAt) {
          skipped++;
          resultFor(ch.type, ch.id);
          continue;
        }
        handler.applyDelete(ch.id);
        if (deletedAt > 0) db.setTombstoneTime(ch.type, ch.id, Math.min(deletedAt, now));
        deleted++;
      } else if (ch.data) {
        const incoming = ms(ch.data.updatedAt);
        if (existing === null) {
          // Deleted on the server after this edit was made → the delete wins.
          const tomb = db.getTombstoneTime(ch.type, ch.id);
          if (tomb !== null && incoming > 0 && tomb > incoming) {
            skipped++;
            resultFor(ch.type, ch.id);
            continue;
          }
          handler.applyUpsert(ch.data);
          applied++;
        } else if (ch.type === 'shopping_list' && ch.base) {
          // Three-way merge: concurrent edits to different items both survive.
          const current = db.getShoppingList(ch.id)!;
          const result = mergeShoppingList(ch.base, ch.data, current);
          if (!sameShoppingListContent(result, current)) {
            handler.applyUpsert({ ...result, updatedAt: new Date(Math.max(now, incoming)).toISOString() });
          }
          merged++;
          resultFor(ch.type, ch.id);
        } else if (incoming >= existing) {
          // Last-write-wins: apply only if the incoming row is at least as new.
          handler.applyUpsert(ch.data);
          applied++;
        } else {
          skipped++;
          resultFor(ch.type, ch.id);
        }
      }
    }

    return json({ ok: true, applied, deleted, skipped, merged, results, cursor: db.getMaxSyncSeq() });
  } catch (error) {
    console.error('sync/push error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};

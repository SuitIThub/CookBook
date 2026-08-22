/**
 * Sync client (Phase 2 / Y-sync-1): pull server changes into the local sql.js
 * replica. Server-authoritative — applied changes overwrite local rows
 * (last-write-wins with the server winning). Cursor is the monotonic
 * sync_changes.seq, persisted in localStorage per entity scope.
 *
 * Push (local -> server) + outbox + per-entity opt-out come next.
 */
import { getLocalDb } from './localDb';
import { apiGet, apiPost, ApiError } from './api';

const CURSOR_KEY = 'kochbuch.sync.cursor';
const PUSH_CURSOR_KEY = 'kochbuch.sync.pushCursor';

/**
 * Per-entity sync handlers on the local replica. Adding an entity to sync is a
 * single registry line here (+ its *ForSync methods in the shared core + the
 * server pull/push registries).
 */
interface EntityHandler {
  upsert(db: any, data: any): void;
  del(db: any, id: string): void;
  get(db: any, id: string): any;
  /** Return true to keep a local row out of the push (per-record opt-out). */
  skipPush?(row: any): boolean;
}
const REGISTRY: Record<string, EntityHandler> = {
  recipe: {
    upsert: (db, d) => db.upsertRecipe(d),
    del: (db, id) => db.deleteRecipeForSync(id),
    get: (db, id) => db.getRecipe(id),
    skipPush: (row) => !!row?.isPrivate
  },
  product: {
    upsert: (db, d) => db.upsertProductForSync(d),
    del: (db, id) => db.deleteProductForSync(id),
    get: (db, id) => db.getProduct(id)
  },
  supermarket: {
    upsert: (db, d) => db.upsertSupermarketForSync(d),
    del: (db, id) => db.deleteSupermarketForSync(id),
    get: (db, id) => db.getSupermarket(id)
  },
  ingredient: {
    upsert: (db, d) => db.upsertIngredientForSync(d),
    del: (db, id) => db.deleteIngredientForSync(id),
    get: (db, id) => db.getCatalogueIngredientById(id)
  }
};
const SYNCED_TYPES = Object.keys(REGISTRY);

interface PullChange {
  type: string;
  id: string;
  op: 'upsert' | 'delete';
  data?: any;
}
interface PullResponse {
  cursor: number;
  changes: PullChange[];
}

export interface PullResult {
  ok: boolean;
  applied: number;
  deleted: number;
  cursor: number;
  offline?: boolean;
  error?: string;
}

function getCursor(): number {
  return Number(localStorage.getItem(CURSOR_KEY) || '0') || 0;
}
function setCursor(seq: number): void {
  localStorage.setItem(CURSOR_KEY, String(seq));
}

/**
 * Pull once. On network failure returns { ok:false, offline:true } and leaves
 * the local replica untouched — the app keeps working from local (fallback).
 */
export async function pullFromServer(): Promise<PullResult> {
  const { db, persist } = await getLocalDb();
  const since = getCursor();

  let res: PullResponse;
  try {
    res = await apiGet<PullResponse>(
      `/api/sync/pull?since=${since}&types=${SYNCED_TYPES.join(',')}`
    );
  } catch (err) {
    // Server unreachable (or non-2xx) → stay on local data.
    const offline = !(err instanceof ApiError);
    return { ok: false, applied: 0, deleted: 0, cursor: since, offline, error: String(err) };
  }

  let applied = 0;
  let deleted = 0;
  // Apply under echo-suppression so these server rows aren't re-pushed later.
  db.applySync(() => {
    for (const ch of res.changes) {
      const handler = REGISTRY[ch.type];
      if (!handler) continue;
      if (ch.op === 'delete') {
        handler.del(db, ch.id);
        deleted++;
      } else if (ch.data) {
        handler.upsert(db, ch.data);
        applied++;
      }
    }
  });

  setCursor(res.cursor);
  // Absorb anything the apply wrote to the LOCAL change log into the push
  // cursor, so pulled rows are never treated as an outbox entry to push back.
  // This is the definitive echo guard (independent of trigger-level suppression).
  setPushCursor(db.getMaxSyncSeq());
  await persist();
  return { ok: true, applied, deleted, cursor: res.cursor };
}

export interface PushResult {
  ok: boolean;
  pushed: number;
  offline?: boolean;
  error?: string;
}

function getPushCursor(): number {
  return Number(localStorage.getItem(PUSH_CURSOR_KEY) || '0') || 0;
}
function setPushCursor(seq: number): void {
  localStorage.setItem(PUSH_CURSOR_KEY, String(seq));
}

/**
 * Push local (user-initiated) writes to the server. The local change log only
 * contains user writes — pulled rows are applied under echo-suppression — so
 * this is the outbox. Collapses to the latest op per entity.
 */
export async function pushToServer(): Promise<PushResult> {
  const { db } = await getLocalDb();
  const since = getPushCursor();
  const upTo = db.getMaxSyncSeq();
  if (upTo <= since) return { ok: true, pushed: 0 };

  const log = db.getSyncChangesSince(since, SYNCED_TYPES);
  const latest = new Map<string, { entity_type: string; entity_id: string; op: string }>();
  for (const c of log) latest.set(`${c.entity_type} ${c.entity_id}`, c);

  const changes: { type: string; id: string; op: string; data?: unknown }[] = [];
  for (const c of latest.values()) {
    const handler = REGISTRY[c.entity_type];
    if (!handler) continue;
    if (c.op === 'delete') {
      changes.push({ type: c.entity_type, id: c.entity_id, op: 'delete' });
    } else {
      const row = handler.get(db, c.entity_id);
      if (row && handler.skipPush?.(row)) continue; // per-record opt-out
      if (row) changes.push({ type: c.entity_type, id: c.entity_id, op: 'upsert', data: row });
      else changes.push({ type: c.entity_type, id: c.entity_id, op: 'delete' });
    }
  }

  if (changes.length === 0) {
    setPushCursor(upTo);
    return { ok: true, pushed: 0 };
  }

  try {
    await apiPost('/api/sync/push', { changes });
    setPushCursor(upTo);
    return { ok: true, pushed: changes.length };
  } catch (err) {
    const offline = !(err instanceof ApiError);
    return { ok: false, pushed: 0, offline, error: String(err) };
  }
}

/** Reset the sync cursors so the next pull re-fetches a full snapshot. */
export function resetSyncCursor(): void {
  localStorage.removeItem(CURSOR_KEY);
  localStorage.removeItem(PUSH_CURSOR_KEY);
}

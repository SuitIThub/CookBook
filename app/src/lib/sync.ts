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

/** Parse a date-ish value to epoch ms; 0 when absent/unparseable (→ no LWW guard). */
function ms(v: unknown): number {
  if (v == null) return 0;
  const t = new Date(v as string).getTime();
  return Number.isFinite(t) ? t : 0;
}

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
  },
  shopping_list: {
    upsert: (db, d) => db.upsertShoppingListForSync(d),
    del: (db, id) => db.deleteShoppingListForSync(id),
    get: (db, id) => db.getShoppingList(id)
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
 * Reset the pull cursor so the next pull is a full server snapshot (since=0).
 * Used by "Neu synchronisieren" and by the schema-version guard on app update:
 * the cursor is a single global high-water mark, so a client that advanced it
 * before an entity type was added (or before the server created rows) would
 * otherwise never see those rows again. LWW still protects newer local edits.
 * The push cursor is left intact so pending local writes stay pushable.
 */
export function resetPullCursor(): void {
  localStorage.setItem(CURSOR_KEY, '0');
}

/**
 * Pull once. On network failure returns { ok:false, offline:true } and leaves
 * the local replica untouched — the app keeps working from local (fallback).
 */
// Pull each entity type in its own request (dependency-first). One combined
// response can be huge — e.g. a shopping-list item with a base64 image pasted
// into its note pushed the bundled snapshot to ~13 MB — which the native HTTP
// bridge / a short timeout can't deliver, silently dropping whatever comes last
// (shopping lists). Per-type requests keep each response bounded and isolate a
// heavy type so it can't block the others.
const PULL_TIMEOUT_MS = 60000; // background sync, non-interactive → generous.
const TYPE_ORDER = ['supermarket', 'ingredient', 'product', 'recipe', 'shopping_list'];

export async function pullFromServer(): Promise<PullResult> {
  const { db, persist } = await getLocalDb();
  const since = getCursor();
  const types = TYPE_ORDER.filter((t) => SYNCED_TYPES.includes(t));

  let applied = 0;
  let deleted = 0;
  let maxCursor = since;
  let allOk = true;
  let anyOk = false;
  let firstError: string | undefined;
  let offlineAll = true;
  const outboxBefore = db.getMaxSyncSeq();

  for (const type of types) {
    let res: PullResponse;
    try {
      res = await apiGet<PullResponse>(`/api/sync/pull?since=${since}&types=${type}`, { timeoutMs: PULL_TIMEOUT_MS });
    } catch (err) {
      // This type failed; keep the others and retry this one next sync (the
      // cursor is only advanced when every type succeeded).
      allOk = false;
      if (!firstError) firstError = String(err);
      if (err instanceof ApiError && err.status >= 400) offlineAll = false; // reached the server
      continue;
    }
    anyOk = true;
    offlineAll = false;
    maxCursor = Math.max(maxCursor, res.cursor);
    db.applySync(() => {
      for (const ch of res.changes) {
        const handler = REGISTRY[ch.type];
        if (!handler) continue;
        if (ch.op === 'delete') {
          handler.del(db, ch.id);
          deleted++;
        } else if (ch.data) {
          // Client-side last-write-wins: don't let a pulled row (incl. our own
          // echo) overwrite a NEWER local edit.
          const local = handler.get(db, ch.id);
          const incomingTs = ms((ch.data as any).updatedAt);
          const localTs = local ? ms((local as any).updatedAt) : null;
          if (localTs === null || incomingTs === 0 || incomingTs >= localTs) {
            handler.upsert(db, ch.data);
            applied++;
          }
        }
      }
    });
  }

  // Advance the pull cursor only if every type succeeded — otherwise a failing
  // type would be skipped forever. Re-pulling succeeded types is idempotent (LWW).
  if (allOk) setCursor(maxCursor);
  const outboxAfter = db.getMaxSyncSeq();
  if (outboxAfter > outboxBefore) setPushCursor(outboxAfter);
  await persist();

  if (!anyOk) {
    return { ok: false, applied, deleted, cursor: since, offline: offlineAll, error: firstError };
  }
  return { ok: allOk, applied, deleted, cursor: allOk ? maxCursor : since, error: firstError };
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

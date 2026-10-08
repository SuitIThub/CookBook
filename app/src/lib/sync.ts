/**
 * Sync client: pull server changes into the local sql.js replica and push local
 * writes back. Server-authoritative with last-write-wins per record, except:
 *
 *  - Deletes are LWW too: a remote delete doesn't wipe a newer unpushed local
 *    edit, and a local delete doesn't resurrect-proof a newer remote edit (the
 *    server sends its row back and the client restores it).
 *  - Shopping lists are three-way merged per item against `sync_base` (the last
 *    version both sides agreed on) so two people editing one list both win.
 *  - Private recipes are local-only: never uploaded (a previously shared copy
 *    is deleted on the server) and never overwritten/deleted by remote changes.
 *
 * Cursors are the server's monotonic sync_changes.seq, kept PER ENTITY TYPE
 * (each type is pulled in its own request; a single shared high-water mark
 * would skip changes committed between two type requests).
 */
import { getLocalDb } from './localDb';
import { apiGet, apiPost, ApiError } from './api';
import { mergeShoppingList, sameShoppingListContent } from '@core/syncMerge';

const LEGACY_CURSOR_KEY = 'kochbuch.sync.cursor';
const CURSORS_KEY = 'kochbuch.sync.cursors';
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
  /** Local-only row: never pushed (a delete is pushed instead), never touched by remote changes. */
  localOnly?(row: any): boolean;
  /** Three-way merge (base, local, remote) — enables per-item merging + base tracking. */
  merge?(base: any, local: any, remote: any): any;
  same?(a: any, b: any): boolean;
  /** Shape of the row in a push payload (default: as stored). */
  pushData?(row: any): any;
}
const REGISTRY: Record<string, EntityHandler> = {
  recipe: {
    upsert: (db, d) => db.upsertRecipe(d),
    del: (db, id) => db.deleteRecipeForSync(id),
    get: (db, id) => db.getRecipe(id),
    localOnly: (row) => !!row?.isPrivate
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
    get: (db, id) => db.getShoppingList(id),
    merge: mergeShoppingList,
    same: sameShoppingListContent,
    // Notes protocol 2: stripped big notes carry `noteRef`; an item with neither
    // note nor ref had its note removed (server must not re-attach it).
    pushData: (row) => ({ ...row, __notesV: 2 })
  }
};
const SYNCED_TYPES = Object.keys(REGISTRY);

interface RemoteChange {
  type: string;
  id: string;
  op: 'upsert' | 'delete';
  data?: any;
  deletedAt?: number;
}
interface PullResponse {
  cursor: number;
  changes: RemoteChange[];
}

export interface PullResult {
  ok: boolean;
  /** At least one request reached the server (push is worth trying). */
  reachable: boolean;
  applied: number;
  deleted: number;
  offline?: boolean;
  error?: string;
}

// --- cursors --------------------------------------------------------------

function readCursors(): Record<string, number> {
  try {
    const raw = localStorage.getItem(CURSORS_KEY);
    if (raw) return JSON.parse(raw) || {};
  } catch {
    /* fall through */
  }
  // Migrate the old single global cursor: every type starts from it.
  const legacy = Number(localStorage.getItem(LEGACY_CURSOR_KEY) || '0') || 0;
  return Object.fromEntries(SYNCED_TYPES.map((t) => [t, legacy]));
}
function writeCursors(c: Record<string, number>): void {
  localStorage.setItem(CURSORS_KEY, JSON.stringify(c));
  localStorage.removeItem(LEGACY_CURSOR_KEY);
}

/**
 * Reset the pull cursors so the next pull is a full server snapshot (since=0).
 * Used by "Neu synchronisieren" and by the schema-version guard on app update.
 * LWW / merge still protect newer local edits. The push cursor is left intact
 * so pending local writes stay pushable.
 */
export function resetPullCursor(): void {
  writeCursors(Object.fromEntries(SYNCED_TYPES.map((t) => [t, 0])));
}

function getPushCursor(): number {
  return Number(localStorage.getItem(PUSH_CURSOR_KEY) || '0') || 0;
}
function setPushCursor(seq: number): void {
  localStorage.setItem(PUSH_CURSOR_KEY, String(seq));
}

/** Entities with local writes not yet pushed (`type id` keys). */
function pendingKeys(db: any): Set<string> {
  const log = db.getSyncChangesSince(getPushCursor(), SYNCED_TYPES) as { entity_type: string; entity_id: string }[];
  return new Set(log.map((c) => `${c.entity_type} ${c.entity_id}`));
}

/**
 * Apply one remote change (from a pull or a push result) to the local replica.
 * Must run inside db.applySync (echo suppression). Returns what happened.
 */
function applyRemote(db: any, ch: RemoteChange, pending: Set<string>): 'applied' | 'deleted' | 'kept' {
  const handler = REGISTRY[ch.type];
  if (!handler) return 'kept';
  const local = handler.get(db, ch.id);
  const isPending = pending.has(`${ch.type} ${ch.id}`);
  if (local && handler.localOnly?.(local)) return 'kept';

  if (ch.op === 'delete') {
    // An unpushed local edit made after the remote delete wins (it'll be
    // pushed and re-create the row on the server).
    if (local && isPending && ch.deletedAt && ms(local.updatedAt) > ch.deletedAt) return 'kept';
    if (local) handler.del(db, ch.id);
    db.deleteSyncBase(ch.type, ch.id);
    return 'deleted';
  }
  if (!ch.data) return 'kept';
  const incomingTs = ms(ch.data.updatedAt);

  if (!local) {
    // Deleted locally after this version was written → the local delete wins.
    const tomb = db.getTombstoneTime(ch.type, ch.id);
    if (tomb !== null && incomingTs > 0 && tomb > incomingTs) return 'kept';
    handler.upsert(db, ch.data);
    if (handler.merge) db.setSyncBase(ch.type, ch.id, ch.data);
    return 'applied';
  }

  if (handler.merge) {
    const base = db.getSyncBase(ch.type, ch.id);
    const localChanged = isPending && !(base && handler.same!(local, base));
    if (!localChanged) {
      handler.upsert(db, ch.data);
    } else if (base) {
      // Unpushed local edits on top of `base` + remote edits → merge; the
      // merged row is still in the outbox and gets pushed (with the new base).
      const merged = handler.merge(base, local, ch.data);
      handler.upsert(db, { ...merged, updatedAt: local.updatedAt });
    } else if (incomingTs === 0 || incomingTs >= ms(local.updatedAt)) {
      handler.upsert(db, ch.data); // legacy row without base → plain LWW
    } else {
      return 'kept';
    }
    db.setSyncBase(ch.type, ch.id, ch.data);
    return 'applied';
  }

  // Client-side last-write-wins: don't let a pulled row (incl. our own echo)
  // overwrite a NEWER local edit.
  if (incomingTs === 0 || incomingTs >= ms(local.updatedAt)) {
    handler.upsert(db, ch.data);
    return 'applied';
  }
  return 'kept';
}

// Pull each entity type in its own request (dependency-first). One combined
// response can be huge — e.g. a shopping-list item with a base64 image pasted
// into its note pushed the bundled snapshot to ~13 MB — which the native HTTP
// bridge / a short timeout can't deliver. Per-type requests keep each response
// bounded and isolate a heavy type so it can't block the others.
const PULL_TIMEOUT_MS = 60000; // background sync, non-interactive → generous.
const TYPE_ORDER = ['supermarket', 'ingredient', 'product', 'recipe', 'shopping_list'];

/**
 * Pull once. On network failure returns { ok:false, offline:true } and leaves
 * the local replica untouched — the app keeps working from local (fallback).
 */
export async function pullFromServer(): Promise<PullResult> {
  const { db, persist } = await getLocalDb();
  const cursors = readCursors();
  const types = TYPE_ORDER.filter((t) => SYNCED_TYPES.includes(t));

  let applied = 0;
  let deleted = 0;
  let allOk = true;
  let reachable = false;
  let firstError: string | undefined;

  for (const type of types) {
    const since = cursors[type] || 0;
    let res: PullResponse;
    try {
      res = await apiGet<PullResponse>(`/api/sync/pull?since=${since}&types=${type}`, { timeoutMs: PULL_TIMEOUT_MS });
    } catch (err) {
      // This type failed; the others still advance. It retries next sync.
      allOk = false;
      if (!firstError) firstError = String(err);
      if (err instanceof ApiError && err.status >= 400) reachable = true;
      continue;
    }
    reachable = true;
    // Computed after the await so writes the user made meanwhile count as pending.
    const pending = pendingKeys(db);
    db.applySync(() => {
      for (const ch of res.changes) {
        const r = applyRemote(db, ch, pending);
        if (r === 'applied') applied++;
        else if (r === 'deleted') deleted++;
      }
    });
    cursors[type] = Math.max(since, res.cursor);
    writeCursors(cursors);
  }

  await persist();
  if (!reachable) return { ok: false, reachable, applied, deleted, offline: true, error: firstError };
  return { ok: allOk, reachable, applied, deleted, error: firstError };
}

export interface PushResult {
  ok: boolean;
  pushed: number;
  offline?: boolean;
  error?: string;
}

/**
 * Push local (user-initiated) writes to the server. The local change log only
 * contains user writes — pulled rows are applied under echo-suppression — so
 * this is the outbox. Collapses to the latest op per entity.
 */
export async function pushToServer(): Promise<PushResult> {
  const { db, persist } = await getLocalDb();
  const since = getPushCursor();
  const upTo = db.getMaxSyncSeq();
  if (upTo <= since) return { ok: true, pushed: 0 };

  const log = db.getSyncChangesSince(since, SYNCED_TYPES);
  const latest = new Map<string, { entity_type: string; entity_id: string; op: string }>();
  for (const c of log) latest.set(`${c.entity_type} ${c.entity_id}`, c);

  const changes: { type: string; id: string; op: string; data?: unknown; deletedAt?: number; base?: unknown }[] = [];
  for (const c of latest.values()) {
    const handler = REGISTRY[c.entity_type];
    if (!handler) continue;
    const row = c.op === 'delete' ? null : handler.get(db, c.entity_id);
    if (row && handler.localOnly?.(row)) {
      // Made private: remove any previously shared copy from the server.
      changes.push({ type: c.entity_type, id: c.entity_id, op: 'delete', deletedAt: ms(row.updatedAt) || Date.now() });
    } else if (row) {
      const base = handler.merge ? db.getSyncBase(c.entity_type, c.entity_id) : null;
      changes.push({ type: c.entity_type, id: c.entity_id, op: 'upsert', data: handler.pushData ? handler.pushData(row) : row, ...(base ? { base } : {}) });
    } else {
      const deletedAt = db.getTombstoneTime(c.entity_type, c.entity_id) ?? Date.now();
      changes.push({ type: c.entity_type, id: c.entity_id, op: 'delete', deletedAt });
    }
  }

  if (changes.length === 0) {
    setPushCursor(upTo);
    return { ok: true, pushed: 0 };
  }

  let res: { results?: RemoteChange[] };
  try {
    res = await apiPost('/api/sync/push', { changes });
  } catch (err) {
    const offline = !(err instanceof ApiError);
    return { ok: false, pushed: 0, offline, error: String(err) };
  }

  // Writes made while the request was in flight have seq > upTo and stay queued.
  setPushCursor(upTo);
  const results = new Map((res?.results ?? []).map((r) => [`${r.type} ${r.id}`, r]));
  const pending = pendingKeys(db);
  db.applySync(() => {
    for (const ch of changes) {
      const key = `${ch.type} ${ch.id}`;
      const result = results.get(key);
      if (result) {
        // Server merged/rejected → converge on its version. A newer local edit
        // made during the request is pending and gets merged, not overwritten.
        applyRemote(db, result, pending);
      } else if (ch.op === 'upsert' && REGISTRY[ch.type].merge && !pending.has(key)) {
        db.setSyncBase(ch.type, ch.id, ch.data);
      } else if (ch.op === 'delete') {
        db.deleteSyncBase(ch.type, ch.id);
      }
    }
  });
  await persist();
  return { ok: true, pushed: changes.length };
}

/** Reset the sync cursors so the next pull re-fetches a full snapshot. */
export function resetSyncCursor(): void {
  localStorage.removeItem(CURSORS_KEY);
  localStorage.removeItem(LEGACY_CURSOR_KEY);
  localStorage.removeItem(PUSH_CURSOR_KEY);
}

/** Number of entities with local edits not yet uploaded (outbox size). */
export async function pendingCount(): Promise<number> {
  const { db } = await getLocalDb();
  return pendingKeys(db).size;
}

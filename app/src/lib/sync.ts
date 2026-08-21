/**
 * Sync client (Phase 2 / Y-sync-1): pull server changes into the local sql.js
 * replica. Server-authoritative — applied changes overwrite local rows
 * (last-write-wins with the server winning). Cursor is the monotonic
 * sync_changes.seq, persisted in localStorage per entity scope.
 *
 * Push (local -> server) + outbox + per-entity opt-out come next.
 */
import { getLocalDb } from './localDb';
import { apiGet, ApiError } from './api';

const CURSOR_KEY = 'kochbuch.sync.cursor';
const SYNCED_TYPES = ['recipe'] as const;

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
  for (const ch of res.changes) {
    if (ch.type !== 'recipe') continue;
    if (ch.op === 'delete') {
      db.deleteRecipeForSync(ch.id);
      deleted++;
    } else if (ch.data) {
      db.upsertRecipe(ch.data);
      applied++;
    }
  }

  setCursor(res.cursor);
  await persist();
  return { ok: true, applied, deleted, cursor: res.cursor };
}

/** Reset the sync cursor so the next pull re-fetches a full snapshot. */
export function resetSyncCursor(): void {
  localStorage.removeItem(CURSOR_KEY);
}

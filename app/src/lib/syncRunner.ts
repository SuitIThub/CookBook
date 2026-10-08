/**
 * Background sync: pull server changes into the local replica, then push local
 * writes. "Server first, local fallback" — if the server is unreachable, pull/
 * push no-op and the app keeps working from local data. Push needs a token;
 * without one it simply fails soft (read-only).
 */
import { pullFromServer, pushToServer, resetPullCursor } from './sync';

export interface SyncOutcome {
  online: boolean;
  applied: number;
  deleted: number;
  pushed: number;
}

let inFlight: Promise<SyncOutcome> | null = null;

/**
 * Bump this whenever a change could strand data behind the single global pull
 * cursor (new synced entity type, changed sync payload, etc.). On the first run
 * after an app update the cursor is reset once so a full server snapshot is
 * re-pulled — otherwise rows the server created/changed before this client's
 * high-water mark are never seen again (the cause of "shopping lists / the
 * Sammelliste don't load after updating the app").
 */
const SYNC_SCHEMA_VERSION = '2026-10-08.per-type-cursors-merge';
const SCHEMA_VERSION_KEY = 'kochbuch.sync.schemaVersion';

/** Run once at startup: force a full re-pull when the sync schema version changed. */
export function ensureSyncSchemaVersion(): void {
  try {
    if (localStorage.getItem(SCHEMA_VERSION_KEY) !== SYNC_SCHEMA_VERSION) {
      resetPullCursor();
      localStorage.setItem(SCHEMA_VERSION_KEY, SYNC_SCHEMA_VERSION);
    }
  } catch {
    /* ignore */
  }
}

/** Reset the pull cursor and run a full sync (used by "Neu synchronisieren"). */
export function fullResync(): Promise<SyncOutcome> {
  resetPullCursor();
  return runSync();
}

export function runSync(): Promise<SyncOutcome> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const pull = await pullFromServer();
    let pushed = 0;
    // Push whenever the server answered at all — one entity type failing to
    // pull (e.g. a huge payload timing out) must not hold back local edits.
    if (pull.reachable) {
      const push = await pushToServer().catch(() => ({ ok: false, pushed: 0 }));
      pushed = push.pushed;
    }
    return { online: pull.reachable, applied: pull.applied, deleted: pull.deleted, pushed };
  })();
  try {
    return inFlight;
  } finally {
    inFlight.finally(() => {
      inFlight = null;
    });
  }
}

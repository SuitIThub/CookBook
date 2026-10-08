/**
 * Background sync: pull server changes into the local replica, then push local
 * writes. "Server first, local fallback" — if the server is unreachable, pull/
 * push no-op and the app keeps working from local data. Push needs a token;
 * without one it simply fails soft (read-only).
 *
 * Also owns the observable sync status (for the nav indicator) and the
 * automatic triggers: app start, focus/foreground, coming back online, a
 * periodic heartbeat and the server's change stream (/api/sync/stream).
 */
import { pullFromServer, pushToServer, resetPullCursor, pendingCount } from './sync';
import { apiBase } from './api';

export interface SyncOutcome {
  online: boolean;
  applied: number;
  deleted: number;
  pushed: number;
}

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error';
export interface SyncStatus {
  phase: SyncPhase;
  /** Entities with local edits not yet uploaded. */
  pending: number;
  /** Epoch ms of the last sync that reached the server. */
  lastSyncAt: number | null;
  /** Push was rejected by the server (e.g. no/invalid token → read-only). */
  pushError?: string;
}

let status: SyncStatus = { phase: 'idle', pending: 0, lastSyncAt: null };
const listeners = new Set<(s: SyncStatus) => void>();
function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  for (const l of listeners) l(status);
}
export function getSyncStatus(): SyncStatus {
  return status;
}
export function subscribeSyncStatus(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
/** Re-read the outbox size (call after a local write). */
export async function refreshPending(): Promise<void> {
  try {
    setStatus({ pending: await pendingCount() });
  } catch {
    /* local DB not ready yet */
  }
}

let inFlight: Promise<SyncOutcome> | null = null;
let again = false;

/**
 * Bump this whenever a change could strand data behind the pull cursors (new
 * synced entity type, changed sync payload, etc.). On the first run after an
 * app update the cursors are reset once so a full server snapshot is re-pulled.
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

async function syncOnce(): Promise<SyncOutcome> {
  setStatus({ phase: 'syncing' });
  const pull = await pullFromServer();
  let pushed = 0;
  let pushError: string | undefined;
  // Push whenever the server answered at all — one entity type failing to
  // pull (e.g. a huge payload timing out) must not hold back local edits.
  if (pull.reachable) {
    const push = await pushToServer().catch((e) => ({ ok: false, pushed: 0, offline: false, error: String(e) }));
    pushed = push.pushed;
    if (!push.ok && !push.offline) pushError = push.error;
  }
  const pending = await pendingCount().catch(() => status.pending);
  setStatus({
    phase: !pull.reachable ? 'offline' : pull.ok && !pushError ? 'idle' : 'error',
    pending,
    pushError,
    ...(pull.reachable ? { lastSyncAt: Date.now() } : {})
  });
  return { online: pull.reachable, applied: pull.applied, deleted: pull.deleted, pushed };
}

/**
 * Run a sync. Concurrent callers share the running sync; a request arriving
 * while one runs schedules exactly one follow-up (so a write made mid-sync is
 * pushed promptly instead of waiting for the next trigger).
 */
export function runSync(): Promise<SyncOutcome> {
  if (inFlight) {
    again = true;
    return inFlight;
  }
  inFlight = syncOnce().finally(() => {
    inFlight = null;
    if (again) {
      again = false;
      void runSync().then(notifyChanged, () => {});
    }
  });
  inFlight.then(notifyChanged, () => {});
  return inFlight;
}

let onChanged: (() => void) | null = null;
function notifyChanged(o: SyncOutcome) {
  if (o.online && (o.applied || o.deleted || o.pushed)) onChanged?.();
}

const HEARTBEAT_MS = 60000;

/**
 * Start automatic syncing. `onDataChanged` is called after a sync that changed
 * local data (the caller invalidates its queries). Returns a stop function.
 */
export function startAutoSync(onDataChanged: () => void): () => void {
  onChanged = onDataChanged;
  ensureSyncSchemaVersion();
  void refreshPending();
  const sync = () => void runSync().catch(() => {});
  sync();

  const onVisible = () => {
    if (document.visibilityState === 'visible') sync();
  };
  window.addEventListener('focus', sync);
  window.addEventListener('online', sync);
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') sync();
  }, HEARTBEAT_MS);

  // Server change stream → pull within seconds of a roommate's edit.
  let es: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let seenSeq = -1;
  const connect = () => {
    if (typeof EventSource === 'undefined') return;
    try {
      es = new EventSource(`${apiBase()}/api/sync/stream`);
    } catch {
      return;
    }
    es.onmessage = (ev) => {
      let seq = 0;
      try {
        seq = Number(JSON.parse(ev.data).seq) || 0;
      } catch {
        return;
      }
      const first = seenSeq < 0;
      if (seq === seenSeq) return;
      seenSeq = seq;
      if (first) return; // initial hello; the startup sync already covers it
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(sync, 400);
    };
    es.onerror = () => {
      // Browser auto-reconnects; if it gave up (server down), retry later.
      if (es && es.readyState === EventSource.CLOSED) {
        es = null;
        retry = setTimeout(connect, 30000);
      }
    };
  };
  connect();

  return () => {
    onChanged = null;
    window.removeEventListener('focus', sync);
    window.removeEventListener('online', sync);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
    if (retry) clearTimeout(retry);
    if (debounce) clearTimeout(debounce);
    es?.close();
  };
}

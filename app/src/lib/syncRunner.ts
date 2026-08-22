/**
 * Background sync: pull server changes into the local replica, then push local
 * writes. "Server first, local fallback" — if the server is unreachable, pull/
 * push no-op and the app keeps working from local data. Push needs a token;
 * without one it simply fails soft (read-only).
 */
import { pullFromServer, pushToServer } from './sync';

export interface SyncOutcome {
  online: boolean;
  applied: number;
  deleted: number;
  pushed: number;
}

let inFlight: Promise<SyncOutcome> | null = null;

export function runSync(): Promise<SyncOutcome> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const pull = await pullFromServer();
    let pushed = 0;
    if (pull.ok) {
      const push = await pushToServer().catch(() => ({ ok: false, pushed: 0 }));
      pushed = push.pushed;
    }
    return { online: pull.ok, applied: pull.applied, deleted: pull.deleted, pushed };
  })();
  try {
    return inFlight;
  } finally {
    inFlight.finally(() => {
      inFlight = null;
    });
  }
}

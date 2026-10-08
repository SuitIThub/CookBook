import { useEffect, useState } from 'react';
import { getSyncStatus, runSync, subscribeSyncStatus, type SyncStatus } from '@/lib/syncRunner';

function ago(ts: number | null): string {
  if (!ts) return 'noch nie';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'gerade eben';
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  return h < 24 ? `vor ${h} Std.` : new Date(ts).toLocaleString('de-DE');
}

/**
 * App-only nav control: shows whether local data is in sync with the server
 * (synced / syncing / offline / problem) and how many local edits still wait
 * for upload. Tapping it syncs now.
 */
export default function SyncIndicator() {
  const [s, setS] = useState<SyncStatus>(getSyncStatus());
  useEffect(() => subscribeSyncStatus(setS), []);
  // Re-render periodically so "vor x Min." stays current.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const label =
    s.phase === 'syncing'
      ? 'Synchronisiere …'
      : s.phase === 'offline'
        ? `Offline – Änderungen werden lokal gespeichert${s.pending ? ` (${s.pending} ausstehend)` : ''}`
        : s.phase === 'error'
          ? `Synchronisierung unvollständig${s.pushError ? ' – Hochladen fehlgeschlagen (Alias/Token in den Einstellungen prüfen)' : ''}`
          : s.pending
            ? `${s.pending} Änderung(en) warten auf Upload`
            : `Synchronisiert (${ago(s.lastSyncAt)})`;
  const color =
    s.phase === 'offline'
      ? 'text-gray-400 dark:text-gray-500'
      : s.phase === 'error'
        ? 'text-red-500 dark:text-red-400'
        : s.pending
          ? 'text-orange-500 dark:text-orange-400'
          : 'text-green-600 dark:text-green-400';

  return (
    <button
      type="button"
      onClick={() => void runSync().catch(() => {})}
      className={`btn-icon relative ${color}`}
      aria-label={label}
      title={label}
      data-sync-phase={s.phase}
    >
      <svg
        className={`h-5 w-5 ${s.phase === 'syncing' ? 'animate-spin' : ''}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        {s.phase === 'syncing' ? (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        ) : (
          <>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
            {s.phase === 'offline' && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4l16 16" />}
            {s.phase === 'idle' && !s.pending && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.5 14l2 2 3.5-4" />}
          </>
        )}
      </svg>
      {s.pending > 0 && s.phase !== 'syncing' && (
        <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-orange-500 px-1 text-center text-[10px] font-bold leading-[1.1rem] text-white">
          {s.pending > 99 ? '99+' : s.pending}
        </span>
      )}
    </button>
  );
}

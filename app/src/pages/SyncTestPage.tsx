import { useEffect, useState } from 'react';
import { getLocalDb, resetLocalDb } from '@/lib/localDb';
import { pullFromServer, resetSyncCursor } from '@/lib/sync';
import { apiGet } from '@/lib/api';

/**
 * Temporary diagnostics route (/_synctest): proves server -> local replication.
 * Resets the local replica, pulls a full snapshot from the server, and checks
 * the local recipe count matches the server's.
 */
export default function SyncTestPage() {
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<'running' | 'pass' | 'fail'>('running');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: string[] = [];
      try {
        await resetLocalDb();
        resetSyncCursor();
        out.push('reset local replica + cursor');

        const pull = await pullFromServer();
        out.push(`pull: ok=${pull.ok} applied=${pull.applied} deleted=${pull.deleted} cursor=${pull.cursor}`);

        const { db } = await getLocalDb();
        const localCount = db.getAllRecipes().length;
        const serverCount = (await apiGet<any[]>('/api/recipes')).length;
        out.push(`local recipes=${localCount}  server recipes=${serverCount}`);

        const pass = pull.ok && localCount === serverCount && localCount > 0;
        out.push(pass ? 'MATCH ✓' : 'MISMATCH ✗');
        if (!cancelled) {
          setLog(out);
          setStatus(pass ? 'pass' : 'fail');
        }
      } catch (e) {
        out.push(`ERROR: ${(e as Error).message}`);
        if (!cancelled) {
          setLog(out);
          setStatus('fail');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Sync self-test (server → local)</h1>
      <p data-testid="sync-status" className="mb-4 font-mono">
        status: {status}
      </p>
      <pre className="overflow-x-auto rounded-lg bg-secondary-100 p-4 text-sm dark:bg-secondary-800">
        {log.join('\n')}
      </pre>
    </div>
  );
}

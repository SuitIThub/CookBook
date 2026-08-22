import { useEffect, useState } from 'react';
import { getLocalDb, resetLocalDb } from '@/lib/localDb';
import { pullFromServer, pushToServer, resetSyncCursor } from '@/lib/sync';
import { apiGet, ApiError } from '@/lib/api';

// Runs exactly once (mutates local + server state).
let hasRun = false;

/** /_optouttest: a private recipe stays local (never pushed); a public one syncs. */
export default function OptoutTestPage() {
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<'running' | 'pass' | 'fail'>('running');

  useEffect(() => {
    if (hasRun) return;
    hasRun = true;
    (async () => {
      const out: string[] = [];
      let fail = false;
      const ok = (c: boolean, m: string) => {
        out.push(`${c ? 'PASS' : 'FAIL'} ${m}`);
        if (!c) fail = true;
      };
      const serverHas = async (id: string) => {
        try {
          await apiGet(`/api/recipes?id=${id}`);
          return true;
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) return false;
          throw e;
        }
      };
      try {
        await resetLocalDb();
        resetSyncCursor();
        await pullFromServer();
        const { db, persist } = await getLocalDb();

        const priv = db.createRecipe({
          title: `Private ${Date.now()}`,
          metadata: { servings: 1, timeEntries: [] },
          ingredientGroups: [],
          preparationGroups: [],
          isPrivate: true
        } as any);
        const pub = db.createRecipe({
          title: `Public ${Date.now()}`,
          metadata: { servings: 1, timeEntries: [] },
          ingredientGroups: [],
          preparationGroups: []
        } as any);
        await persist();

        const push = await pushToServer();
        out.push(`pushed=${push.pushed}`);
        ok(push.ok && push.pushed === 1, `exactly 1 pushed (public only), pushed=${push.pushed}`);
        ok(await serverHas(pub.id), 'public recipe reached the server');
        ok(!(await serverHas(priv.id)), 'private recipe did NOT reach the server');

        // cleanup: remove the public recipe from the server
        db.deleteRecipeForSync(pub.id);
        await persist();
        await pushToServer();
        ok(!(await serverHas(pub.id)), 'cleanup: public recipe removed from server');

        setLog(out);
        setStatus(fail ? 'fail' : 'pass');
      } catch (e) {
        out.push(`ERROR: ${(e as Error).message}`);
        setLog(out);
        setStatus('fail');
      }
    })();
  }, []);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Opt-out self-test (private stays local)</h1>
      <p data-testid="optout-status" className="mb-4 font-mono">status: {status}</p>
      <pre className="overflow-x-auto rounded-lg bg-secondary-100 p-4 text-sm dark:bg-secondary-800">
        {log.join('\n')}
      </pre>
    </div>
  );
}

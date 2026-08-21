import { useEffect, useState } from 'react';
import { getLocalDb, resetLocalDb } from '@/lib/localDb';
import { pullFromServer, pushToServer, resetSyncCursor } from '@/lib/sync';
import { apiGet, ApiError } from '@/lib/api';

/**
 * Temporary diagnostics route (/_pushtest): proves local -> server push and
 * echo-suppression. Creates/deletes a test recipe locally, pushes it, and
 * checks the server reflects each step. Leaves the server clean.
 */
// Module-level guard: this test mutates shared local+server state, so it must
// run exactly once even under React StrictMode's double effect invocation.
let hasRun = false;

export default function PushTestPage() {
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<'running' | 'pass' | 'fail'>('running');

  useEffect(() => {
    if (hasRun) return;
    hasRun = true;
    let cancelled = false;
    (async () => {
      const out: string[] = [];
      let fail = false;
      const ok = (c: boolean, m: string) => {
        out.push(`${c ? 'PASS' : 'FAIL'} ${m}`);
        if (!c) fail = true;
      };
      const serverHas = async (id: string): Promise<boolean> => {
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

        // Echo check: pulled rows must not be pushed back.
        const echo = await pushToServer();
        ok(echo.ok && echo.pushed === 0, `echo suppressed: push after pull sends 0 (pushed=${echo.pushed})`);

        // Local create -> push -> server has it.
        const recipe = db.createRecipe({
          title: `Push Test ${Date.now()}`,
          metadata: { servings: 3, timeEntries: [] },
          ingredientGroups: [],
          preparationGroups: []
        } as any);
        await persist();
        const p1 = await pushToServer();
        ok(p1.ok && p1.pushed === 1, `local create pushes 1 (pushed=${p1.pushed})`);
        ok(await serverHas(recipe.id), 'server has the locally-created recipe after push');

        // Local delete -> push -> server removes it.
        db.deleteRecipeForSync(recipe.id);
        await persist();
        const p2 = await pushToServer();
        ok(p2.ok && p2.pushed === 1, `local delete pushes 1 (pushed=${p2.pushed})`);
        ok(!(await serverHas(recipe.id)), 'server removed the recipe after delete push (clean)');

        if (!cancelled) {
          setLog(out);
          setStatus(fail ? 'fail' : 'pass');
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
      <h1 className="mb-4 text-2xl font-bold">Push self-test (local → server)</h1>
      <p data-testid="push-status" className="mb-4 font-mono">
        status: {status}
      </p>
      <pre className="overflow-x-auto rounded-lg bg-secondary-100 p-4 text-sm dark:bg-secondary-800">
        {log.join('\n')}
      </pre>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { getLocalDb } from '@/lib/localDb';

/**
 * Temporary diagnostics route (/_localtest): proves the shared CookbookDatabase
 * runs on sql.js in the browser — schema creation, insert, query, single-get,
 * and IndexedDB persistence. Verified via Playwright; safe to remove once the
 * local data path is wired into real pages.
 */
export default function LocalDbTestPage() {
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<'running' | 'pass' | 'fail'>('running');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: string[] = [];
      const step = (ok: boolean, msg: string) => {
        out.push(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
        if (!ok) throw new Error(msg);
      };
      try {
        const { db, persist } = await getLocalDb();
        out.push('local db ready (sql.js + shared CookbookDatabase)');

        const before = db.getAllRecipes().length;
        const recipe = db.createRecipe({
          title: `Local Recipe ${Date.now()}`,
          metadata: { servings: 2, timeEntries: [] },
          ingredientGroups: [],
          preparationGroups: []
        } as any);
        const after = db.getAllRecipes().length;
        step(after === before + 1, `createRecipe: count ${before} -> ${after}`);

        const fetched = db.getRecipe(recipe.id);
        step(!!fetched && fetched.title === recipe.title, `getRecipe returns the inserted row ("${fetched?.title}")`);

        await persist();
        out.push('persisted to IndexedDB');

        if (!cancelled) {
          setLog(out);
          setStatus('pass');
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
      <h1 className="mb-4 text-2xl font-bold">Local DB self-test</h1>
      <p data-testid="localdb-status" className="mb-4 font-mono">
        status: {status}
      </p>
      <pre className="overflow-x-auto rounded-lg bg-secondary-100 p-4 text-sm dark:bg-secondary-800">
        {log.join('\n')}
      </pre>
    </div>
  );
}

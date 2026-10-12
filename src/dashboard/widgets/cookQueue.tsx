/** "Demnächst kochen": recipes to cook soon, without a date (see lib/cookQueue). */
import { useState } from 'react';
import { addToCookQueue, removeFromCookQueue, type CookQueueEntry } from '../../lib/cookQueue';
import { CookedDialog, useCookQueue } from '../cooking';
import { useDashboardData } from '../data';
import { Async, btnSmall, Empty, inputClass, useLoad } from '../ui';
import { PlanDialog } from './recipes';

function ago(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return 'heute';
  if (days === 1) return 'gestern';
  return `vor ${days} Tagen`;
}

export function CookQueueWidget() {
  const host = useDashboardData();
  const { Link } = host;
  const queue = useCookQueue();
  const [cooked, setCooked] = useState<CookQueueEntry | null>(null);
  const [planFor, setPlanFor] = useState<CookQueueEntry | null>(null);
  const [query, setQuery] = useState('');
  const recipes = useLoad(() => host.recipes(), []);

  const q = query.trim().toLowerCase();
  const queued = new Set(queue.map((e) => e.recipeId));
  const matches = q.length >= 2 && recipes.data ? recipes.data.filter((r) => !queued.has(r.id) && r.title.toLowerCase().includes(q)).slice(0, 6) : [];

  return (
    <div>
      {queue.length === 0 ? (
        <Empty>Nichts vorgemerkt. Gerichte kommen hierher über die Suche unten, „+ Demnächst kochen“ im Rezept oder den Vorschlag in der Einkaufsliste, wenn du die Zutaten eingekauft hast.</Empty>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {queue.map((e) => (
            <li key={e.recipeId} className="py-2">
              <div className="flex items-center gap-2">
                <Link to={`/rezept/${e.recipeId}`} className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 hover:underline dark:text-white">
                  {e.title}
                </Link>
                <button type="button" onClick={() => removeFromCookQueue(e.recipeId)} className="flex-shrink-0 rounded p-1 text-gray-400 hover:text-red-500" title="Von der Liste nehmen" aria-label={`${e.title} von der Liste nehmen`}>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="text-xs text-gray-500">
                {ago(e.addedAt)}
                {e.source ? ` · eingekauft mit „${e.source.listTitle}“` : ''}
                {e.servings ? ` · ${e.servings} Portionen` : ''}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                <Link to={`/rezept/${e.recipeId}/kochen`} className={btnSmall}>
                  Kochmodus
                </Link>
                <button type="button" className="rounded border border-emerald-500 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/30" onClick={() => setCooked(e)}>
                  Gekocht ✓
                </button>
                <button type="button" className={btnSmall} onClick={() => setPlanFor(e)} title="Mit Datum als Meal Prep planen">
                  Datum planen
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="relative mt-3">
        <input className={inputClass} placeholder="Rezept vormerken …" value={query} onChange={(ev) => setQuery(ev.target.value)} aria-label="Rezept suchen und vormerken" />
        {q.length >= 2 && (
          <div className="absolute inset-x-0 top-full z-10 mt-1 rounded border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
            <Async state={recipes}>
              {() =>
                matches.length === 0 ? (
                  <p className="p-2 text-xs text-gray-500">Kein passendes Rezept.</p>
                ) : (
                  <ul>
                    {matches.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          className="block w-full truncate px-2 py-1.5 text-left text-sm text-gray-800 hover:bg-orange-50 dark:text-gray-200 dark:hover:bg-gray-700"
                          onClick={() => {
                            addToCookQueue({ recipeId: r.id, title: r.title, servings: r.servings });
                            setQuery('');
                          }}
                        >
                          {r.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              }
            </Async>
          </div>
        )}
      </div>
      {cooked && (
        <CookedDialog
          recipe={{ id: cooked.recipeId, title: cooked.title, servings: cooked.servings }}
          createPlan={(input) => host.createPlan(input)}
          onClose={() => setCooked(null)}
        />
      )}
      {planFor && (
        <PlanDialog
          recipe={{ id: planFor.recipeId, title: planFor.title, servings: planFor.servings }}
          onClose={() => setPlanFor(null)}
          onPlanned={() => removeFromCookQueue(planFor.recipeId)}
        />
      )}
    </div>
  );
}

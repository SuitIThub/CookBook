/** Recipe & planning widgets: favorites, recommendations (+ AI week plan), planned meals, random and recent recipes. */
import { useState, type ReactNode } from 'react';
import type { MealPlan } from '../../types/tracker';
import { weekSeed } from '../../lib/weekRecommendations';
import { useDashboardData, type AiPlanEntry, type RecipeSummary } from '../data';
import type { WidgetConfigs } from '../model';
import { loadGoal } from '../trackerGoal';
import { addDays, Async, btnPrimary, btnSecondary, btnSmall, Empty, endOfDay, ErrorText, formatPortions, inputClass, localDateString, Modal, RecipeThumb, startOfDay, useDocumentEvent, useLoad, weekdayLabel } from '../ui';

/* ----------------------------------------------------------- Einplanen */

/** "Als Meal Prep planen" from the dashboard: date + portions → meal plan. */
export function PlanDialog({ recipe, onClose, onPlanned }: { recipe: { id: string; title: string; servings?: number }; onClose: () => void; onPlanned: () => void }) {
  const host = useDashboardData();
  const [date, setDate] = useState(localDateString(addDays(new Date(), 1)));
  const [servings, setServings] = useState(String(recipe.servings || 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const n = Number(servings.replace(',', '.'));
    if (!date || !(n > 0)) return;
    setBusy(true);
    setError(null);
    try {
      await host.createPlan({ recipeId: recipe.id, scheduledAt: new Date(`${date}T00:00:00`).toISOString(), servings: n });
      onPlanned();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Als Meal Prep planen"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btnSecondary} onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className={btnPrimary} onClick={save} disabled={busy}>
            Planen
          </button>
        </>
      }
    >
      <p className="mb-3 font-medium">{recipe.title}</p>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="block">
          Verfügbar ab
          <input type="date" className={`mt-1 ${inputClass}`} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block">
          Zubereitete Portionen
          <input type="number" min="0.5" step="0.5" className={`mt-1 ${inputClass}`} value={servings} onChange={(e) => setServings(e.target.value)} />
        </label>
      </div>
      <p className="mt-2 text-[11px] text-gray-500">Die Portionen stehen ab diesem Tag bereit und werden im Tracker über mehrere Tage abgestrichen.</p>
      {error && <ErrorText>{error}</ErrorText>}
    </Modal>
  );
}

function RecipeTile({ r, action }: { r: { id: string; title: string; imageUrl?: string }; action?: ReactNode }) {
  const { Link } = useDashboardData();
  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
      <Link to={`/rezept/${r.id}`} className="block">
        <RecipeThumb src={r.imageUrl} title={r.title} className="h-24 w-full !rounded-none" />
      </Link>
      <div className="flex flex-1 flex-col justify-between gap-1 p-2">
        <Link to={`/rezept/${r.id}`} className="line-clamp-2 text-sm font-medium text-gray-900 hover:underline dark:text-white">
          {r.title}
        </Link>
        {action}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- Favoriten */

export function FavoritesWidget({ config }: { config: WidgetConfigs['favorites'] }) {
  const host = useDashboardData();
  const { Link } = host;
  const state = useLoad(async () => {
    const ids = host.favoriteIds();
    if (ids.length === 0) return [];
    const byId = new Map((await host.recipes()).map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((r): r is RecipeSummary => !!r);
  }, []);
  // Favorites changed on the recipe list / another device.
  useDocumentEvent('cookbook:favorites-changed', state.reload);
  const [planFor, setPlanFor] = useState<RecipeSummary | null>(null);
  return (
    <Async state={state}>
      {(list) =>
        list.length === 0 ? (
          <Empty>
            Noch keine Favoriten — markiere Rezepte in der{' '}
            <Link to="/rezepte" className="text-orange-600 hover:underline dark:text-orange-400">
              Rezeptliste
            </Link>{' '}
            mit dem Stern.
          </Empty>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {list.slice(0, config.count).map((r) => (
                <RecipeTile
                  key={r.id}
                  r={r}
                  action={
                    <button type="button" className={btnSmall} onClick={() => setPlanFor(r)}>
                      Einplanen
                    </button>
                  }
                />
              ))}
            </div>
            {list.length > config.count && (
              <Link to="/rezepte" className="mt-2 inline-block text-xs text-orange-600 hover:underline dark:text-orange-400">
                Alle {list.length} Favoriten
              </Link>
            )}
            {planFor && <PlanDialog recipe={planFor} onClose={() => setPlanFor(null)} onPlanned={() => undefined} />}
          </>
        )
      }
    </Async>
  );
}

/* ------------------------------------------------------- Empfehlungen */

export function RecommendationsWidget({ config }: { config: WidgetConfigs['recommendations'] }) {
  const host = useDashboardData();
  const [shuffle, setShuffle] = useState(0);
  const [planFor, setPlanFor] = useState<{ id: string; title: string } | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const anyCriterion = Object.values(config.criteria).some(Boolean);
  const state = useLoad(async () => {
    const targetMealKcal = config.criteria.calorieGoal ? ((await loadGoal(host)).goal.targetKcal * config.mealShare) / 100 : 0;
    return host.recommendations({ criteria: config.criteria, targetMealKcal, count: config.count, seed: weekSeed(Date.now()) + shuffle });
  }, [JSON.stringify(config), shuffle]);
  return (
    <div>
      <Async state={state}>
        {(list) =>
          list.length === 0 ? (
            <Empty>Keine Vorschläge — alles schon geplant oder kürzlich gegessen.</Empty>
          ) : (
            <ul className="space-y-2">
              {list.map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <host.Link to={`/rezept/${r.id}`} className="flex min-w-0 flex-1 items-center gap-2 rounded p-1 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <RecipeThumb src={r.imageUrl} title={r.title} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">{r.title}</span>
                      <span className="block truncate text-xs text-gray-500">
                        {[r.kcal ? `${r.estimated ? '≈ ' : ''}${r.kcal} kcal` : '', ...r.reasons].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </host.Link>
                  <button type="button" className={`${btnSmall} flex-shrink-0`} onClick={() => setPlanFor(r)}>
                    Einplanen
                  </button>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={btnSecondary} onClick={() => setShuffle((s) => s + 1)}>
          Neu mischen
        </button>
        {config.aiPlan && (
          <button type="button" className="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-600" onClick={() => setAiOpen(true)}>
            KI-Wochenplan
          </button>
        )}
      </div>
      {!anyCriterion && <p className="mt-2 text-xs text-gray-500">Alle Kriterien sind aus — die Vorschläge sind zufällig.</p>}
      {planFor && <PlanDialog recipe={planFor} onClose={() => setPlanFor(null)} onPlanned={state.reload} />}
      {aiOpen && <AiPlanDialog config={config} onClose={() => setAiOpen(false)} onPlanned={state.reload} />}
    </div>
  );
}

function AiPlanDialog({ config, onClose, onPlanned }: { config: WidgetConfigs['recommendations']; onClose: () => void; onPlanned: () => void }) {
  const host = useDashboardData();
  const [startDate, setStartDate] = useState(localDateString(addDays(new Date(), 1)));
  const [days, setDays] = useState(7);
  const [result, setResult] = useState<{ note: string; plan: AiPlanEntry[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'plan' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy('plan');
    setError(null);
    try {
      const targetMealKcal = config.criteria.calorieGoal ? ((await loadGoal(host)).goal.targetKcal * config.mealShare) / 100 : 0;
      const r = await host.aiWeekPlan({ criteria: config.criteria, targetMealKcal, count: config.aiDishes, startDate, days });
      setResult(r);
      setSelected(new Set(r.plan.map((p) => p.recipeId)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!result) return;
    setBusy('save');
    setError(null);
    try {
      for (const p of result.plan.filter((p) => selected.has(p.recipeId))) {
        await host.createPlan({ recipeId: p.recipeId, scheduledAt: new Date(`${p.date}T00:00:00`).toISOString(), servings: p.servings });
      }
      onPlanned();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title="KI-Wochenplan"
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btnSecondary} onClick={onClose}>
            Schließen
          </button>
          {result && (
            <button type="button" className={btnPrimary} onClick={save} disabled={busy !== null || selected.size === 0}>
              {busy === 'save' ? 'Plane …' : `${selected.size} ${selected.size === 1 ? 'Gericht' : 'Gerichte'} einplanen`}
            </button>
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="block">
          Ab
          <input type="date" className={`mt-1 ${inputClass}`} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="block">
          Zeitraum
          <select className={`mt-1 ${inputClass}`} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 Tage</option>
            <option value={14}>14 Tage</option>
          </select>
        </label>
        <button type="button" className="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-50" onClick={generate} disabled={busy !== null}>
          {busy === 'plan' ? 'KI plant …' : result ? 'Neu planen' : 'Plan erstellen'}
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        {config.aiDishes} Gerichte als Meal Prep, ausgewählt aus deinen Rezepten nach den Kriterien dieses Widgets. Nutzt das Strukturierungs-Modell aus den KI-Einstellungen (nur online).
      </p>
      {error && <ErrorText>{error}</ErrorText>}
      {result && (
        <div className="mt-4">
          {result.note && <p className="mb-3 rounded bg-indigo-50 p-2 text-sm text-indigo-900 dark:bg-indigo-900/30 dark:text-indigo-100">{result.note}</p>}
          <ul className="space-y-2">
            {result.plan.map((p) => (
              <li key={p.recipeId} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-3 h-4 w-4 accent-orange-500"
                  checked={selected.has(p.recipeId)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(p.recipeId);
                    else next.delete(p.recipeId);
                    setSelected(next);
                  }}
                  aria-label={`${p.title} einplanen`}
                />
                <RecipeThumb src={p.imageUrl} title={p.title} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">{p.title}</div>
                  <div className="text-xs text-gray-500">
                    {weekdayLabel(new Date(`${p.date}T12:00:00`))} · {formatPortions(p.servings)} Portionen{p.kcal ? ` · ${p.kcal} kcal/Portion` : ''}
                  </div>
                  {p.reason && <div className="text-xs text-gray-600 dark:text-gray-300">{p.reason}</div>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

/* --------------------------------------------------- Geplante Gerichte */

export function PlannedWidget({ config }: { config: WidgetConfigs['planned'] }) {
  const host = useDashboardData();
  const { Link } = host;
  const [busy, setBusy] = useState(false);
  const state = useLoad(async () => {
    const today = startOfDay(new Date());
    const [upcoming, open] = await Promise.all([
      host.plans(today.toISOString(), endOfDay(addDays(today, config.days - 1)).toISOString()),
      config.showOpen ? host.activePlans(endOfDay(new Date()).toISOString()) : Promise.resolve([] as MealPlan[])
    ]);
    const upcomingIds = new Set(upcoming.map((p) => p.id));
    return {
      upcoming: upcoming.filter((p) => p.status !== 'skipped').sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()),
      open: open.filter((p) => !upcomingIds.has(p.id))
    };
  }, [config.days, config.showOpen]);

  const remove = async (plan: MealPlan) => {
    if (!confirm(`„${plan.recipeTitle || 'Rezept'}“ aus dem Plan entfernen?`)) return;
    await host.deletePlan(plan.id);
    state.reload();
  };

  const toList = async (plans: MealPlan[]) => {
    setBusy(true);
    try {
      const id = await host.createListFromRecipes(
        `Wochenplan ${new Date().toLocaleDateString('de-DE')}`,
        plans.map((p) => ({ recipeId: p.recipeId, servings: Number(p.servings) || 1 }))
      );
      host.navigate(`/einkaufsliste/${id}`);
    } catch (e) {
      alert(`Einkaufsliste konnte nicht erstellt werden: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Async state={state}>
      {({ upcoming, open }) => (
        <div>
          {upcoming.length === 0 && open.length === 0 && (
            <Empty>
              Nichts geplant. Plane Gerichte über „Einplanen“ in den Empfehlungen/Favoriten oder auf der Rezeptseite.
            </Empty>
          )}
          {upcoming.length > 0 && (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {upcoming.map((p) => (
                <li key={p.id} className="flex items-center gap-2 py-1.5">
                  <span className="w-20 flex-shrink-0 text-xs font-medium text-orange-600 dark:text-orange-400">{weekdayLabel(new Date(p.scheduledAt))}</span>
                  <Link to={`/rezept/${p.recipeId}`} className="min-w-0 flex-1 truncate text-sm text-gray-900 hover:underline dark:text-white">
                    {p.recipeTitle || 'Rezept'}
                  </Link>
                  <span className="flex-shrink-0 text-xs text-gray-500">{formatPortions(Number(p.servings))} Port.</span>
                  <button type="button" onClick={() => remove(p)} className="flex-shrink-0 rounded p-1 text-gray-400 hover:text-red-500" title="Aus dem Plan entfernen" aria-label="Aus dem Plan entfernen">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {open.length > 0 && (
            <div className="mt-3">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Schon gekocht, noch offen</h4>
              <ul className="space-y-1">
                {open.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link to={`/rezept/${p.recipeId}`} className="min-w-0 truncate text-gray-800 hover:underline dark:text-gray-200">
                      {p.recipeTitle || 'Rezept'}
                    </Link>
                    <span className="flex-shrink-0 text-xs text-gray-500">noch {formatPortions(Number(p.servingsRemaining))} Port.</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {upcoming.length > 0 && (
            <button type="button" className={`${btnSecondary} mt-3`} onClick={() => toList(upcoming)} disabled={busy}>
              {busy ? 'Erstelle Liste …' : 'Einkaufsliste für den Plan'}
            </button>
          )}
        </div>
      )}
    </Async>
  );
}

/* ------------------------------------------------------ Zufallsrezept */

export function RandomRecipeWidget({ config }: { config: WidgetConfigs['random-recipe'] }) {
  const host = useDashboardData();
  const [roll, setRoll] = useState(() => Math.random());
  const [planFor, setPlanFor] = useState<RecipeSummary | null>(null);
  const state = useLoad(() => host.recipes(), []);
  return (
    <Async state={state}>
      {(all) => {
        const pool = config.category ? all.filter((r) => r.category === config.category) : all;
        if (pool.length === 0) return <Empty>Keine Rezepte{config.category ? ` in „${config.category}“` : ''}.</Empty>;
        const r = pool[Math.floor(roll * pool.length) % pool.length];
        return (
          <div>
            <host.Link to={`/rezept/${r.id}`} className="block overflow-hidden rounded-lg">
              <RecipeThumb src={r.imageUrl} title={r.title} className="h-36 w-full !rounded-lg" />
            </host.Link>
            <host.Link to={`/rezept/${r.id}`} className="mt-2 block text-base font-semibold text-gray-900 hover:underline dark:text-white">
              {r.title}
            </host.Link>
            {r.category && <p className="text-xs text-gray-500">{r.category}</p>}
            <div className="mt-2 flex gap-2">
              <button type="button" className={btnSecondary} onClick={() => setRoll(Math.random())}>
                Nochmal würfeln
              </button>
              <button type="button" className={btnSmall} onClick={() => setPlanFor(r)}>
                Einplanen
              </button>
            </div>
            {planFor && <PlanDialog recipe={planFor} onClose={() => setPlanFor(null)} onPlanned={() => undefined} />}
          </div>
        );
      }}
    </Async>
  );
}

/* -------------------------------------------------- Neu im Kochbuch */

export function RecentRecipesWidget({ config }: { config: WidgetConfigs['recent-recipes'] }) {
  const host = useDashboardData();
  const state = useLoad(() => host.recipes(), []);
  return (
    <Async state={state}>
      {(all) => {
        const list = [...all].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, config.count);
        if (list.length === 0) return <Empty>Noch keine Rezepte.</Empty>;
        return (
          <ul className="space-y-1">
            {list.map((r) => (
              <li key={r.id}>
                <host.Link to={`/rezept/${r.id}`} className="flex items-center gap-2 rounded p-1 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <RecipeThumb src={r.imageUrl} title={r.title} className="h-10 w-10" />
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-white">{r.title}</span>
                  <span className="flex-shrink-0 text-xs text-gray-400">{new Date(r.createdAt).toLocaleDateString('de-DE')}</span>
                </host.Link>
              </li>
            ))}
          </ul>
        );
      }}
    </Async>
  );
}

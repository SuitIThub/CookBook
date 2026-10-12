/** Tracker widgets: day balance, today's log, week balance, weight, meal prep, goal, budget suggestions. */
import { useState } from 'react';
import { addNutrition, bmiCategoryLabel, calculateBmi, computeWeightTrend } from '../../lib/calorieGoal';
import type { NutritionData } from '../../types/recipe';
import type { MealPlan } from '../../types/tracker';
import { useDashboardData } from '../data';
import type { WidgetConfigs } from '../model';
import { invalidateGoal, loadGoal } from '../trackerGoal';
import { addDays, Async, Bar, btnPrimary, Empty, endOfDay, formatPortions, inputClass, RecipeThumb, Ring, startOfDay, useLoad } from '../ui';

function kcal(n: NutritionData | undefined): number {
  return Number(n?.calories) || 0;
}

function NoProfileHint() {
  const { Link } = useDashboardData();
  return (
    <p className="mt-2 text-xs text-gray-500">
      Ziel geschätzt —{' '}
      <Link to="/tracker" className="text-orange-600 hover:underline dark:text-orange-400">
        Körperprofil im Tracker ausfüllen
      </Link>
      .
    </p>
  );
}

/* ------------------------------------------------------------ Tagesbilanz */

export function TrackerDayWidget() {
  const host = useDashboardData();
  const state = useLoad(async () => {
    const now = new Date();
    const [info, entries] = await Promise.all([loadGoal(host), host.diary(startOfDay(now).toISOString(), endOfDay(now).toISOString())]);
    const total = entries.reduce((sum, e) => addNutrition(sum, e.nutrition), {} as NutritionData);
    return { ...info, total, count: entries.length };
  }, []);
  return (
    <Async state={state}>
      {({ goal, total, count, profileComplete }) => {
        const eaten = kcal(total);
        const left = Math.round(goal.targetKcal - eaten);
        return (
          <div>
            <div className="flex items-center gap-4">
              <Ring value={eaten} max={goal.targetKcal} label={`${Math.round(eaten)}`} sub={`von ${goal.targetKcal} kcal`} />
              <div className="min-w-0 flex-1 space-y-2">
                <Bar label="Eiweiß" value={Number(total.protein) || 0} max={goal.targetProteinG} colorClass="bg-sky-500" />
                <Bar label="Kohlenhydrate" value={Number(total.carbohydrates) || 0} max={goal.targetCarbsG} colorClass="bg-amber-500" />
                <Bar label="Fett" value={Number(total.fat) || 0} max={goal.targetFatG} colorClass="bg-rose-500" />
              </div>
            </div>
            <p className={`mt-3 text-sm ${left < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'}`}>
              {left >= 0 ? `Noch ${left} kcal frei` : `${-left} kcal über dem Ziel`} · {count} {count === 1 ? 'Eintrag' : 'Einträge'}
            </p>
            {!profileComplete && <NoProfileHint />}
          </div>
        );
      }}
    </Async>
  );
}

/* ---------------------------------------------------------- Heute gegessen */

export function TrackerLogWidget() {
  const host = useDashboardData();
  const { Link } = host;
  const state = useLoad(() => {
    const now = new Date();
    return host.diary(startOfDay(now).toISOString(), endOfDay(now).toISOString());
  }, []);
  return (
    <Async state={state}>
      {(entries) =>
        entries.length === 0 ? (
          <Empty>
            Heute noch nichts eingetragen.{' '}
            <Link to="/tracker" className="text-orange-600 hover:underline dark:text-orange-400">
              Zum Tracker
            </Link>
          </Empty>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm dark:divide-gray-700">
            {[...entries]
              .sort((a, b) => new Date(a.eatenAt).getTime() - new Date(b.eatenAt).getTime())
              .map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate text-gray-800 dark:text-gray-200">
                    <span className="mr-2 text-xs text-gray-400">{new Date(e.eatenAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
                    {e.recipeTitle || e.productName || e.label || 'Eintrag'}
                    {e.servings ? <span className="text-gray-400"> · {formatPortions(e.servings)} Port.</span> : e.grams ? <span className="text-gray-400"> · {Math.round(e.grams)} g</span> : null}
                  </span>
                  <span className="flex-shrink-0 text-xs text-gray-500">{Math.round(kcal(e.nutrition))} kcal</span>
                </li>
              ))}
          </ul>
        )
      }
    </Async>
  );
}

/* ----------------------------------------------------------- Wochenbilanz */

export function TrackerWeekWidget({ config }: { config: WidgetConfigs['tracker-week'] }) {
  const host = useDashboardData();
  const days = config.days;
  const state = useLoad(async () => {
    const today = startOfDay(new Date());
    const from = addDays(today, -(days - 1));
    const [info, entries] = await Promise.all([loadGoal(host), host.diary(from.toISOString(), endOfDay(today).toISOString())]);
    const sums = Array.from({ length: days }, (_, i) => ({ day: addDays(from, i), kcal: 0, entries: 0 }));
    for (const e of entries) {
      const idx = Math.round((startOfDay(new Date(e.eatenAt)).getTime() - from.getTime()) / 86_400_000);
      if (idx >= 0 && idx < days) {
        sums[idx].kcal += kcal(e.nutrition);
        sums[idx].entries++;
      }
    }
    return { target: info.goal.targetKcal, sums };
  }, [days]);
  return (
    <Async state={state}>
      {({ target, sums }) => {
        const tracked = sums.filter((s) => s.entries > 0);
        const avg = tracked.length ? Math.round(tracked.reduce((a, s) => a + s.kcal, 0) / tracked.length) : 0;
        const max = Math.max(target * 1.25, ...sums.map((s) => s.kcal), 1);
        return (
          <div>
            <div className="relative flex h-32 items-end gap-1">
              {target > 0 && (
                <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-orange-400" style={{ bottom: `${(target / max) * 100}%` }} title={`Ziel ${target} kcal`} />
              )}
              {sums.map((s) => {
                const over = target > 0 && s.kcal > target * 1.05;
                return (
                  <div key={s.day.getTime()} className="flex h-full flex-1 flex-col justify-end" title={`${s.day.toLocaleDateString('de-DE')}: ${Math.round(s.kcal)} kcal`}>
                    <div className={`w-full rounded-t ${s.entries === 0 ? 'bg-gray-200 dark:bg-gray-700' : over ? 'bg-red-400' : 'bg-orange-400'}`} style={{ height: `${Math.max(2, (s.kcal / max) * 100)}%` }} />
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex gap-1 text-center text-[10px] text-gray-400">
              {sums.map((s) => (
                <span key={s.day.getTime()} className="flex-1 truncate">
                  {s.day.toLocaleDateString('de-DE', days > 7 ? { day: 'numeric' } : { weekday: 'short' })}
                </span>
              ))}
            </div>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              {tracked.length ? `Ø ${avg} kcal an ${tracked.length} erfassten Tagen` : 'Noch keine Einträge in diesem Zeitraum'}
              {target > 0 && ` · Ziel ${target} kcal`}
            </p>
          </div>
        );
      }}
    </Async>
  );
}

/* ----------------------------------------------------------------- Gewicht */

export function TrackerWeightWidget({ config }: { config: WidgetConfigs['tracker-weight'] }) {
  const host = useDashboardData();
  const state = useLoad(() => host.weightLogs(), []);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const kg = Number(value.replace(',', '.'));
    if (!(kg > 20 && kg < 400)) return;
    setBusy(true);
    try {
      const at = new Date();
      at.setHours(12, 0, 0, 0);
      await host.addWeight(kg, at.toISOString());
      invalidateGoal(host);
      setValue('');
      state.reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Async state={state}>
      {(logs) => {
        const profile = host.profile();
        const latest = logs[0];
        const since = Date.now() - config.days * 86_400_000;
        const points = logs.filter((l) => new Date(l.loggedAt).getTime() >= since).reverse();
        const trend = computeWeightTrend(logs, { windowDays: 28 });
        const weekly = trend.count >= 2 ? trend.slopeKgPerDay * 7 : null;
        const bmi = latest && profile.heightCm ? calculateBmi(latest.weightKg, profile.heightCm) : null;
        return (
          <div>
            {latest ? (
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <span className="text-2xl font-bold text-gray-900 dark:text-white">{latest.weightKg.toLocaleString('de-DE', { maximumFractionDigits: 1 })} kg</span>
                  <span className="ml-2 text-xs text-gray-500">{new Date(latest.loggedAt).toLocaleDateString('de-DE')}</span>
                </div>
                {weekly != null && (
                  <span className={`text-sm ${weekly < -0.05 ? 'text-emerald-600' : weekly > 0.05 ? 'text-amber-600' : 'text-gray-500'}`}>
                    {weekly > 0 ? '▲' : weekly < 0 ? '▼' : '■'} {Math.abs(weekly).toLocaleString('de-DE', { maximumFractionDigits: 2 })} kg/Woche
                  </span>
                )}
              </div>
            ) : (
              <Empty>Noch kein Gewicht eingetragen.</Empty>
            )}
            {bmi && <p className="text-xs text-gray-500">BMI {bmi.toLocaleString('de-DE')} · {bmiCategoryLabel(bmi)}{profile.targetWeightKg ? ` · Ziel ${profile.targetWeightKg} kg` : ''}</p>}
            {points.length >= 2 && <Sparkline values={points.map((p) => p.weightKg)} target={profile.targetWeightKg} />}
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <input className={inputClass} inputMode="decimal" placeholder="Gewicht heute (kg)" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Gewicht in kg" />
              <button type="submit" className={btnPrimary} disabled={busy || !value.trim()}>
                Eintragen
              </button>
            </form>
          </div>
        );
      }}
    </Async>
  );
}

function Sparkline({ values, target }: { values: number[]; target?: number }) {
  const w = 300;
  const h = 60;
  const all = target ? [...values, target] : values;
  const min = Math.min(...all) - 0.5;
  const max = Math.max(...all) + 0.5;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / (max - min)) * h;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-16 w-full" preserveAspectRatio="none" aria-hidden="true">
      {target && <line x1={0} x2={w} y1={y(target)} y2={y(target)} className="stroke-emerald-500" strokeDasharray="4 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      <path d={d} className="fill-none stroke-orange-500" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* --------------------------------------------------------------- Meal Prep */

export function TrackerMealPrepWidget() {
  const host = useDashboardData();
  const { Link } = host;
  const state = useLoad(() => host.activePlans(endOfDay(new Date()).toISOString()), []);
  const [busy, setBusy] = useState<string | null>(null);
  const eat = async (plan: MealPlan) => {
    setBusy(plan.id);
    try {
      await host.eatPortions(plan, Math.min(1, Number(plan.servingsRemaining)));
      invalidateGoal(host);
      state.reload();
    } catch (e) {
      alert(`Abstreichen fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Async state={state}>
      {(plans) =>
        plans.length === 0 ? (
          <Empty>Keine offenen Portionen.</Empty>
        ) : (
          <ul className="space-y-2">
            {plans.map((p) => {
              const total = Number(p.servings) || 1;
              const remaining = Number(p.servingsRemaining ?? total);
              return (
                <li key={p.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <Link to={`/rezept/${p.recipeId}`} className="block truncate text-sm font-medium text-gray-900 hover:underline dark:text-white">
                      {p.recipeTitle || 'Rezept'}
                    </Link>
                    <div className="text-xs text-gray-500">
                      noch {formatPortions(remaining)} von {formatPortions(total)} Portionen
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
                      <div className="h-full bg-emerald-500" style={{ width: `${Math.round(((total - remaining) / total) * 100)}%` }} />
                    </div>
                  </div>
                  <button type="button" onClick={() => eat(p)} disabled={busy === p.id} className="flex-shrink-0 rounded bg-emerald-500 px-2 py-1 text-xs text-white hover:bg-emerald-600 disabled:opacity-50">
                    1 Portion abstreichen
                  </button>
                </li>
              );
            })}
          </ul>
        )
      }
    </Async>
  );
}

/* ------------------------------------------------------------ Ziel & Körper */

export function TrackerGoalWidget() {
  const host = useDashboardData();
  const state = useLoad(() => loadGoal(host), []);
  return (
    <Async state={state}>
      {({ goal, weightLogs, profileComplete }) => {
        const profile = host.profile();
        const current = weightLogs[0]?.weightKg;
        const bmi = current && profile.heightCm ? calculateBmi(current, profile.heightCm) : null;
        const toTarget = current && profile.targetWeightKg ? current - profile.targetWeightKg : null;
        const weekly = profile.weeklyChangeKg ?? 0;
        const weeks = toTarget && weekly && Math.sign(-toTarget) === Math.sign(weekly) ? Math.ceil(Math.abs(toTarget / weekly)) : null;
        return (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-gray-500">Tagesziel</dt>
              <dd className="font-semibold text-gray-900 dark:text-white">{goal.targetKcal} kcal</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Grundumsatz</dt>
              <dd className="text-gray-800 dark:text-gray-200">
                {Math.round(goal.tdee)} kcal <span className="text-xs text-gray-400">({goal.tdeeSource === 'learned' ? 'gelernt' : 'Formel'})</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Eiweiß-Ziel</dt>
              <dd className="text-gray-800 dark:text-gray-200">{Math.round(goal.targetProteinG)} g</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">BMI</dt>
              <dd className="text-gray-800 dark:text-gray-200">{bmi ? `${bmi.toLocaleString('de-DE')} · ${bmiCategoryLabel(bmi)}` : '–'}</dd>
            </div>
            {toTarget != null && (
              <div className="col-span-2">
                <dt className="text-xs text-gray-500">Bis zum Zielgewicht ({profile.targetWeightKg} kg)</dt>
                <dd className="text-gray-800 dark:text-gray-200">
                  {Math.abs(toTarget) < 0.1 ? 'Ziel erreicht 🎉' : `${Math.abs(toTarget).toLocaleString('de-DE', { maximumFractionDigits: 1 })} kg ${toTarget > 0 ? 'abnehmen' : 'zunehmen'}`}
                  {weeks ? ` · ca. ${weeks} Wochen` : ''}
                </dd>
              </div>
            )}
            {!profileComplete && (
              <div className="col-span-2">
                <NoProfileHint />
              </div>
            )}
          </dl>
        );
      }}
    </Async>
  );
}

/* -------------------------------------------------------- Budget-Vorschläge */

export function TrackerSuggestionsWidget({ config }: { config: WidgetConfigs['tracker-suggestions'] }) {
  const host = useDashboardData();
  const { Link } = host;
  const state = useLoad(async () => {
    const now = new Date();
    const [info, entries] = await Promise.all([loadGoal(host), host.diary(startOfDay(now).toISOString(), endOfDay(now).toISOString())]);
    const total = entries.reduce((sum, e) => addNutrition(sum, e.nutrition), {} as NutritionData);
    const leftKcal = Math.round(info.goal.targetKcal - kcal(total));
    const leftProtein = Math.round(info.goal.targetProteinG - (Number(total.protein) || 0));
    if (leftKcal < 200) return { leftKcal, list: [] };
    return { leftKcal, list: await host.budgetSuggestions(leftKcal, leftProtein > 0 ? leftProtein : undefined, config.count) };
  }, [config.count]);
  return (
    <Async state={state}>
      {({ leftKcal, list }) => (
        <div>
          <p className="mb-2 text-xs text-gray-500">{leftKcal >= 200 ? `Für die restlichen ${leftKcal} kcal von heute:` : 'Das Tagesbudget ist (fast) aufgebraucht.'}</p>
          {leftKcal >= 200 && list.length === 0 && <Empty>Kein Rezept passt gerade ins Budget.</Empty>}
          <ul className="space-y-2">
            {list.map((s) => (
              <li key={s.id}>
                <Link to={`/rezept/${s.id}`} className="flex items-center gap-2 rounded p-1 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <RecipeThumb src={s.imageUrl} title={s.title} className="h-10 w-10" />
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-white">{s.title}</span>
                  <span className="flex-shrink-0 text-xs text-gray-500">
                    {s.estimated ? '≈ ' : ''}
                    {s.kcal} kcal · {s.protein} g EW
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Async>
  );
}


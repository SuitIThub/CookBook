/**
 * Port of components/recipe/details/LiveNutritionPanel.astro — computed
 * on-device (lib/localNutrition.computeLivePanel) instead of via the server's
 * live-nutrition endpoint, so it works offline. Product choices per ingredient
 * and the supermarket are remembered as the alias' defaults (synced).
 */
import { useEffect, useState } from 'react';
import type { Recipe } from '@/types';
import { NUTRITION_FIELDS } from '@core/nutrition';
import { getIngredientDefault, setIngredientDefault, readIngredientDefaults, writeIngredientDefaults, readPreferredSupermarket, writePreferredSupermarket } from '@core/ingredientDefaults';
import { computeLivePanel, type LivePanelResult } from '@/lib/localNutrition';
import { apiPost } from '@/lib/api';
import { getAlias } from '@/lib/settings';

const euro = (v: number, est: boolean) => {
  const s = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(v);
  return est ? `~${s}` : s;
};

export default function LiveNutritionPanel({ recipe, onOpenCatalogue, refreshKey = 0 }: { recipe: Recipe; onOpenCatalogue: (name: string) => void; refreshKey?: number }) {
  const [data, setData] = useState<LivePanelResult | null>(null);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [market, setMarket] = useState(readPreferredSupermarket());
  const [planWhen, setPlanWhen] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  });
  const [planServings, setPlanServings] = useState(String(recipe.metadata.servings));
  const [planStatus, setPlanStatus] = useState('');

  const recompute = async (opts: { assignments?: Record<string, string>; applySupermarket?: boolean; saveDefaults?: boolean; supermarketId?: string } = {}) => {
    const r = await computeLivePanel(recipe, {
      productAssignments: opts.assignments ?? assignments,
      supermarketId: (opts.supermarketId ?? market) || undefined,
      applySupermarket: opts.applySupermarket
    });
    setData(r);
    setAssignments(r.productAssignments);
    if (opts.saveDefaults) {
      const map: Record<string, string> = {};
      for (const ing of r.ingredients) if (ing.catalogueId) map[ing.catalogueId] = r.productAssignments[ing.id] ?? '';
      writeIngredientDefaults({ ...readIngredientDefaults(), ...map });
    }
  };

  // Initial: catalogue defaults overridden by the alias' own product choices.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const first = await computeLivePanel(recipe, { supermarketId: market || undefined });
      const initial: Record<string, string> = { ...first.productAssignments };
      for (const ing of first.ingredients) {
        if (!ing.catalogueId) continue;
        const next = getIngredientDefault(ing.catalogueId, ing.defaultProductId || '');
        if (next === '' || ing.products.some((p) => p.id === next)) initial[ing.id] = next;
      }
      if (cancelled) return;
      await recompute({ assignments: initial });
    })();
    return () => {
      cancelled = true;
    };
  }, [recipe.id, recipe.updatedAt, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Alias defaults changed on another device.
  useEffect(() => {
    const h = () => {
      setMarket(readPreferredSupermarket());
      if (!data) return;
      const next = { ...assignments };
      for (const ing of data.ingredients) if (ing.catalogueId) next[ing.id] = getIngredientDefault(ing.catalogueId, ing.defaultProductId || '');
      void recompute({ assignments: next, supermarketId: readPreferredSupermarket() });
    };
    document.addEventListener('cookbook:ingredient-defaults-changed', h);
    return () => document.removeEventListener('cookbook:ingredient-defaults-changed', h);
  });

  if (!data || data.ingredients.length === 0) return null;
  const n = data.nutrition;

  const chooseProduct = (ingId: string, catalogueId: string | undefined, productId: string) => {
    const next = { ...assignments, [ingId]: productId };
    if (catalogueId) {
      for (const ing of data.ingredients) if (ing.catalogueId === catalogueId && (productId === '' || ing.products.some((p) => p.id === productId))) next[ing.id] = productId;
      setIngredientDefault(catalogueId, productId);
    }
    void recompute({ assignments: next });
  };

  const plan = async (e: React.FormEvent) => {
    e.preventDefault();
    const alias = getAlias();
    if (!alias) {
      setPlanStatus('Bitte zuerst einen Alias in den Einstellungen einrichten.');
      return;
    }
    const when = planWhen ? new Date(`${planWhen}T12:00:00`) : new Date();
    try {
      await apiPost('/api/tracker/meal-plans', {
        alias,
        recipeId: recipe.id,
        scheduledAt: when.toISOString(),
        servings: Number(planServings) || recipe.metadata.servings,
        supermarketId: market || undefined,
        productAssignments: assignments
      });
      setPlanStatus('Meal Prep gespeichert — Portionen können ab diesem Tag im Tracker abgestrichen werden.');
    } catch {
      setPlanStatus('Speichern fehlgeschlagen.');
    }
  };

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">Nährwerte &amp; Preis (live berechnet)</h3>
        {data.supermarkets.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            Supermarkt:
            <select
              value={market}
              onChange={(e) => {
                setMarket(e.target.value);
                writePreferredSupermarket(e.target.value);
                void recompute({ applySupermarket: true, saveDefaults: true, supermarketId: e.target.value });
              }}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900"
            >
              <option value="">Standardpreis</option>
              {data.supermarkets.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {NUTRITION_FIELDS.filter((f) => f.group === 'primary').map((f) => {
          const v = (n.perServing as Record<string, number | undefined>)[f.key];
          return (
            <div key={f.key} className="text-center">
              <div className={`font-bold ${f.valueClass}`}>
                {v != null ? `${n.isEstimated ? '~' : ''}${f.key === 'calories' ? Math.round(v) : Math.round(v * 10) / 10}${f.key === 'calories' ? '' : f.unit}` : '–'}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">{f.label}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-gray-700 dark:text-gray-200">
        <div>
          Preis pro Rezept: <span className="font-semibold">{data.price.hasAnyData ? euro(data.price.perRecipe, data.price.isEstimated) : '–'}</span>
        </div>
        <div>
          Preis pro Portion: <span className="font-semibold">{data.price.hasAnyData ? euro(data.price.perServing, data.price.isEstimated) : '–'}</span>
        </div>
        {n.incomplete.length > 0 && <div className="text-xs text-yellow-700 dark:text-yellow-300">{n.incomplete.length} Zutat(en) ohne Nährwerte</div>}
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-200">Produkt pro Zutat (optional)</summary>
        <div className="mt-2 space-y-2">
          {data.ingredients.map((ing) => {
            const has = ing.products.length > 0;
            return (
              <div key={ing.id} className="live-product-row text-sm">
                <span className="live-product-name cursor-pointer font-medium text-gray-800 hover:underline dark:text-gray-100" onClick={() => onOpenCatalogue(ing.name)} title="Zutat im Register öffnen">
                  {ing.name}
                </span>
                <div className="live-product-slot min-w-0">
                  {has ? (
                    <select
                      value={assignments[ing.id] ?? ''}
                      onChange={(e) => chooseProduct(ing.id, ing.catalogueId, e.target.value)}
                      className="live-product-select rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
                    >
                      <option value="">Kein Produkt</option>
                      {ing.products.map((p) => (
                        <option key={p.id} value={p.id}>{p.brand ? `${p.brand} – ${p.name}` : p.name}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-gray-500 dark:text-gray-400">kein Produkt hinterlegt</span>
                  )}
                </div>
                <button type="button" onClick={() => onOpenCatalogue(ing.name)} className="live-link-product rounded border border-emerald-500 px-2 py-1.5 text-center text-xs text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/30" title="Produkte für diese Zutat verwalten">
                  {has ? '+ / verwalten' : '+ Produkt verknüpfen'}
                </button>
              </div>
            );
          })}
        </div>
      </details>
      {n.incomplete.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-gray-500 hover:text-gray-700 dark:text-gray-400">Warum sind Nährwerte unvollständig?</summary>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-gray-600 dark:text-gray-300">
            {n.incomplete.map((r) => (
              <li key={r.id}>{r.name}{r.reason ? ` – ${r.reason}` : ''}</li>
            ))}
          </ul>
        </details>
      )}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium text-orange-600 dark:text-orange-400">Als Meal Prep planen</summary>
        <form onSubmit={plan} className="mt-2 grid grid-cols-1 items-end gap-2 text-sm sm:grid-cols-4">
          <label className="block sm:col-span-2">
            Verfügbar ab
            <input type="date" value={planWhen} onChange={(e) => setPlanWhen(e.target.value)} required className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-900" />
          </label>
          <label className="block">
            Zubereitete Portionen
            <input type="number" step="0.5" min="0.5" value={planServings} onChange={(e) => setPlanServings(e.target.value)} required className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-900" />
          </label>
          <div className="flex justify-end">
            <button type="submit" className="w-full rounded bg-orange-500 px-3 py-1.5 text-sm text-white hover:bg-orange-600 sm:w-auto">Planen</button>
          </div>
          <p className="text-[11px] text-gray-500 sm:col-span-4">Die Portionen stehen ab diesem Tag bereit und werden im Tracker über mehrere Tage abgestrichen — nicht alle an einem Tag gegessen.</p>
          <div className="text-xs text-gray-500 sm:col-span-4">{planStatus}</div>
        </form>
      </details>
    </div>
  );
}

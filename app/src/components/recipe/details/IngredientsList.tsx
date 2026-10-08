/**
 * Port of components/recipe/details/IngredientsList.astro + IngredientNode.astro:
 * groups (titled/untitled, nested), alternative selects (only visible options,
 * cascading via resolveSelection), visibleWhen dependencies, per-ingredient
 * catalogue button and portion scaling.
 */
import type { Recipe, Ingredient, IngredientGroup } from '@/types';
import { formatQuantity } from '@core/units';
import {
  getAlternativeGroups,
  getOptionToGroupMap,
  getAlternativeOptionMeta,
  isNodeVisible,
  isVisibleWhenSatisfied,
  type AlternativeSelection
} from '@core/alternatives';

/** Website rounding for scaled amounts. */
export function roundScaled(n: number): number {
  if (n < 1) return Math.round(n * 100) / 100;
  if (n < 10) return Math.round(n * 10) / 10;
  return Math.round(n);
}

export function displayQuantity(amount: number, unit: string, scale: number): { amount: string; unit: string } {
  const scaled = amount * scale;
  if (!unit || unit.trim() === '') return { amount: String(roundScaled(scaled)), unit: '' };
  const f = formatQuantity(scaled, unit);
  return { amount: String(scale === 1 ? f.amount : roundScaled(f.amount)), unit: f.unit };
}

const isGroup = (x: Ingredient | IngredientGroup): x is IngredientGroup => Array.isArray((x as IngredientGroup).ingredients);

function hasAnyIngredients(groups: IngredientGroup[]): boolean {
  return groups.some((g) => (g?.ingredients ?? []).some((it) => (isGroup(it) ? hasAnyIngredients([it]) : !!(it as Ingredient).name)));
}

export default function IngredientsList({
  recipe,
  selection,
  scale,
  onSelect,
  onCatalogue
}: {
  recipe: Recipe;
  selection: AlternativeSelection;
  scale: number;
  onSelect: (groupId: string, optionId: string) => void;
  onCatalogue: (name: string) => void;
}) {
  const groups = recipe.ingredientGroups ?? [];
  const altGroups = getAlternativeGroups(recipe);
  const optionToGroup = getOptionToGroupMap(recipe);
  const optionMeta = getAlternativeOptionMeta(recipe);

  const optionLabel = (id: string, fallback: string) => {
    const m = optionMeta.get(id);
    const desc = m?.description?.trim();
    return desc ? `${m?.name ?? fallback} (${desc})` : m?.name ?? fallback;
  };

  const renderNode = (item: Ingredient | IngredientGroup, key: string) => {
    if (isGroup(item)) {
      if (!isVisibleWhenSatisfied(item.visibleWhen, selection, optionToGroup)) return null;
      return (
        <li key={key} className="recipe-ing-node py-2">
          {item.title && <h4 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">{item.title}</h4>}
          <ul className="ml-4 space-y-2">{(item.ingredients ?? []).map((c, i) => renderNode(c, `${key}-${c.id || i}`))}</ul>
        </li>
      );
    }
    const ing = item as Ingredient;
    if (!isNodeVisible(ing, selection, optionToGroup)) return null;
    const alt = ing.alternativeGroupId ? altGroups.get(ing.alternativeGroupId) : undefined;
    const visibleOptions = alt ? alt.options.filter((o) => isVisibleWhenSatisfied(optionMeta.get(o.id)?.visibleWhen, selection, optionToGroup)) : [];
    return (
      <li key={key} className="recipe-ingredient-row flex items-center justify-between rounded-md px-3 py-2 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-gray-900 dark:text-white">{ing.name}</span>
            <button
              type="button"
              onClick={() => onCatalogue(ing.name)}
              className="rounded p-1 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
              title="Zutat im Register öffnen"
              aria-label={`Registerdaten für ${ing.name}`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M4 12h10M4 17h7" /></svg>
            </button>
            {alt && visibleOptions.length > 1 && (
              <select
                value={selection[alt.id] ?? ''}
                onChange={(e) => onSelect(alt.id, e.target.value)}
                title="Alternative wählen"
                className="alternative-select rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
              >
                {visibleOptions.map((o) => (
                  <option key={o.id} value={o.id}>{optionLabel(o.id, o.name)}</option>
                ))}
              </select>
            )}
          </div>
          {ing.description && <div className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">{ing.description}</div>}
        </div>
        <div className="flex space-x-2">
          {(ing.quantities ?? []).map((q, i) => {
            if (!(q.amount > 0 || (q.unit && q.unit.trim() !== ''))) return null;
            const d = displayQuantity(q.amount, q.unit, scale);
            return (
              <span key={i} className="ingredient-amount rounded bg-gray-100 px-2 py-1 text-sm text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                {q.amount > 0 ? <span className="amount-value">{d.amount}</span> : null} {d.unit}
              </span>
            );
          })}
        </div>
      </li>
    );
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm transition-colors duration-200 dark:border-gray-700 dark:bg-gray-800">
      <div className="p-6">
        <h2 className="mb-4 flex items-center text-2xl font-bold text-gray-900 dark:text-white">
          <svg className="mr-2 h-6 w-6 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
            <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
          </svg>
          Zutaten
        </h2>
        {!hasAnyIngredients(groups) ? (
          <div className="italic text-gray-500 dark:text-gray-400">Keine Zutaten gefunden - bitte manuell hinzufügen.</div>
        ) : (
          <div className="space-y-4">
            {groups
              .filter((g) => g && !g.title)
              .map((g, gi) =>
                isVisibleWhenSatisfied(g.visibleWhen, selection, optionToGroup) ? (
                  <ul key={g.id || `u${gi}`} className="recipe-ing-node space-y-2">
                    {(g.ingredients ?? []).map((it, i) => renderNode(it, `${g.id || gi}-${it.id || i}`))}
                  </ul>
                ) : null
              )}
            {groups
              .filter((g) => g && g.title)
              .map((g, gi) =>
                isVisibleWhenSatisfied(g.visibleWhen, selection, optionToGroup) ? (
                  <div key={g.id || `t${gi}`} className="recipe-ing-node">
                    <h3 className="mb-2 border-b border-gray-200 pb-1 font-semibold text-gray-800 dark:border-gray-600 dark:text-gray-200">{g.title}</h3>
                    <ul className="space-y-2">{(g.ingredients ?? []).map((it, i) => renderNode(it, `${g.id || gi}-${it.id || i}`))}</ul>
                  </div>
                ) : null
              )}
          </div>
        )}
      </div>
    </div>
  );
}

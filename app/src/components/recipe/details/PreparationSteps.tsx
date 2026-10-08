/**
 * Port of components/recipe/details/PreparationSteps.astro: numbered steps per
 * group (nested groups restart numbering), visibleWhen dependencies, time
 * mentions as timer buttons, temperatures with gas-mark tooltip, linked
 * ingredient chips (amber when already used in an earlier step, scaled with the
 * portions) and intermediate products (purple).
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { Recipe, PreparationStep, PreparationGroup, Ingredient, IngredientGroup } from '@/types';
import { getOptionToGroupMap, isVisibleWhenSatisfied, type AlternativeSelection } from '@core/alternatives';
import { useCookTimers } from '@/components/recipe/CookingTimers';
import { roundScaled } from './IngredientsList';

const isStepGroup = (x: PreparationStep | PreparationGroup): x is PreparationGroup => Array.isArray((x as PreparationGroup).steps);

function allSteps(groups: (PreparationStep | PreparationGroup)[]): PreparationStep[] {
  const out: PreparationStep[] = [];
  for (const g of groups) {
    if (isStepGroup(g)) out.push(...allSteps(g.steps ?? []));
    else if ((g as PreparationStep).text !== undefined) out.push(g as PreparationStep);
  }
  return out;
}
function allIngredients(groups: (Ingredient | IngredientGroup)[]): Ingredient[] {
  const out: Ingredient[] = [];
  for (const it of groups) {
    if (Array.isArray((it as IngredientGroup).ingredients)) out.push(...allIngredients((it as IngredientGroup).ingredients));
    else if ((it as Ingredient).name) out.push(it as Ingredient);
  }
  return out;
}

const GAS_MARKS: [string, number, number][] = [
  ['¼', 110, 120], ['½', 121, 135], ['1', 136, 150], ['2', 151, 165], ['3', 166, 180], ['4', 181, 195],
  ['5', 196, 210], ['6', 211, 225], ['7', 226, 240], ['8', 241, 260], ['9', 261, 290], ['10', 291, 320]
];
function gasMark(c: number): string {
  const m = GAS_MARKS.find(([, a, b]) => c >= a && c <= b);
  return m ? `Gasherd-Stufe ${m[0]}` : '';
}

/** Same parsing as the website's timer trigger. */
function parseTimeToSeconds(timeStr: string): number {
  const str = timeStr.toLowerCase();
  let minutes = 0;
  const h = str.match(/(\d+(?:[,.]\d+)?)\s*(?:stunden?|std\.?)/i);
  if (h) minutes += parseFloat(h[1].replace(',', '.')) * 60;
  const m = str.match(/(\d+(?:[,.]\d+)?)\s*(?:minuten?|min\.?)/i);
  if (m) minutes += parseFloat(m[1].replace(',', '.'));
  if (minutes === 0) {
    const n = str.match(/(\d+(?:[,.]\d+)?)/);
    if (n) minutes = parseFloat(n[1].replace(',', '.'));
  }
  return Math.round(minutes * 60);
}

const TEMP_RE = /(\d+)\s*(?:°C|° C|°c|° c|°|Grad|grad)/g;
const TIME_RE = /(\d+(?:[,.]\d+)?(?:[-–]\d+(?:[,.]\d+)?)?\s*(?:Minuten?|Min\.?|Stunden?|Std\.?))/gi;

export default function PreparationSteps({ recipe, selection, scale }: { recipe: Recipe; selection: AlternativeSelection; scale: number }) {
  const { addTimer } = useCookTimers();
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);
  const groups = recipe.preparationGroups ?? [];
  const optionToGroup = getOptionToGroupMap(recipe);
  const steps = allSteps(groups);
  const stepIndex = new Map(steps.map((s, i) => [s, i]));
  const ingredients = allIngredients(recipe.ingredientGroups ?? []);
  const intermediates = steps.flatMap((s) => s.intermediateIngredients ?? []);

  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    const outside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('.tooltip-trigger')) setTip(null);
    };
    window.addEventListener('scroll', hide, { passive: true });
    document.addEventListener('click', outside);
    return () => {
      window.removeEventListener('scroll', hide);
      document.removeEventListener('click', outside);
    };
  }, [tip]);

  // #step-<id> deep link (from a timer) → scroll + highlight, like the website.
  useEffect(() => {
    const h = window.location.hash;
    if (!h.startsWith('#step-')) return;
    const t = setTimeout(() => {
      const el = document.getElementById(h.slice(1));
      if (!el) return;
      el.classList.add('step-highlight');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => el.classList.remove('step-highlight'), 2000);
    }, 500);
    return () => clearTimeout(t);
  }, [recipe.id]);

  const showTip = (text: string | undefined, el: HTMLElement) => {
    if (!text) return;
    const r = el.getBoundingClientRect();
    const below = r.top < 60;
    setTip((cur) => (cur && cur.text === text ? null : { text, x: r.left + r.width / 2, y: below ? r.bottom + 10 : r.top - 10, below }));
  };

  const visible = (node: { visibleWhen?: any }) => isVisibleWhenSatisfied(node.visibleWhen, selection, optionToGroup);

  const renderText = (step: PreparationStep): ReactNode[] => {
    const text = step.text;
    const marks: { start: number; end: number; node: (k: number) => ReactNode }[] = [];
    for (const m of text.matchAll(TEMP_RE)) {
      const g = gasMark(parseInt(m[1], 10));
      if (!g) continue;
      const s = m.index!;
      marks.push({
        start: s,
        end: s + m[0].length,
        node: (k) => (
          <button key={k} type="button" className="temperature-mark tooltip-trigger" onClick={(e) => showTip(g, e.currentTarget)}>
            {m[0]}
          </button>
        )
      });
    }
    for (const m of text.matchAll(TIME_RE)) {
      const s = m.index!;
      if (marks.some((x) => s < x.end && s + m[0].length > x.start)) continue;
      const label = m[0];
      marks.push({
        start: s,
        end: s + label.length,
        node: (k) => (
          <button
            key={k}
            className="timer-trigger font-medium text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
            onClick={() => addTimer(label, parseTimeToSeconds(label), recipe.title, step.text.replace(/\s+/g, ' ').trim(), true)}
          >
            {label}
          </button>
        )
      });
    }
    marks.sort((a, b) => a.start - b.start);
    const out: ReactNode[] = [];
    let pos = 0;
    marks.forEach((mk, i) => {
      if (mk.start > pos) out.push(text.slice(pos, mk.start));
      out.push(mk.node(i));
      pos = mk.end;
    });
    if (pos < text.length) out.push(text.slice(pos));
    return out;
  };

  const renderStep = (step: PreparationStep, number: number) => {
    if (!visible(step)) return null;
    const global = stepIndex.get(step) ?? 0;
    const used = new Set(steps.slice(0, global).flatMap((s) => (s.linkedIngredients ?? []).map((l) => l.ingredientId)));
    return (
      <li key={step.id || global} id={`step-${step.id}`} className="recipe-prep-node flex space-x-4">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-orange-500 text-sm font-bold text-white">{number}</div>
        <div className="flex-1">
          <p className="mb-2 leading-relaxed text-gray-900 dark:text-white">{renderText(step)}</p>
          {step.linkedIngredients && step.linkedIngredients.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {step.linkedIngredients.map((link, i) => {
                if (link.isIntermediate) {
                  const inter = intermediates.find((x) => x.id === link.ingredientId);
                  if (!inter) return null;
                  return (
                    <button key={i} type="button" onClick={(e) => showTip(inter.description, e.currentTarget)} className="tooltip-trigger inline-flex items-center rounded-full bg-purple-100 px-2 py-1 text-xs font-medium text-purple-800 transition-colors hover:bg-purple-200 dark:bg-purple-900 dark:text-purple-200 dark:hover:bg-purple-800">
                      {inter.name}
                    </button>
                  );
                }
                const ing = ingredients.find((x) => x.id === link.ingredientId);
                if (!ing) return null;
                const q = ing.quantities?.[link.selectedQuantityIndex ?? 0];
                let qty: ReactNode = null;
                if (q && q.amount >= 1 && q.unit !== '') qty = <span> ({roundScaled(q.amount * scale)} {q.unit})</span>;
                else if (q && q.amount === 0 && q.unit !== '') qty = <span> ({q.unit})</span>;
                else if (q && q.amount >= 1 && q.unit === '') qty = <span> ({roundScaled(q.amount * scale)})</span>;
                const before = used.has(link.ingredientId);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={(e) => showTip(ing.description, e.currentTarget)}
                    className={
                      'tooltip-trigger inline-flex items-center rounded-full px-2 py-1 text-xs font-medium transition-colors ' +
                      (before
                        ? 'bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-200 dark:hover:bg-amber-800'
                        : 'bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900 dark:text-green-200 dark:hover:bg-green-800')
                    }
                  >
                    {ing.name}
                    {qty}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </li>
    );
  };

  const renderItems = (items: (PreparationStep | PreparationGroup)[]): ReactNode[] => {
    let n = 0;
    return items.map((item, i) => {
      if (isStepGroup(item)) {
        if (!visible(item)) return null;
        return (
          <li key={item.id || `g${i}`} className="recipe-prep-node py-2">
            {item.title && <h4 className="mb-2 ml-12 text-sm font-medium text-gray-700 dark:text-gray-300">{item.title}</h4>}
            <ol className="ml-12 space-y-4">{renderItems(item.steps ?? [])}</ol>
          </li>
        );
      }
      n++;
      return renderStep(item as PreparationStep, n);
    });
  };

  const hasAny = steps.some((s) => s.text && s.text.trim());

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm transition-colors duration-200 dark:border-gray-700 dark:bg-gray-800">
      <div className="p-6">
        <h2 className="mb-4 flex items-center text-2xl font-bold text-gray-900 dark:text-white">
          <svg className="mr-2 h-6 w-6 text-green-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
          Zubereitung
        </h2>
        {!hasAny ? (
          <div className="italic text-gray-500 dark:text-gray-400">Keine Zubereitungsschritte gefunden - bitte manuell hinzufügen.</div>
        ) : (
          <div className="space-y-4">
            {groups
              .filter((g) => g && !(g as PreparationGroup).title)
              .map((g, gi) =>
                visible(g as PreparationGroup) ? (
                  <ol key={(g as PreparationGroup).id || `u${gi}`} className="recipe-prep-node space-y-4">
                    {renderItems((g as PreparationGroup).steps ?? [])}
                  </ol>
                ) : null
              )}
            {groups
              .filter((g) => g && (g as PreparationGroup).title)
              .map((g, gi) =>
                visible(g as PreparationGroup) ? (
                  <div key={(g as PreparationGroup).id || `t${gi}`} className="recipe-prep-node">
                    <h3 className="mb-3 border-b border-gray-200 pb-1 font-semibold text-gray-800 dark:border-gray-600 dark:text-gray-200">{(g as PreparationGroup).title}</h3>
                    <ol className="space-y-4">{renderItems((g as PreparationGroup).steps ?? [])}</ol>
                  </div>
                ) : null
              )}
          </div>
        )}
      </div>
      {tip && (
        <div
          className="pointer-events-none fixed left-0 top-0 z-[9999] max-w-[250px] rounded bg-gray-900 px-3 py-2 text-sm text-white shadow-lg sm:max-w-[300px] dark:bg-gray-800"
          style={{ transform: `translate(calc(${Math.round(tip.x)}px - 50%), calc(${Math.round(tip.y)}px ${tip.below ? '+ 0px' : '- 100%'}))` }}
          onClick={() => setTip(null)}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}

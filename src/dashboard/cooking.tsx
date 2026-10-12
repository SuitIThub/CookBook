/**
 * "Demnächst kochen" UI shared by website (islands) and app:
 *  - CookedDialog: "Gekocht" → optional meal-prep portions for the tracker, off the list
 *  - RecipeCookBar: recipe page / cooking mode — add to the list, "Gekocht",
 *    and a question when the page has been open (visible) for a long time
 *  - PurchaseSuggestionBanner: shopping list — recipes whose ingredients were bought
 */
import { useEffect, useRef, useState } from 'react';
import {
  addToCookQueue,
  COOK_QUEUE_CHANGED_EVENT,
  dismissCookSuggestion,
  purchaseSuggestions,
  readCookQueue,
  removeFromCookQueue,
  type CookQueueEntry
} from '../lib/cookQueue';
import type { ShoppingList } from '../types/recipe';
import { btnPrimary, btnSecondary, ErrorText, inputClass, Modal, useDocumentEvent } from './ui';

/** Creates a meal-prep batch (tracker). Missing when there is no alias. */
export type CreatePlan = (input: { recipeId: string; scheduledAt: string; servings: number }) => Promise<void>;

/** Live view of the cook queue (alias sync + other components). */
export function useCookQueue(): CookQueueEntry[] {
  const [items, setItems] = useState(() => readCookQueue().items);
  const refresh = () => setItems(readCookQueue().items);
  useDocumentEvent(COOK_QUEUE_CHANGED_EVENT, refresh);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === 'cookbook.cookQueue' && refresh();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return items;
}

export function CookedDialog({
  recipe,
  createPlan,
  onClose,
  onDone
}: {
  recipe: { id: string; title: string; servings?: number };
  createPlan?: CreatePlan;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [servings, setServings] = useState(String(recipe.servings || 2));
  const [toTracker, setToTracker] = useState(!!createPlan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const n = Number(servings.replace(',', '.'));
    if (toTracker && !(n > 0)) return;
    setBusy(true);
    setError(null);
    try {
      if (toTracker && createPlan) await createPlan({ recipeId: recipe.id, scheduledAt: new Date().toISOString(), servings: n });
      removeFromCookQueue(recipe.id);
      onDone?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Gekocht"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btnSecondary} onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className={btnPrimary} onClick={save} disabled={busy}>
            Gekocht ✓
          </button>
        </>
      }
    >
      <p className="mb-3 font-medium">{recipe.title}</p>
      {createPlan ? (
        <>
          <label className="mb-2 flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-500" checked={toTracker} onChange={(e) => setToTracker(e.target.checked)} />
            <span>
              Portionen in den Tracker übernehmen
              <span className="block text-xs text-gray-500">Als Meal Prep ab jetzt — die Portionen streichst du beim Essen im Tracker (oder auf dem Dashboard) ab.</span>
            </span>
          </label>
          {toTracker && (
            <label className="block text-sm">
              Gekochte Portionen
              <input type="number" min="0.5" step="0.5" className={`mt-1 ${inputClass}`} value={servings} onChange={(e) => setServings(e.target.value)} />
            </label>
          )}
        </>
      ) : (
        <p className="text-sm text-gray-500">Das Gericht wird von „Demnächst kochen“ entfernt. (Mit Alias könnten die Portionen auch in den Tracker.)</p>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </Modal>
  );
}

/** Visible time on the page before asking "Hast du … gekocht?". */
const ASK_AFTER_MS = 20 * 60_000;
/** After "Nein"/"Später" the question stays away this long for the recipe. */
const SNOOZE_MS = 12 * 3_600_000;

function snoozed(recipeId: string): boolean {
  try {
    return Number(localStorage.getItem(`cookbook.cookedPrompt.${recipeId}`)) > Date.now() - SNOOZE_MS;
  } catch {
    return false;
  }
}

function snooze(recipeId: string): void {
  try {
    localStorage.setItem(`cookbook.cookedPrompt.${recipeId}`, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/** Counts visible time on the page and calls `onDue` once it exceeds `ms`. */
function useVisibleTimer(ms: number, onDue: () => void, enabled: boolean) {
  const due = useRef(onDue);
  due.current = onDue;
  useEffect(() => {
    if (!enabled) return;
    let visibleSince = document.visibilityState === 'visible' ? Date.now() : 0;
    let total = 0;
    let fired = false;
    const tick = () => {
      if (fired) return;
      const now = Date.now();
      const current = total + (visibleSince ? now - visibleSince : 0);
      if (current >= ms) {
        fired = true;
        due.current();
      }
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') visibleSince = Date.now();
      else if (visibleSince) {
        total += Date.now() - visibleSince;
        visibleSince = 0;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    const id = window.setInterval(tick, 15_000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(id);
    };
  }, [ms, enabled]);
}

/**
 * Bar on the recipe page (and in cooking mode, `compact`): "Demnächst kochen"
 * state + "Gekocht". Asks after 20 visible minutes whether the dish was cooked.
 */
export function RecipeCookBar({
  recipe,
  createPlan,
  compact = false
}: {
  recipe: { id: string; title: string; servings?: number };
  createPlan?: CreatePlan;
  compact?: boolean;
}) {
  const queue = useCookQueue();
  const entry = queue.find((e) => e.recipeId === recipe.id);
  const [dialog, setDialog] = useState(false);
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState(false);
  useVisibleTimer(ASK_AFTER_MS, () => !snoozed(recipe.id) && setAsking(true), !done);
  const servings = entry?.servings ?? recipe.servings;

  return (
    <>
      {asking && !dialog && (
        <div className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-md rounded-lg border border-orange-300 bg-white p-4 shadow-2xl dark:border-orange-700 dark:bg-gray-800" role="alertdialog" aria-label="Gekocht?">
          <p className="text-sm text-gray-900 dark:text-white">
            Die Seite ist schon eine Weile offen — hast du <strong>{recipe.title}</strong> gekocht?
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              className={btnSecondary}
              onClick={() => {
                snooze(recipe.id);
                setAsking(false);
              }}
            >
              Nein
            </button>
            <button
              type="button"
              className={btnPrimary}
              onClick={() => {
                setAsking(false);
                setDialog(true);
              }}
            >
              Ja, gekocht
            </button>
          </div>
        </div>
      )}
      <div className={`flex flex-wrap items-center gap-2 ${compact ? '' : 'rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800'}`}>
        {!compact && (
          <span className="mr-auto text-sm text-gray-600 dark:text-gray-300">
            {done
              ? 'Als gekocht vermerkt ✓'
              : entry
                ? `Auf „Demnächst kochen“ seit ${new Date(entry.addedAt).toLocaleDateString('de-DE')}${entry.source ? ` (aus „${entry.source.listTitle}“)` : ''}`
                : 'Willst du das bald kochen?'}
          </span>
        )}
        {!compact &&
          (entry ? (
            <button type="button" className={btnSecondary} onClick={() => removeFromCookQueue(recipe.id)}>
              Von der Kochliste nehmen
            </button>
          ) : (
            <button type="button" className={btnSecondary} onClick={() => addToCookQueue({ recipeId: recipe.id, title: recipe.title, servings: recipe.servings })}>
              + Demnächst kochen
            </button>
          ))}
        <button type="button" className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600" onClick={() => setDialog(true)}>
          Gekocht ✓
        </button>
      </div>
      {dialog && (
        <CookedDialog
          recipe={{ ...recipe, servings }}
          createPlan={createPlan}
          onClose={() => setDialog(false)}
          onDone={() => {
            snooze(recipe.id);
            setDone(true);
          }}
        />
      )}
    </>
  );
}

/** Shopping list: "Eingekauft für …" → put the recipes on "Demnächst kochen". */
export function PurchaseSuggestionBanner({ list }: { list: ShoppingList }) {
  useCookQueue(); // re-render when the queue changes
  const suggestions = purchaseSuggestions(list, readCookQueue());
  if (suggestions.length === 0) return null;
  const addAll = () => {
    for (const s of suggestions) addToCookQueue({ recipeId: s.recipeId, title: s.title, servings: s.servings, source: { listId: list.id, listTitle: list.title } });
  };
  return (
    // Floating at the bottom: you tick items further down the list, where a banner at the top would go unseen.
    <div className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-md rounded-lg border border-emerald-300 bg-emerald-50 p-3 shadow-2xl dark:border-emerald-800 dark:bg-emerald-950" role="status">
      <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
        Eingekauft? Die Zutaten für {suggestions.length === 1 ? 'dieses Rezept sind' : 'diese Rezepte sind'} (fast) alle abgehakt — auf „Demnächst kochen“ setzen?
      </p>
      <ul className="mt-2 space-y-1">
        {suggestions.map((s) => (
          <li key={s.recipeId} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate text-gray-900 dark:text-white">
              {s.title} <span className="text-xs text-gray-500">({s.checked}/{s.total} Zutaten)</span>
            </span>
            <button
              type="button"
              className="rounded border border-emerald-500 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
              onClick={() => addToCookQueue({ recipeId: s.recipeId, title: s.title, servings: s.servings, source: { listId: list.id, listTitle: list.title } })}
            >
              Hinzufügen
            </button>
            <button type="button" className="rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => dismissCookSuggestion(list.id, s.recipeId)}>
              Nein danke
            </button>
          </li>
        ))}
      </ul>
      {suggestions.length > 1 && (
        <button type="button" className="mt-2 rounded-md bg-emerald-500 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-600" onClick={addAll}>
          Alle hinzufügen
        </button>
      )}
    </div>
  );
}

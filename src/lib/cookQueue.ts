/**
 * "Demnächst kochen" — recipes you intend to cook soon (e.g. because you just
 * bought the ingredients), without a fixed date. Stored per alias in
 * localStorage under `cookbook.cookQueue`; the alias sync shares it between
 * devices (website + app). Also remembers declined shopping-list suggestions
 * so they are not offered again.
 */
import type { ShoppingList } from '../types/recipe';

export const COOK_QUEUE_KEY = 'cookbook.cookQueue';
export const COOK_QUEUE_CHANGED_EVENT = 'cookbook:cook-queue-changed';

export interface CookQueueEntry {
  recipeId: string;
  title: string;
  /** Portions you plan to cook (from the shopping list, else the recipe). */
  servings?: number;
  addedAt: number;
  /** Where it came from, e.g. the shopping list the ingredients were bought with. */
  source?: { listId: string; listTitle: string };
}

export interface CookQueueState {
  items: CookQueueEntry[];
  /** `${listId}:${recipeId}` → when the suggestion was declined. */
  dismissed: Record<string, number>;
}

export function parseCookQueue(raw: string | null | undefined): CookQueueState {
  if (!raw) return { items: [], dismissed: {} };
  try {
    const data = JSON.parse(raw) as Partial<CookQueueState>;
    const items = Array.isArray(data.items)
      ? data.items.filter((e): e is CookQueueEntry => !!e && typeof e.recipeId === 'string' && typeof e.title === 'string')
      : [];
    const dismissed: Record<string, number> = {};
    if (data.dismissed && typeof data.dismissed === 'object') {
      for (const [k, v] of Object.entries(data.dismissed)) if (typeof v === 'number') dismissed[k] = v;
    }
    return { items, dismissed };
  } catch {
    return { items: [], dismissed: {} };
  }
}

export function readCookQueue(): CookQueueState {
  try {
    return parseCookQueue(localStorage.getItem(COOK_QUEUE_KEY));
  } catch {
    return { items: [], dismissed: {} };
  }
}

function writeCookQueue(state: CookQueueState): void {
  // Declines older than 60 days are forgotten (keeps the synced value small).
  const cutoff = Date.now() - 60 * 86_400_000;
  const dismissed = Object.fromEntries(Object.entries(state.dismissed).filter(([, t]) => t > cutoff));
  try {
    localStorage.setItem(COOK_QUEUE_KEY, JSON.stringify({ items: state.items, dismissed }));
  } catch {
    /* storage blocked */
  }
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent(COOK_QUEUE_CHANGED_EVENT));
}

export function isInCookQueue(recipeId: string): boolean {
  return readCookQueue().items.some((e) => e.recipeId === recipeId);
}

export function addToCookQueue(entry: Omit<CookQueueEntry, 'addedAt'>): void {
  const state = readCookQueue();
  if (state.items.some((e) => e.recipeId === entry.recipeId)) return;
  writeCookQueue({ ...state, items: [...state.items, { ...entry, addedAt: Date.now() }] });
}

export function removeFromCookQueue(recipeId: string): void {
  const state = readCookQueue();
  writeCookQueue({ ...state, items: state.items.filter((e) => e.recipeId !== recipeId) });
}

export function dismissCookSuggestion(listId: string, recipeId: string): void {
  const state = readCookQueue();
  writeCookQueue({ ...state, dismissed: { ...state.dismissed, [`${listId}:${recipeId}`]: Date.now() } });
}

export interface PurchaseSuggestion {
  recipeId: string;
  title: string;
  servings?: number;
  checked: number;
  total: number;
}

/**
 * Recipes of a shopping list whose ingredients were (nearly) all bought:
 * ≥ 80 % of the recipe's items checked (a single item must be checked). If the
 * whole list is ≥ 90 % done, recipes with ≥ 60 % count too — the rest was
 * probably at home already. Recipes already queued or declined for this list
 * are left out.
 */
export function purchaseSuggestions(list: ShoppingList, state: CookQueueState): PurchaseSuggestion[] {
  const queued = new Set(state.items.map((e) => e.recipeId));
  const listItems = list.items ?? [];
  const listDone = listItems.length > 0 && listItems.filter((i) => i.isChecked).length / listItems.length >= 0.9;
  const out: PurchaseSuggestion[] = [];
  for (const r of list.recipes ?? []) {
    if (queued.has(r.id) || state.dismissed[`${list.id}:${r.id}`]) continue;
    const items = listItems.filter((i) => i.recipeId === r.id);
    if (items.length === 0) continue;
    const checked = items.filter((i) => i.isChecked).length;
    const ratio = checked / items.length;
    const enough = items.length === 1 ? checked === 1 : ratio >= 0.8 || (listDone && ratio >= 0.6);
    if (enough) out.push({ recipeId: r.id, title: r.title, servings: r.currentServings ?? r.servings, checked, total: items.length });
  }
  return out;
}

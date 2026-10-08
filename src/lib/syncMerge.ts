/**
 * Three-way merge for shopping lists (sync).
 *
 * A shopping list is one sync entity, but two people (or two devices) usually
 * edit DIFFERENT items of it at the same time — ticking things off in the shop
 * while someone at home adds more. Whole-list last-write-wins would throw one
 * side away, so the list is merged per item / per recipe / per field against
 * the `base` (the last version both sides agreed on):
 *
 *  - changed on one side only        → that side wins
 *  - changed on both sides           → the side with the newer list `updatedAt` wins
 *  - added on one side               → kept
 *  - deleted on one side, untouched  → deleted
 *  - deleted on one side, edited on the other → the edit wins (nothing is lost)
 *
 * Item `note`s are not part of the comparison: the sync payload strips them
 * (they can be multi-MB base64 HTML), so the remote/server copy's note is kept.
 *
 * Pure and framework-free — used by the server push endpoint and by the app's
 * pull. Without a base (legacy rows) callers fall back to whole-list LWW.
 */
import type { ShoppingList, ShoppingListItem, ShoppingListRecipe } from '../types/recipe';

function ts(v: unknown): number {
  if (v == null) return 0;
  const t = new Date(v as string).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Stable JSON (sorted keys, undefined dropped) for structural equality. */
function stable(v: unknown): string {
  if (v === undefined) return 'null';
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as object)
      .filter((k) => (v as any)[k] !== undefined)
      .sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stable((v as any)[k])).join(',') + '}';
  }
  return JSON.stringify(v ?? null);
}

function itemKey(it: ShoppingListItem | undefined): string {
  if (!it) return '∅';
  const { note: _note, ...rest } = it;
  return stable(rest);
}
function recipeKey(r: ShoppingListRecipe | undefined): string {
  return r ? stable(r) : '∅';
}

/**
 * Merge one keyed collection. Order: remote order first (the authoritative
 * layout), then local-only additions in their local order.
 */
function mergeKeyed<T extends { id: string }>(
  base: T[],
  local: T[],
  remote: T[],
  key: (x: T | undefined) => string,
  localWinsConflicts: boolean,
  combine: (winner: T, remote: T | undefined) => T = (w) => w
): T[] {
  const B = new Map(base.map((x) => [x.id, x]));
  const L = new Map(local.map((x) => [x.id, x]));
  const R = new Map(remote.map((x) => [x.id, x]));
  const order: string[] = [];
  const seen = new Set<string>();
  for (const x of remote) if (!seen.has(x.id)) (seen.add(x.id), order.push(x.id));
  for (const x of local) if (!seen.has(x.id)) (seen.add(x.id), order.push(x.id));
  // Ids only in base (deleted on both sides) are simply not in `order`.

  const out: T[] = [];
  for (const id of order) {
    const b = B.get(id);
    const l = L.get(id);
    const r = R.get(id);
    const kb = key(b);
    const kl = key(l);
    const kr = key(r);
    let pick: T | undefined;
    if (l && r) {
      if (kl === kr || kl === kb) pick = r;
      else if (kr === kb) pick = combine(l, r);
      else pick = localWinsConflicts ? combine(l, r) : r;
    } else if (l && !r) {
      // Missing remotely: deleted there (if it was in base) or added locally.
      pick = b && kl === kb ? undefined : l;
    } else if (!l && r) {
      pick = b && kr === kb ? undefined : r;
    }
    if (pick) out.push(pick);
  }
  return out;
}

function mergeField<T>(b: T, l: T, r: T, localWins: boolean): T {
  const kb = stable(b);
  const kl = stable(l);
  const kr = stable(r);
  if (kl === kr || kl === kb) return r;
  if (kr === kb) return l;
  return localWins ? l : r;
}

const SCALAR_FIELDS = [
  'title',
  'description',
  'permanentType',
  'isPermanent',
  'hasSeenGlobalTemplatePrompt',
  'preferredSupermarketId'
] as const;

/**
 * Merge `local` and `remote` given their common ancestor `base`. On a true
 * conflict (same item changed on both sides) the side with the newer list
 * `updatedAt` wins; ties go to remote.
 */
export function mergeShoppingList(base: ShoppingList, local: ShoppingList, remote: ShoppingList): ShoppingList {
  const localWins = ts(local.updatedAt) > ts(remote.updatedAt);
  const merged: any = { ...remote };
  for (const f of SCALAR_FIELDS) {
    merged[f] = mergeField((base as any)[f], (local as any)[f], (remote as any)[f], localWins);
  }
  merged.items = mergeKeyed<ShoppingListItem>(
    base.items ?? [],
    local.items ?? [],
    remote.items ?? [],
    itemKey,
    localWins,
    // Keep the remote note (the local copy has it stripped).
    (w, r) => (r && r.note != null && w.note == null ? { ...w, note: r.note } : w)
  );
  merged.recipes = mergeKeyed<ShoppingListRecipe>(
    base.recipes ?? [],
    local.recipes ?? [],
    remote.recipes ?? [],
    recipeKey,
    localWins
  );
  merged.updatedAt = new Date(Math.max(ts(local.updatedAt), ts(remote.updatedAt))).toISOString();
  return merged as ShoppingList;
}

/** True when two list versions are equal for sync purposes (ignores notes + timestamps). */
export function sameShoppingListContent(a: ShoppingList | null | undefined, b: ShoppingList | null | undefined): boolean {
  if (!a || !b) return a === b;
  const norm = (l: ShoppingList) =>
    stable({
      ...SCALAR_FIELDS.reduce((o, f) => ((o[f] = (l as any)[f]), o), {} as any),
      items: (l.items ?? []).map((i) => itemKey(i)),
      recipes: (l.recipes ?? []).map((r) => recipeKey(r))
    });
  return norm(a) === norm(b);
}

/**
 * Item notes are rich-text HTML authored on the website and can embed base64
 * images (one list hit ~12 MB). The app never renders notes, so sync payloads
 * drop them; the server re-attaches them by item id on push.
 */
export function stripShoppingListNotes<T>(list: T): T {
  const l = list as any;
  if (!l || !Array.isArray(l.items)) return list;
  return { ...l, items: l.items.map((it: any) => (it && it.note != null ? { ...it, note: undefined } : it)) };
}

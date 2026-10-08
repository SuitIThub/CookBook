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
 * Item notes are compared by digest, so a stripped note (`noteRef`) equals the
 * full note it stands for and the full remote copy is kept.
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

/** Note identity: stripped notes carry `noteRef` (digest), full ones are digested. */
function noteId(it: any): string | null {
  if (it?.noteRef) return it.noteRef;
  return typeof it?.note === 'string' && it.note ? noteDigest(it.note) : null;
}

function itemKey(it: ShoppingListItem | undefined): string {
  if (!it) return '∅';
  const { note: _note, noteRef: _ref, ...rest } = it as any;
  return stable({ ...rest, n: noteId(it) });
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
    // Winner only has the stripped ref of the same note → keep the full remote note.
    (w, r) => {
      const ref = (w as any).noteRef;
      if (ref && r && typeof r.note === 'string' && noteDigest(r.note) === ref) {
        const { noteRef: _r, ...rest } = w as any;
        return { ...rest, note: r.note };
      }
      return w;
    }
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
 * images (one list hit ~12 MB). Small notes travel inline; a note larger than
 * NOTE_INLINE_MAX is replaced in sync payloads by `noteRef` (a digest of the
 * note) — the app fetches it on demand (/api/shopping-lists/item-note) and the
 * server re-attaches it on push while `noteRef` is still present.
 */
export const NOTE_INLINE_MAX = 32 * 1024;

/** Short stable digest (FNV-1a, 2×32 bit) — identical in browser and Node. */
export function noteDigest(note: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < note.length; i++) {
    const c = note.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return h1.toString(36) + '.' + h2.toString(36) + '.' + note.length.toString(36);
}

export function stripShoppingListNotes<T>(list: T): T {
  const l = list as any;
  if (!l || !Array.isArray(l.items)) return list;
  return {
    ...l,
    items: l.items.map((it: any) =>
      it && typeof it.note === 'string' && it.note.length > NOTE_INLINE_MAX
        ? { ...it, note: undefined, noteRef: noteDigest(it.note) }
        : it
    )
  };
}

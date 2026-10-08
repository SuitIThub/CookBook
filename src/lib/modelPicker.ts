/**
 * Shared logic of the model picker (website AISettingsModal + app
 * HeaderModals): search, favorites, per-task recommendations, sorting.
 * Browser-only helpers (localStorage); no server imports.
 */
import type { CatalogModel, ModelTask } from './aiModelCatalog';

export type { CatalogModel, ModelTask };
export type SortMode = 'recommended' | 'price' | 'newest' | 'name';

/** Starred models ("provider:id"), synced per alias like the other AI settings. */
export const FAVORITES_KEY = 'cookbook.ai.favoriteModels';

export function readFavorites(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function toggleFavorite(provider: string, id: string): Set<string> {
  const favs = readFavorites();
  const key = `${provider}:${id}`;
  if (favs.has(key)) favs.delete(key);
  else favs.add(key);
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favs]));
  } catch {
    /* storage unavailable */
  }
  return favs;
}

/** Combined price of a typical call (1:1 input/output) — for sorting. */
const cost = (m: CatalogModel) => (m.promptPrice ?? 999) + (m.completionPrice ?? 999);

function sortModels(list: CatalogModel[], sort: SortMode, task: ModelTask): CatalogModel[] {
  const by: Record<SortMode, (a: CatalogModel, b: CatalogModel) => number> = {
    recommended: (a, b) =>
      Number(!!b.recommended[task]) - Number(!!a.recommended[task]) || (b.intelligence ?? -1) - (a.intelligence ?? -1) || a.name.localeCompare(b.name),
    price: (a, b) => cost(a) - cost(b) || a.name.localeCompare(b.name),
    newest: (a, b) => (b.created ?? 0) - (a.created ?? 0),
    name: (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' })
  };
  return [...list].sort(by[sort]);
}

/** Can the model do the task at all (hard requirements, e.g. images for "Bilder lesen")? */
export function suitable(m: CatalogModel, task: ModelTask): boolean {
  if (task === 'vision') return m.image;
  if (task === 'structure' || task === 'matching') return m.structured;
  return true;
}

export interface ArrangedModels {
  favorites: CatalogModel[];
  recommended: CatalogModel[];
  others: CatalogModel[];
  total: number;
}

/** Filter by search, split into favorites / recommended for the task / everything else suitable. */
export function arrangeModels(
  models: CatalogModel[],
  opts: { provider: string; task: ModelTask; query: string; sort: SortMode; onlyRecommended: boolean; favorites: Set<string> }
): ArrangedModels {
  const terms = opts.query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = models.filter((m) => {
    if (!suitable(m, opts.task)) return false;
    if (opts.onlyRecommended && !m.recommended[opts.task] && !opts.favorites.has(`${opts.provider}:${m.id}`)) return false;
    const hay = `${m.name} ${m.id}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  const fav = matches.filter((m) => opts.favorites.has(`${opts.provider}:${m.id}`));
  const rest = matches.filter((m) => !opts.favorites.has(`${opts.provider}:${m.id}`));
  return {
    favorites: sortModels(fav, opts.sort, opts.task),
    recommended: sortModels(rest.filter((m) => m.recommended[opts.task]), opts.sort, opts.task),
    others: sortModels(rest.filter((m) => !m.recommended[opts.task]), opts.sort, opts.task),
    total: matches.length
  };
}

/** "$0,30 / $2,50 pro 1 Mio. Tokens", "kostenlos", "" (unknown). */
export function formatPrice(m: CatalogModel): string {
  if (m.free) return 'kostenlos';
  if (m.promptPrice == null || m.completionPrice == null) return '';
  const f = (n: number) => `$${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: n < 0.1 ? 3 : 2 })}`;
  return `${f(m.promptPrice)} / ${f(m.completionPrice)} pro 1 Mio. Tokens`;
}

export interface Badge {
  label: string;
  title: string;
  tone: 'good' | 'info' | 'muted';
}

export function badges(m: CatalogModel, task: ModelTask): Badge[] {
  const out: Badge[] = [];
  if (m.recommended[task]) out.push({ label: 'Empfohlen', title: m.recommended[task]!, tone: 'good' });
  if (m.image) out.push({ label: 'Bilder', title: 'Kann Bilder lesen', tone: 'info' });
  if (m.pdf) out.push({ label: 'PDF', title: 'Kann Dateien/PDFs lesen', tone: 'info' });
  if (m.intelligence != null) out.push({ label: `Index ${Math.round(m.intelligence)}`, title: 'Artificial Analysis Intelligence Index (allgemeine Qualität)', tone: 'muted' });
  return out;
}

export const TASK_HINTS: Record<ModelTask, string> = {
  chat: 'Empfohlen: allgemeiner Qualitätsindex ≥ 40.',
  structure: 'Empfohlen: zuverlässige JSON-Ausgabe und Qualitätsindex ≥ 30.',
  vision: 'Nur Modelle, die Bilder lesen. Empfohlen: zusätzlich JSON-Ausgabe und Qualitätsindex ≥ 20.',
  matching: 'Empfohlen: zuverlässige JSON-Ausgabe und Qualitätsindex ≥ 20.'
};

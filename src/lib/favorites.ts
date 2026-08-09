/** Client-side favorites helpers (per-alias via localStorage + alias sync). */

export const FAVORITES_KEY = 'cookbook.recipes.favorites';
export const ALIAS_KEY = 'cookbook.alias';

export function getAlias(): string {
  try {
    return (localStorage.getItem(ALIAS_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function hasAlias(): boolean {
  return getAlias().length > 0;
}

export function getFavoriteIds(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0));
  } catch {
    return new Set();
  }
}

export function saveFavoriteIds(ids: Set<string>): void {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(ids)));
}

export function parseFamilyIds(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

export function isFamilyFavorite(familyIds: string[], favorites = getFavoriteIds()): boolean {
  return familyIds.some((id) => favorites.has(id));
}

/** Add or remove every id in the recipe family (Stamm + Varianten). */
export function setFamilyFavorite(familyIds: string[], favorite: boolean): void {
  if (familyIds.length === 0) return;
  const favs = getFavoriteIds();
  if (favorite) {
    familyIds.forEach((id) => favs.add(id));
  } else {
    familyIds.forEach((id) => favs.delete(id));
  }
  saveFavoriteIds(favs);
  notifyFavoritesChanged();
}

export function toggleFamilyFavorite(familyIds: string[]): boolean {
  const next = !isFamilyFavorite(familyIds);
  setFamilyFavorite(familyIds, next);
  return next;
}

/**
 * If any family member is favorited, ensure all current family ids are stored.
 * Keeps newly created variants in sync after a family was already favorited.
 */
export function ensureFavoriteFamilyComplete(familyIds: string[]): boolean {
  if (familyIds.length === 0 || !hasAlias()) return false;
  const favs = getFavoriteIds();
  if (!familyIds.some((id) => favs.has(id))) return false;
  let changed = false;
  for (const id of familyIds) {
    if (!favs.has(id)) {
      favs.add(id);
      changed = true;
    }
  }
  if (changed) saveFavoriteIds(favs);
  return changed;
}

export function notifyFavoritesChanged(): void {
  document.dispatchEvent(new CustomEvent('cookbook:favorites-changed'));
}

/** Stable partition: favorites first, then the rest (order within each group preserved). */
export function sortFavoritesFirst<T>(
  items: T[],
  getFamilyIds: (item: T) => string[],
  favorites = getFavoriteIds()
): T[] {
  const fav: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    if (isFamilyFavorite(getFamilyIds(item), favorites)) fav.push(item);
    else rest.push(item);
  }
  return fav.concat(rest);
}

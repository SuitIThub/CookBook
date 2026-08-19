/** Client-side default product per catalogue ingredient (per-alias via localStorage + alias sync). */

export const INGREDIENT_DEFAULTS_KEY = 'cookbook.ingredient.defaults';
export const PREFERRED_SUPERMARKET_KEY = 'cookbook.preferredSupermarket';

/** catalogueIngredientId → productId. Empty string means explicitly no product. */
export type IngredientDefaultsMap = Record<string, string>;

export function parseIngredientDefaults(raw: unknown): IngredientDefaultsMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: IngredientDefaultsMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || typeof value !== 'string') continue;
    out[key] = value;
  }
  return out;
}

export function readIngredientDefaults(): IngredientDefaultsMap {
  if (typeof localStorage === 'undefined') return {};
  try {
    return parseIngredientDefaults(JSON.parse(localStorage.getItem(INGREDIENT_DEFAULTS_KEY) || '{}'));
  } catch {
    return {};
  }
}

export function writeIngredientDefaults(map: IngredientDefaultsMap): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(INGREDIENT_DEFAULTS_KEY, JSON.stringify(map));
}

/**
 * Alias default for a catalogue ingredient.
 * Missing key → fallback (usually the shared catalogue default).
 * Present empty string → user chose "no product".
 */
export function getIngredientDefault(catalogueId: string, fallback = ''): string {
  if (!catalogueId) return fallback;
  const map = readIngredientDefaults();
  if (Object.prototype.hasOwnProperty.call(map, catalogueId)) return map[catalogueId] || '';
  return fallback;
}

export function setIngredientDefault(catalogueId: string, productId: string): void {
  if (!catalogueId) return;
  const map = readIngredientDefaults();
  map[catalogueId] = productId;
  writeIngredientDefaults(map);
}

export function clearIngredientDefaultIfProduct(catalogueId: string, productId: string): void {
  if (!catalogueId || !productId) return;
  const map = readIngredientDefaults();
  if (map[catalogueId] !== productId) return;
  map[catalogueId] = '';
  writeIngredientDefaults(map);
}

export function readPreferredSupermarket(): string {
  if (typeof localStorage === 'undefined') return '';
  try {
    return (localStorage.getItem(PREFERRED_SUPERMARKET_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function writePreferredSupermarket(id: string): void {
  if (typeof localStorage === 'undefined') return;
  const value = (id || '').trim();
  if (!value) localStorage.removeItem(PREFERRED_SUPERMARKET_KEY);
  else localStorage.setItem(PREFERRED_SUPERMARKET_KEY, value);
}

/** Canonical Hauptkategorien for recipes. */
export const MAIN_CATEGORIES = [
  'Hauptgericht',
  'Vorspeise',
  'Dessert',
  'Getränk',
  'Snack',
  'Salat',
  'Suppe',
  'Beilage',
  'Frühstück',
  'Kuchen & Gebäck',
] as const;

export type MainCategory = (typeof MAIN_CATEGORIES)[number];

/** Legacy names that should be rewritten to a canonical Hauptkategorie. */
const MAIN_CATEGORY_ALIASES: Record<string, MainCategory> = {
  'brot & gebäck': 'Kuchen & Gebäck',
};

export function resolveMainCategory(name: string | null | undefined): MainCategory | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const alias = MAIN_CATEGORY_ALIASES[lower];
  if (alias) return alias;
  return MAIN_CATEGORIES.find((category) => category.toLowerCase() === lower) ?? null;
}

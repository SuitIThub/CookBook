/**
 * Unit list + display formatting for shopping lists — the same data the
 * website gets from /api/units, computed locally from the shared unit table so
 * it works offline.
 */
import { BASE_UNITS, getAvailableUnits } from '@core/units';

const CATEGORY_ORDER = ['weight', 'volume', 'piece', 'natural', 'small'];

/** Units for the "Einheit wählen…" dropdown, sorted like /api/units. */
export function unitOptions(): { name: string; category: string }[] {
  return getAvailableUnits().sort((a, b) =>
    a.category !== b.category
      ? CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
      : a.name.localeCompare(b.name)
  );
}

let conversions: Record<string, { name: string; factor: number }[]> | null = null;
function conversionData() {
  if (conversions) return conversions;
  conversions = {};
  for (const unit of Object.values(BASE_UNITS)) {
    if (!unit.isBaseUnit) continue;
    conversions[unit.name] = Object.values(BASE_UNITS)
      .filter((u) => !u.isBaseUnit && u.baseUnit === unit.name && u.conversionFactor)
      .map((u) => ({ name: u.name, factor: u.conversionFactor! }))
      .sort((a, b) => b.factor - a.factor);
  }
  return conversions;
}

/** Mirrors formatQuantityForDisplay on the website's shopping-list page. */
export function formatQuantityForDisplay(amount: number, unit?: string): { amount: number; unit: string } {
  const round = (n: number) => Math.round(n * 10) / 10;
  if (!unit || unit.trim() === '') return { amount: round(amount), unit: unit || '' };
  const normalized = unit.trim();
  const displayUnits = conversionData()[normalized];
  if (!displayUnits || displayUnits.length === 0) return { amount: round(amount), unit: normalized };
  for (const du of [...displayUnits].sort((a, b) => b.factor - a.factor)) {
    if (du.factor === 1) continue;
    const converted = amount / du.factor;
    if (converted >= 1 && converted < 1000) return { amount: round(converted), unit: du.name };
  }
  return { amount: round(amount), unit: normalized };
}

/** "1.5" style amount text exactly like the website (no locale comma). */
export function amountText(n: number): string {
  return n % 1 === 0 ? n.toString() : n.toFixed(1).replace(/\.0$/, '');
}

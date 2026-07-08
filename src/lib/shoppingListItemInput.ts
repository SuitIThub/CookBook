import type { ShoppingListItem } from '../types/recipe';

export type ParsedItemResult =
  | { ok: true; item: Omit<ShoppingListItem, 'id'> }
  | { ok: false; error: string };

/**
 * Validates and normalizes an incoming shopping list item payload from the API.
 *
 * Accepts either a flat item object (`{ name, quantity, ... }`) or the value
 * of an `item` property. Only known, safe fields are copied through so the
 * caller cannot inject arbitrary properties (e.g. a client-provided `id`).
 */
export function parseShoppingListItemInput(raw: unknown): ParsedItemResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Item-Daten erforderlich' };
  }

  const data = raw as Record<string, unknown>;

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) {
    return { ok: false, error: 'Der Name des Artikels ist erforderlich' };
  }

  const item: Omit<ShoppingListItem, 'id'> = {
    name,
    isChecked: typeof data.isChecked === 'boolean' ? data.isChecked : false,
  };

  if (typeof data.description === 'string' && data.description.trim()) {
    item.description = data.description.trim();
  }

  if (typeof data.note === 'string' && data.note.trim()) {
    item.note = data.note;
  }

  // Quantity is optional but, when provided, must contain a numeric amount and a unit.
  if (data.quantity !== undefined && data.quantity !== null) {
    if (typeof data.quantity !== 'object') {
      return { ok: false, error: 'quantity muss ein Objekt mit amount und unit sein' };
    }

    const q = data.quantity as Record<string, unknown>;
    const amount =
      typeof q.amount === 'number' ? q.amount : Number.parseFloat(String(q.amount ?? ''));
    const unit = typeof q.unit === 'string' ? q.unit.trim() : '';

    if (!Number.isFinite(amount) || !unit) {
      return { ok: false, error: 'quantity benötigt einen numerischen amount und eine unit' };
    }

    item.quantity = { amount, unit };
  }

  return { ok: true, item };
}

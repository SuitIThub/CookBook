import type { APIRoute } from 'astro';
import { db } from '../../../../lib/database';
import { parseShoppingListItemInput } from '../../../../lib/shoppingListItemInput';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * POST /api/shopping-lists/{id}/items
 *
 * Fügt einer bestimmten Einkaufsliste einen einzelnen Artikel hinzu.
 * Der Body kann entweder das Item direkt enthalten oder unter `item` verschachtelt sein:
 *   { "name": "Milch", "quantity": { "amount": 1, "unit": "l" } }
 *   { "item": { "name": "Milch" } }
 */
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const { id } = params;
    if (!id) {
      return json({ error: 'Shopping list ID required' }, 400);
    }

    const raw = await request.json().catch(() => null);
    const itemInput =
      raw && typeof raw === 'object' && 'item' in (raw as Record<string, unknown>)
        ? (raw as Record<string, unknown>).item
        : raw;

    const parsed = parseShoppingListItemInput(itemInput);
    if (!parsed.ok) {
      return json({ error: parsed.error }, 400);
    }

    const list = db.getShoppingList(id);
    if (!list) {
      return json({ error: 'Shopping list not found' }, 404);
    }

    const updatedList = db.addItemToShoppingList(id, parsed.item);
    if (!updatedList) {
      return json({ error: 'Shopping list not found' }, 404);
    }

    return json(updatedList, 201);
  } catch (error) {
    console.error('Error adding item to shopping list:', error);
    return json({ error: 'Failed to add item to shopping list' }, 500);
  }
};

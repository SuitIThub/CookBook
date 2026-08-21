import type { APIRoute } from 'astro';
import { db } from '../../../../lib/database.server';
import { parseShoppingListItemInput } from '../../../../lib/shoppingListItemInput';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * POST /api/shopping-lists/permanent/items
 *
 * Fügt der Sammeleinkaufsliste (Sammelliste) einen einzelnen Artikel hinzu,
 * ohne dass die ID der Liste bekannt sein muss.
 * Der Body kann das Item direkt enthalten oder unter `item` verschachtelt sein:
 *   { "name": "Milch", "quantity": { "amount": 1, "unit": "l" } }
 *   { "item": { "name": "Milch" } }
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const raw = await request.json().catch(() => null);
    const itemInput =
      raw && typeof raw === 'object' && 'item' in (raw as Record<string, unknown>)
        ? (raw as Record<string, unknown>).item
        : raw;

    const parsed = parseShoppingListItemInput(itemInput);
    if (!parsed.ok) {
      return json({ error: parsed.error }, 400);
    }

    const permanentList = db.getPermanentShoppingList();
    if (!permanentList) {
      return json({ error: 'Sammelliste not found' }, 404);
    }

    const updatedList = db.addItemToShoppingList(permanentList.id, parsed.item);
    if (!updatedList) {
      return json({ error: 'Sammelliste not found' }, 404);
    }

    return json(updatedList, 201);
  } catch (error) {
    console.error('Error adding item to Sammelliste:', error);
    return json({ error: 'Failed to add item to Sammelliste' }, 500);
  }
};

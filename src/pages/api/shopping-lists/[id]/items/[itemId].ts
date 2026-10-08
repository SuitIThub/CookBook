import type { APIRoute } from 'astro';
import { db } from '../../../../../lib/database.server';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * DELETE /api/shopping-lists/{id}/items/{itemId}
 *
 * Entfernt einen einzelnen Artikel aus einer bestimmten Einkaufsliste.
 * Benötigt die ID der Einkaufsliste sowie die ID des zu entfernenden Artikels.
 */
export const DELETE: APIRoute = async ({ params }) => {
  try {
    const { id, itemId } = params;
    if (!id) {
      return json({ error: 'Shopping list ID required' }, 400);
    }
    if (!itemId) {
      return json({ error: 'Item ID required' }, 400);
    }

    const list = db.getShoppingList(id);
    if (!list) {
      return json({ error: 'Shopping list not found' }, 404);
    }

    const updatedList = db.removeItemFromShoppingList(id, itemId);
    if (!updatedList) {
      return json({ error: 'Item not found in shopping list' }, 404);
    }

    return json(updatedList, 200);
  } catch (error) {
    console.error('Error removing item from shopping list:', error);
    return json({ error: 'Failed to remove item from shopping list' }, 500);
  }
};

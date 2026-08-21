import type { APIRoute } from 'astro';
import { db } from '../../../../lib/database.server';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * GET /api/shopping-lists/permanent
 *
 * Gibt die Sammeleinkaufsliste (Sammelliste) zurück, ohne dass die ID
 * der Liste bekannt sein muss.
 */
export const GET: APIRoute = async () => {
  try {
    const permanentList = db.getPermanentShoppingList();
    if (!permanentList) {
      return json({ error: 'Sammelliste not found' }, 404);
    }

    return json(permanentList, 200);
  } catch (error) {
    console.error('Error fetching Sammelliste:', error);
    return json({ error: 'Failed to fetch Sammelliste' }, 500);
  }
};

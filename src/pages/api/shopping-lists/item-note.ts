import type { APIRoute } from 'astro';
import { db } from '../../../lib/database.server';

/**
 * One shopping-list item's note. Sync payloads strip large notes (they can be
 * multi-MB HTML with embedded images, see syncMerge.ts); the app fetches the
 * note on demand when the user opens it.
 *   GET /api/shopping-lists/item-note?listId=<id>&itemId=<id> → { note: string | null }
 */
export const GET: APIRoute = async ({ url }) => {
  const sp = new URL(url).searchParams;
  const listId = sp.get('listId');
  const itemId = sp.get('itemId');
  if (!listId || !itemId) {
    return new Response(JSON.stringify({ error: 'listId and itemId required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  const list = db.getShoppingList(listId);
  const item = list?.items.find((i) => i.id === itemId);
  if (!item) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({ note: item.note ?? null }), {
    headers: { 'Content-Type': 'application/json' }
  });
};

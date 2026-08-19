import type { APIRoute } from 'astro';
import { db } from '../../../lib/database';

/**
 * Link/unlink a product to a catalogue ingredient, or toggle the ingredient's
 * default product. Kept as its own endpoint so the products page, the
 * ingredient catalogue modal and the recipe view can all link products
 * without round-tripping the full product payload.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const ingredientName = typeof body?.ingredientName === 'string' ? body.ingredientName.trim() : '';
    const explicitIngredientId = typeof body?.ingredientId === 'string' ? body.ingredientId : '';
    const productId = typeof body?.productId === 'string' ? body.productId : '';
    const action = String(body?.action || 'link');

    if (!productId) return json({ error: 'productId required' }, 400);

    let ingredientId = explicitIngredientId;
    if (!ingredientId) {
      if (!ingredientName) return json({ error: 'ingredientId or ingredientName required' }, 400);
      const existing = db.getCatalogueIngredientByName(ingredientName);
      if (existing) {
        ingredientId = existing.id;
      } else {
        const created = db.upsertCatalogueIngredient({ name: ingredientName });
        ingredientId = created.id;
      }
    } else {
      const existing = db.getCatalogueIngredientById(ingredientId);
      if (!existing) return json({ error: 'ingredient not found' }, 404);
    }

    const product = db.getProduct(productId);
    if (!product) return json({ error: 'product not found' }, 404);

    if (action === 'link') {
      const nextIds = Array.from(new Set([...(product.ingredientIds || []), ingredientId]));
      db.setProductIngredients(productId, nextIds);
    } else if (action === 'unlink') {
      const nextIds = (product.ingredientIds || []).filter((id) => id !== ingredientId);
      db.setProductIngredients(productId, nextIds);
      const cat = db.getCatalogueIngredientById(ingredientId);
      if (cat?.defaultProductId === productId) {
        db.setDefaultProductForIngredient(ingredientId, null);
      }
    } else if (action === 'setDefault') {
      const nextIds = Array.from(new Set([...(product.ingredientIds || []), ingredientId]));
      db.setProductIngredients(productId, nextIds);
      db.setDefaultProductForIngredient(ingredientId, productId);
    } else if (action === 'clearDefault') {
      db.setDefaultProductForIngredient(ingredientId, null);
    } else {
      return json({ error: `unknown action: ${action}` }, 400);
    }

    return json({
      ingredient: db.getCatalogueIngredientById(ingredientId),
      product: db.getProduct(productId),
    });
  } catch (error) {
    console.error('POST /api/ingredients/link-product error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

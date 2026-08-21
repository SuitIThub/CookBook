import type { APIRoute } from 'astro';
import { db } from '../../../lib/database.server';
import { deleteLocalProductImage } from '../../../lib/productImages';

export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return json({ error: 'id required' }, 400);
  const product = db.getProduct(id);
  if (!product) return json({ error: 'not found' }, 404);
  return json(product);
};

export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return json({ error: 'id required' }, 400);
  const product = db.getProduct(id);
  const deleted = db.deleteProduct(id);
  if (deleted && product?.imageUrl) {
    await deleteLocalProductImage(product.imageUrl);
  }
  return json({ deleted });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

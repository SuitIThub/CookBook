import type { APIRoute } from 'astro';
import { db } from '../../lib/database.server';

export const GET: APIRoute = async () => {
  return json(db.getAllSupermarkets());
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    if (!body || typeof body.name !== 'string' || !body.name.trim()) {
      return json({ error: 'name required' }, 400);
    }
    const market = db.upsertSupermarket({ id: body.id, name: body.name });
    return json(market);
  } catch (error) {
    console.error('POST /api/supermarkets error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};

export const DELETE: APIRoute = async ({ url }) => {
  const params = new URL(url).searchParams;
  const id = params.get('id');
  if (!id) return json({ error: 'id required' }, 400);
  const deleted = db.deleteSupermarket(id);
  return json({ deleted });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

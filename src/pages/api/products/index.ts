import type { APIRoute } from 'astro';
import { db } from '../../../lib/database.server';
import { deleteLocalProductImage } from '../../../lib/productImages';

export const GET: APIRoute = async ({ url }) => {
  try {
    const params = new URL(url).searchParams;
    const query = params.get('q');
    const ingredientId = params.get('ingredientId');
    if (ingredientId) {
      const products = db.getProductsForIngredient(ingredientId);
      return json(products);
    }
    if (query != null) {
      const limit = Math.min(100, Number.parseInt(params.get('limit') || '20', 10) || 20);
      const products = db.searchProducts(query, limit);
      return json(products);
    }
    return json(db.getAllProducts());
  } catch (error) {
    console.error('GET /api/products error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || !body.name || typeof body.name !== 'string') {
      return json({ error: 'name required' }, 400);
    }
    const previous =
      (typeof body.id === 'string' && body.id ? db.getProduct(body.id) : null) ||
      (typeof body.ean === 'string' && body.ean.trim() ? db.getProductByEan(body.ean.trim()) : null);
    const product = db.upsertProduct({
      id: body.id,
      ean: body.ean ?? null,
      name: body.name,
      brand: body.brand ?? null,
      netGrams: numeric(body.netGrams),
      packageLabel: body.packageLabel ?? null,
      nutritionPer100g: sanitizeNutrition(body.nutritionPer100g),
      gramsByUnit: body.gramsByUnit === undefined ? undefined : sanitizeGramsByUnit(body.gramsByUnit),
      defaultPrice: numeric(body.defaultPrice),
      imageUrl: body.imageUrl ?? null,
      source: body.source === 'openfoodfacts' ? 'openfoodfacts' : 'manual',
      offCode: body.offCode ?? null,
      supermarkets: Array.isArray(body.supermarkets)
        ? body.supermarkets
            .filter((s: any) => s && typeof s.supermarketId === 'string')
            .map((s: any) => ({ supermarketId: s.supermarketId, price: Number(s.price) }))
            .filter((s: any) => Number.isFinite(s.price))
        : undefined,
      ingredientIds: Array.isArray(body.ingredientIds)
        ? body.ingredientIds.filter((s: unknown) => typeof s === 'string')
        : undefined,
    });
    if (previous?.imageUrl && previous.imageUrl !== (product.imageUrl ?? null)) {
      await deleteLocalProductImage(previous.imageUrl);
    }
    return json(product);
  } catch (error) {
    console.error('POST /api/products error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};

function numeric(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sanitizeGramsByUnit(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [unit, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof unit !== 'string' || !unit.trim()) continue;
    const n = numeric(raw);
    if (n == null || n <= 0) continue;
    out[unit.trim()] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function sanitizeNutrition(value: unknown): any {
  if (!value || typeof value !== 'object') return null;
  const keys = ['calories', 'carbohydrates', 'protein', 'fat', 'saturatedFat', 'sugar', 'fiber', 'salt'];
  const out: Record<string, number> = {};
  for (const key of keys) {
    const raw = (value as any)[key];
    const n = raw == null || raw === '' ? null : Number(raw);
    if (n != null && Number.isFinite(n)) out[key] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

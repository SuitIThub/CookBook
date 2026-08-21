import type { APIRoute } from 'astro';
import { db } from '../../../lib/database.server';

/**
 * Catalogue metadata for ingredients: nutrition per 100 g, density, grams
 * per unit map, default product. Keyed by ingredient name (unified with the
 * autocomplete ingredients table).
 */
export const GET: APIRoute = async ({ url }) => {
  const params = new URL(url).searchParams;
  const name = params.get('name');
  if (name) {
    const ingredient = db.getCatalogueIngredientByName(name);
    return json(ingredient);
  }
  const query = (params.get('q') || '').trim();
  if (query) {
    const limit = Math.min(50, Number.parseInt(params.get('limit') || '20', 10) || 20);
    return json(db.searchCatalogueIngredients(query, limit));
  }
  return json(db.getAllCatalogueIngredients());
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    if (!body || typeof body.name !== 'string' || !body.name.trim()) {
      return json({ error: 'name required' }, 400);
    }

    const gramsByUnit = sanitizeGramsByUnit(body.gramsByUnit);
    const nutrition = sanitizeNutrition(body.nutritionPer100g);

    const ingredient = db.upsertCatalogueIngredient({
      name: body.name,
      description: typeof body.description === 'string' ? body.description : undefined,
      nutritionPer100g: nutrition,
      densityGPerMl: numeric(body.densityGPerMl),
      gramsByUnit,
      defaultProductId: body.defaultProductId === undefined
        ? undefined
        : (typeof body.defaultProductId === 'string' ? body.defaultProductId : null),
    });
    return json(ingredient);
  } catch (error) {
    console.error('POST /api/ingredients/catalogue error:', error);
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
    const n = numeric((value as any)[key]);
    if (n != null) out[key] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

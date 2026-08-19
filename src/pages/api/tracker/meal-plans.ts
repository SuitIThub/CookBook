import type { APIRoute } from 'astro';
import { db } from '../../../lib/database';
import type { MealPlanStatus } from '../../../types/tracker';

function normalizeAlias(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 128);
}

export const GET: APIRoute = async ({ url }) => {
  const params = new URL(url).searchParams;
  const alias = normalizeAlias(params.get('alias'));
  if (!alias) return json({ error: 'alias required' }, 400);
  const activeOn = params.get('activeOn');
  if (activeOn) {
    return json({ alias, plans: db.getActiveMealPlansForAlias(alias, activeOn) });
  }
  const from = params.get('from') || undefined;
  const to = params.get('to') || undefined;
  return json({ alias, plans: db.getMealPlansForAlias(alias, from, to) });
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const alias = normalizeAlias(body?.alias);
    if (!alias) return json({ error: 'alias required' }, 400);
    if (!body?.recipeId || typeof body.recipeId !== 'string') return json({ error: 'recipeId required' }, 400);
    if (!body?.scheduledAt || typeof body.scheduledAt !== 'string') return json({ error: 'scheduledAt required' }, 400);
    const recipe = db.getRecipe(body.recipeId);
    if (!recipe) return json({ error: 'recipe not found' }, 404);
    const scheduledAt = new Date(body.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) return json({ error: 'invalid scheduledAt' }, 400);
    const servings = Number(body?.servings);
    const plan = db.createMealPlan({
      alias,
      recipeId: body.recipeId,
      scheduledAt,
      servings: Number.isFinite(servings) && servings > 0 ? servings : recipe.metadata.servings,
      supermarketId: body?.supermarketId || undefined,
      status: coerceStatus(body?.status),
      productAssignments: coerceAssignments(body?.productAssignments),
      reminderMinutes: Number.isFinite(Number(body?.reminderMinutes)) ? Number(body.reminderMinutes) : undefined,
    });
    return json(plan);
  } catch (error) {
    console.error('POST /api/tracker/meal-plans error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};

export const PUT: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    if (!body?.id) return json({ error: 'id required' }, 400);
    const scheduledAt = body?.scheduledAt ? new Date(body.scheduledAt) : undefined;
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return json({ error: 'invalid scheduledAt' }, 400);
    const updates: any = {};
    if (body.recipeId) updates.recipeId = body.recipeId;
    if (scheduledAt) updates.scheduledAt = scheduledAt;
    if (Number.isFinite(Number(body.servings))) updates.servings = Number(body.servings);
    if (body.supermarketId != null) updates.supermarketId = body.supermarketId || undefined;
    if (body.status) updates.status = coerceStatus(body.status);
    if (body.productAssignments) updates.productAssignments = coerceAssignments(body.productAssignments);
    if (body.nutritionSnapshot) updates.nutritionSnapshot = body.nutritionSnapshot;
    if (Number.isFinite(Number(body.reminderMinutes))) updates.reminderMinutes = Number(body.reminderMinutes);
    const plan = db.updateMealPlan(body.id, updates);
    if (!plan) return json({ error: 'not found' }, 404);
    return json(plan);
  } catch (error) {
    console.error('PUT /api/tracker/meal-plans error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};

export const DELETE: APIRoute = async ({ url }) => {
  const id = new URL(url).searchParams.get('id');
  if (!id) return json({ error: 'id required' }, 400);
  return json({ deleted: db.deleteMealPlan(id) });
};

function coerceStatus(value: unknown): MealPlanStatus {
  if (value === 'eaten' || value === 'skipped') return value;
  return 'planned';
}

function coerceAssignments(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof k === 'string' && typeof v === 'string' && v) out[k] = v;
  }
  return out;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

import type { APIRoute } from 'astro';
import { db } from '../../../lib/database';
import type { DiarySource } from '../../../types/tracker';
import type { NutritionData } from '../../../types/recipe';

function normalizeAlias(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 128);
}

export const GET: APIRoute = async ({ url }) => {
  const params = new URL(url).searchParams;
  const alias = normalizeAlias(params.get('alias'));
  if (!alias) return json({ error: 'alias required' }, 400);
  const from = params.get('from') || undefined;
  const to = params.get('to') || undefined;
  return json({ alias, entries: db.getDiaryEntriesForAlias(alias, from, to) });
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const alias = normalizeAlias(body?.alias);
    if (!alias) return json({ error: 'alias required' }, 400);
    const source = coerceSource(body?.source);
    const eatenAt = body?.eatenAt ? new Date(body.eatenAt) : new Date();
    if (Number.isNaN(eatenAt.getTime())) return json({ error: 'invalid eatenAt' }, 400);
    const entry = db.addDiaryEntry({
      alias,
      eatenAt,
      source,
      planId: body?.planId || undefined,
      recipeId: body?.recipeId || undefined,
      productId: body?.productId || undefined,
      label: body?.label || undefined,
      grams: Number.isFinite(Number(body?.grams)) ? Number(body.grams) : undefined,
      servings: Number.isFinite(Number(body?.servings)) ? Number(body.servings) : undefined,
      nutrition: coerceNutrition(body?.nutrition),
      costSnapshot: Number.isFinite(Number(body?.costSnapshot)) && Number(body.costSnapshot) >= 0 ? Number(body.costSnapshot) : undefined,
    });

    // Meal-prep: consuming some portions does not finish the batch. Status
    // flips to "eaten" only when remaining servings hit zero.
    if (source === 'plan' && body?.planId) {
      db.updateMealPlan(body.planId, { nutritionSnapshot: entry.nutrition });
      db.syncMealPlanStatusFromDiary(body.planId);
    }
    return json(entry);
  } catch (error) {
    console.error('POST /api/tracker/diary error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};

export const DELETE: APIRoute = async ({ url }) => {
  const id = new URL(url).searchParams.get('id');
  if (!id) return json({ error: 'id required' }, 400);
  return json({ deleted: db.deleteDiaryEntry(id) });
};

function coerceSource(value: unknown): DiarySource {
  return value === 'recipe' || value === 'product' || value === 'free' ? value : 'plan';
}

function coerceNutrition(value: unknown): NutritionData {
  if (!value || typeof value !== 'object') return {};
  const keys: (keyof NutritionData)[] = ['calories', 'carbohydrates', 'protein', 'fat', 'saturatedFat', 'sugar', 'fiber', 'salt'];
  const out: NutritionData = {};
  for (const key of keys) {
    const raw = (value as any)[key];
    const n = raw == null || raw === '' ? null : Number(raw);
    if (n != null && Number.isFinite(n)) out[key] = n;
  }
  return out;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

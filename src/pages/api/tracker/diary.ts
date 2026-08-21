import type { APIRoute } from 'astro';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../../lib/database.server';
import {
  addComponent,
  applyNutritionSource,
  extraFromSource,
  findComponent,
  removeComponent,
  replaceComponent,
  sumComposition,
} from '../../../lib/diaryComposition';
import type { CatalogueIngredient, DiaryComposition, DiarySource, Product } from '../../../types/tracker';
import type { NutritionData } from '../../../types/recipe';

function normalizeAlias(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 128);
}

function withComposition(entry: ReturnType<typeof db.getDiaryEntry>) {
  if (!entry) return null;
  const reconstructed = !entry.composition;
  const composition = ensureComposition(entry);
  return { ...entry, composition, compositionReconstructed: reconstructed };
}

function ensureComposition(entry: NonNullable<ReturnType<typeof db.getDiaryEntry>>): DiaryComposition {
  if (entry.composition) return entry.composition;
  if (entry.source === 'plan' && entry.planId) {
    const composition = db.buildDiaryCompositionForPlan(entry.planId, Number(entry.servings) || 1) ?? { components: [] };
    db.updateDiaryEntry(entry.id, { composition });
    entry.composition = composition;
    return composition;
  }
  return { components: [] };
}

export const GET: APIRoute = async ({ url }) => {
  const params = new URL(url).searchParams;
  const id = params.get('id');
  if (id) {
    const entry = db.getDiaryEntry(id);
    if (!entry) return json({ error: 'not found' }, 404);
    return json(withComposition(entry));
  }
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
    const servings = Number.isFinite(Number(body?.servings)) ? Number(body.servings) : undefined;
    let nutrition = coerceNutrition(body?.nutrition);
    let costSnapshot = Number.isFinite(Number(body?.costSnapshot)) && Number(body.costSnapshot) >= 0
      ? Number(body.costSnapshot)
      : undefined;
    let composition: DiaryComposition | undefined;
    if (source === 'plan' && body?.planId) {
      composition = db.buildDiaryCompositionForPlan(String(body.planId), servings || 1) ?? { components: [] };
      const totals = sumComposition(composition);
      if (Object.keys(totals.nutrition).length > 0) nutrition = totals.nutrition;
      if (totals.cost != null) costSnapshot = totals.cost;
    }
    const entry = db.addDiaryEntry({
      alias,
      eatenAt,
      source,
      planId: body?.planId || undefined,
      recipeId: body?.recipeId || undefined,
      productId: body?.productId || undefined,
      label: body?.label || undefined,
      grams: Number.isFinite(Number(body?.grams)) ? Number(body.grams) : undefined,
      servings,
      nutrition,
      costSnapshot,
      composition,
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

export const PUT: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const id = typeof body?.id === 'string' ? body.id : '';
    if (!id) return json({ error: 'id required' }, 400);
    const entry = db.getDiaryEntry(id);
    if (!entry) return json({ error: 'not found' }, 404);
    if (entry.source !== 'plan') return json({ error: 'only meal-prep entries can be edited' }, 400);

    const action = body?.action;
    if (action !== 'swap' && action !== 'add' && action !== 'remove') {
      return json({ error: 'action must be swap, add, or remove' }, 400);
    }

    let composition = ensureComposition(entry);
    if (action === 'remove') {
      const componentId = typeof body?.componentId === 'string' ? body.componentId : '';
      const existing = findComponent(composition, componentId);
      if (!existing) return json({ error: 'component not found' }, 404);
      if (existing.kind !== 'extra') return json({ error: 'only extra products can be removed' }, 400);
      composition = removeComponent(composition, componentId);
    } else {
      const source = resolveReplacement(body);
      if ('error' in source) return json({ error: source.error }, source.status);
      const gramsRaw = Number(body?.grams);
      if (action === 'add') {
        if (!Number.isFinite(gramsRaw) || gramsRaw <= 0) return json({ error: 'grams required' }, 400);
        composition = addComponent(composition, extraFromSource(source.value, gramsRaw, () => uuidv4()));
      } else {
        const componentId = typeof body?.componentId === 'string' ? body.componentId : '';
        const existing = findComponent(composition, componentId);
        if (!existing) return json({ error: 'component not found' }, 404);
        const grams = Number.isFinite(gramsRaw) && gramsRaw > 0 ? gramsRaw : existing.grams;
        const next = { ...existing, grams };
        if (existing.kind === 'extra' || source.value.renameSlot) {
          next.name = source.value.name || next.name;
        }
        composition = replaceComponent(composition, componentId, applyNutritionSource(next, source.value));
      }
    }

    const totals = sumComposition(composition);
    const updated = db.updateDiaryEntry(id, {
      composition,
      nutrition: totals.nutrition,
      costSnapshot: totals.cost,
    });
    if (!updated) return json({ error: 'not found' }, 404);
    if (updated.planId) {
      db.updateMealPlan(updated.planId, { nutritionSnapshot: updated.nutrition });
    }
    return json({ ...updated, composition, compositionReconstructed: false });
  } catch (error) {
    console.error('PUT /api/tracker/diary error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};

export const DELETE: APIRoute = async ({ url }) => {
  const id = new URL(url).searchParams.get('id');
  if (!id) return json({ error: 'id required' }, 400);
  return json({ deleted: db.deleteDiaryEntry(id) });
};

function resolveReplacement(body: any): { value: ReplacementSource } | { error: string; status: number } {
  const gramsByUnit = sanitizeGramsByUnit(body?.product?.gramsByUnit);
  if (typeof body?.productId === 'string' && body.productId) {
    const product = db.getProduct(body.productId);
    if (!product) return { error: 'product not found', status: 404 };
    return { value: { product, name: productDisplayName(product) } };
  }
  if (body?.product && typeof body.product === 'object' && typeof body.product.name === 'string') {
    const product = db.upsertProduct({
      id: typeof body.product.id === 'string' ? body.product.id : undefined,
      ean: body.product.ean ?? null,
      name: body.product.name,
      brand: body.product.brand ?? null,
      netGrams: numeric(body.product.netGrams),
      packageLabel: body.product.packageLabel ?? null,
      nutritionPer100g: coerceNutrition(body.product.nutritionPer100g),
      gramsByUnit,
      defaultPrice: numeric(body.product.defaultPrice),
      imageUrl: body.product.imageUrl ?? null,
      source: body.product.source === 'openfoodfacts' ? 'openfoodfacts' : 'manual',
      offCode: body.product.offCode ?? null,
    });
    return { value: { product, name: productDisplayName(product) } };
  }
  const catalogueId = typeof body?.catalogueIngredientId === 'string' ? body.catalogueIngredientId : '';
  const catalogueName = typeof body?.catalogueIngredientName === 'string' ? body.catalogueIngredientName.trim() : '';
  let catalogue: CatalogueIngredient | null = null;
  if (catalogueId) catalogue = db.getCatalogueIngredientById(catalogueId);
  else if (catalogueName) catalogue = db.getCatalogueIngredientByName(catalogueName);
  if (!catalogue) return { error: 'product or ingredient required', status: 400 };
  return {
    value: {
      nutritionPer100g: catalogue.nutritionPer100g,
      catalogueIngredientId: catalogue.id,
      name: catalogue.name,
      renameSlot: true,
    },
  };
}

interface ReplacementSource {
  nutritionPer100g?: NutritionData;
  product?: Product | null;
  catalogueIngredientId?: string;
  name?: string;
  renameSlot?: boolean;
}

function productDisplayName(product: Product): string {
  return product.brand ? `${product.brand} – ${product.name}` : product.name;
}

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

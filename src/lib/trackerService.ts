/**
 * Tracker request logic (weight, meal plans, diary, recipe suggestions),
 * independent of HTTP and of the SQLite driver. The Astro endpoints in
 * pages/api/tracker/* wrap these; the standalone app calls them against its
 * local replica so the tracker works offline with identical behaviour.
 */
import { v4 as uuidv4 } from 'uuid';
import type { CookbookDatabase } from './database';
import {
  addComponent,
  applyNutritionSource,
  extraFromSource,
  findComponent,
  removeComponent,
  replaceComponent,
  sumComposition
} from './diaryComposition';
import { collectIngredientsFromGroups, computeRecipeNutrition } from './recipeNutrition';
import { filterRecipeBySelection, getDefaultSelection, resolveSelection } from './alternatives';
import type { CatalogueIngredient, DiaryComposition, DiarySource, MealPlanStatus, Product } from '../types/tracker';
import type { NutritionData } from '../types/recipe';

export interface ServiceResult {
  status: number;
  body: unknown;
}
const ok = (body: unknown): ServiceResult => ({ status: 200, body });
const err = (error: string, status = 400): ServiceResult => ({ status, body: { error } });

export function normalizeAlias(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 128);
}

/* ---------------------------------------------------------------- weight */

export function weightGet(db: CookbookDatabase, aliasRaw: unknown): ServiceResult {
  const alias = normalizeAlias(aliasRaw);
  if (!alias) return err('alias required');
  return ok({ alias, logs: db.getWeightLogs(alias) });
}

export function weightPost(db: CookbookDatabase, body: any): ServiceResult {
  const alias = normalizeAlias(body?.alias);
  if (!alias) return err('alias required');
  const weightKg = Number(body?.weightKg);
  if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 500) return err('weightKg must be a positive number');
  const loggedAt = body?.loggedAt ? new Date(body.loggedAt) : new Date();
  if (Number.isNaN(loggedAt.getTime())) return err('invalid loggedAt');
  return ok(db.addWeightLog(alias, weightKg, loggedAt));
}

export function weightDelete(db: CookbookDatabase, id: string | null): ServiceResult {
  if (!id) return err('id required');
  return ok({ deleted: db.deleteWeightLog(id) });
}

/* ------------------------------------------------------------ meal plans */

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

export function mealPlansGet(db: CookbookDatabase, params: { alias?: unknown; activeOn?: string | null; from?: string | null; to?: string | null }): ServiceResult {
  const alias = normalizeAlias(params.alias);
  if (!alias) return err('alias required');
  if (params.activeOn) return ok({ alias, plans: db.getActiveMealPlansForAlias(alias, params.activeOn) });
  return ok({ alias, plans: db.getMealPlansForAlias(alias, params.from || undefined, params.to || undefined) });
}

export function mealPlansPost(db: CookbookDatabase, body: any): ServiceResult {
  const alias = normalizeAlias(body?.alias);
  if (!alias) return err('alias required');
  if (!body?.recipeId || typeof body.recipeId !== 'string') return err('recipeId required');
  if (!body?.scheduledAt || typeof body.scheduledAt !== 'string') return err('scheduledAt required');
  const recipe = db.getRecipe(body.recipeId);
  if (!recipe) return err('recipe not found', 404);
  const scheduledAt = new Date(body.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) return err('invalid scheduledAt');
  const servings = Number(body?.servings);
  return ok(
    db.createMealPlan({
      alias,
      recipeId: body.recipeId,
      scheduledAt,
      servings: Number.isFinite(servings) && servings > 0 ? servings : recipe.metadata.servings,
      supermarketId: body?.supermarketId || undefined,
      status: coerceStatus(body?.status),
      productAssignments: coerceAssignments(body?.productAssignments),
      reminderMinutes: Number.isFinite(Number(body?.reminderMinutes)) ? Number(body.reminderMinutes) : undefined
    })
  );
}

export function mealPlansPut(db: CookbookDatabase, body: any): ServiceResult {
  if (!body?.id) return err('id required');
  const scheduledAt = body?.scheduledAt ? new Date(body.scheduledAt) : undefined;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return err('invalid scheduledAt');
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
  if (!plan) return err('not found', 404);
  return ok(plan);
}

export function mealPlansDelete(db: CookbookDatabase, id: string | null): ServiceResult {
  if (!id) return err('id required');
  return ok({ deleted: db.deleteMealPlan(id) });
}

/* ----------------------------------------------------------------- diary */

function ensureComposition(db: CookbookDatabase, entry: NonNullable<ReturnType<CookbookDatabase['getDiaryEntry']>>): DiaryComposition {
  if (entry.composition) return entry.composition;
  if (entry.source === 'plan' && entry.planId) {
    const composition = db.buildDiaryCompositionForPlan(entry.planId, Number(entry.servings) || 1) ?? { components: [] };
    db.updateDiaryEntry(entry.id, { composition });
    entry.composition = composition;
    return composition;
  }
  return { components: [] };
}

function withComposition(db: CookbookDatabase, entry: ReturnType<CookbookDatabase['getDiaryEntry']>) {
  if (!entry) return null;
  const reconstructed = !entry.composition;
  const composition = ensureComposition(db, entry);
  return { ...entry, composition, compositionReconstructed: reconstructed };
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

interface ReplacementSource {
  nutritionPer100g?: NutritionData;
  product?: Product | null;
  catalogueIngredientId?: string;
  name?: string;
  renameSlot?: boolean;
}

const productDisplayName = (product: Product) => (product.brand ? `${product.brand} – ${product.name}` : product.name);

function resolveReplacement(db: CookbookDatabase, body: any): { value: ReplacementSource } | { error: string; status: number } {
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
      offCode: body.product.offCode ?? null
    });
    return { value: { product, name: productDisplayName(product) } };
  }
  const catalogueId = typeof body?.catalogueIngredientId === 'string' ? body.catalogueIngredientId : '';
  const catalogueName = typeof body?.catalogueIngredientName === 'string' ? body.catalogueIngredientName.trim() : '';
  let catalogue: CatalogueIngredient | null = null;
  if (catalogueId) catalogue = db.getCatalogueIngredientById(catalogueId);
  else if (catalogueName) catalogue = db.getCatalogueIngredientByName(catalogueName);
  if (!catalogue) return { error: 'product or ingredient required', status: 400 };
  return { value: { nutritionPer100g: catalogue.nutritionPer100g, catalogueIngredientId: catalogue.id, name: catalogue.name, renameSlot: true } };
}

export function diaryGet(db: CookbookDatabase, params: { id?: string | null; alias?: unknown; from?: string | null; to?: string | null }): ServiceResult {
  if (params.id) {
    const entry = db.getDiaryEntry(params.id);
    if (!entry) return err('not found', 404);
    return ok(withComposition(db, entry));
  }
  const alias = normalizeAlias(params.alias);
  if (!alias) return err('alias required');
  return ok({ alias, entries: db.getDiaryEntriesForAlias(alias, params.from || undefined, params.to || undefined) });
}

export function diaryPost(db: CookbookDatabase, body: any): ServiceResult {
  const alias = normalizeAlias(body?.alias);
  if (!alias) return err('alias required');
  const source = coerceSource(body?.source);
  const eatenAt = body?.eatenAt ? new Date(body.eatenAt) : new Date();
  if (Number.isNaN(eatenAt.getTime())) return err('invalid eatenAt');
  const servings = Number.isFinite(Number(body?.servings)) ? Number(body.servings) : undefined;
  let nutrition = coerceNutrition(body?.nutrition);
  let costSnapshot = Number.isFinite(Number(body?.costSnapshot)) && Number(body.costSnapshot) >= 0 ? Number(body.costSnapshot) : undefined;
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
    composition
  });
  // Meal-prep: consuming some portions does not finish the batch. Status
  // flips to "eaten" only when remaining servings hit zero.
  if (source === 'plan' && body?.planId) {
    db.updateMealPlan(body.planId, { nutritionSnapshot: entry.nutrition });
    db.syncMealPlanStatusFromDiary(body.planId);
  }
  return ok(entry);
}

export function diaryPut(db: CookbookDatabase, body: any): ServiceResult {
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) return err('id required');
  const entry = db.getDiaryEntry(id);
  if (!entry) return err('not found', 404);
  if (entry.source !== 'plan') return err('only meal-prep entries can be edited');
  const action = body?.action;
  if (action !== 'swap' && action !== 'add' && action !== 'remove') return err('action must be swap, add, or remove');

  let composition = ensureComposition(db, entry);
  if (action === 'remove') {
    const componentId = typeof body?.componentId === 'string' ? body.componentId : '';
    const existing = findComponent(composition, componentId);
    if (!existing) return err('component not found', 404);
    if (existing.kind !== 'extra') return err('only extra products can be removed');
    composition = removeComponent(composition, componentId);
  } else {
    const source = resolveReplacement(db, body);
    if ('error' in source) return err(source.error, source.status);
    const gramsRaw = Number(body?.grams);
    if (action === 'add') {
      if (!Number.isFinite(gramsRaw) || gramsRaw <= 0) return err('grams required');
      composition = addComponent(composition, extraFromSource(source.value, gramsRaw, () => uuidv4()));
    } else {
      const componentId = typeof body?.componentId === 'string' ? body.componentId : '';
      const existing = findComponent(composition, componentId);
      if (!existing) return err('component not found', 404);
      const grams = Number.isFinite(gramsRaw) && gramsRaw > 0 ? gramsRaw : existing.grams;
      const next = { ...existing, grams };
      if (existing.kind === 'extra' || source.value.renameSlot) next.name = source.value.name || next.name;
      composition = replaceComponent(composition, componentId, applyNutritionSource(next, source.value));
    }
  }
  const totals = sumComposition(composition);
  const updated = db.updateDiaryEntry(id, { composition, nutrition: totals.nutrition, costSnapshot: totals.cost });
  if (!updated) return err('not found', 404);
  if (updated.planId) db.updateMealPlan(updated.planId, { nutritionSnapshot: updated.nutrition });
  return ok({ ...updated, composition, compositionReconstructed: false });
}

export function diaryDelete(db: CookbookDatabase, id: string | null): ServiceResult {
  if (!id) return err('id required');
  return ok({ deleted: db.deleteDiaryEntry(id) });
}

/* ---------------------------------------------------- recipe suggestions */

/**
 * Recipes that fit the remaining daily budget: given `kcal` (and optionally
 * `protein`) left for today, return recipes whose per-serving values
 * meaningfully fill that budget without blowing it.
 */
export function recipeSuggestions(db: CookbookDatabase, params: { kcal: unknown; protein?: unknown; limit?: unknown }): ServiceResult {
  const remainingKcal = Number(params.kcal);
  const remainingProtein = Number(params.protein);
  const limit = Math.min(20, Math.max(1, Number.parseInt(String(params.limit ?? '6'), 10) || 6));
  if (!Number.isFinite(remainingKcal) || remainingKcal <= 0) return ok({ remainingKcal: 0, suggestions: [] });

  const catalogueByName = new Map<string, CatalogueIngredient>();
  for (const cat of db.getAllCatalogueIngredients()) catalogueByName.set(cat.name.trim().toLowerCase(), cat);
  const productsById = new Map<string, Product>();
  for (const product of db.getAllProducts()) productsById.set(product.id, product);

  const minKcal = remainingKcal * 0.35; // ignore tiny snacks that barely use the budget
  const maxKcal = remainingKcal * 1.1; // small overshoot tolerated
  const wantProtein = Number.isFinite(remainingProtein) && remainingProtein > 0;
  const scored: { id: string; title: string; imageUrl?: string; kcal: number; protein: number; estimated: boolean; score: number }[] = [];

  for (const recipe of db.getAllRecipes()) {
    const selection = resolveSelection(recipe, getDefaultSelection(recipe));
    const visible = collectIngredientsFromGroups(filterRecipeBySelection(recipe, selection).ingredientGroups);
    const res = computeRecipeNutrition({ recipe, visibleIngredients: visible, servings: recipe.metadata?.servings, catalogueByName, productsById });
    let kcal = res.perServing.calories ?? undefined;
    let protein = res.perServing.protein ?? undefined;
    let estimated = res.isEstimated;
    if (kcal == null && recipe.metadata?.nutrition?.calories != null) {
      kcal = recipe.metadata.nutrition.calories;
      protein = recipe.metadata.nutrition.protein ?? undefined;
      estimated = true;
    }
    if (kcal == null || !(kcal > 0) || kcal < minKcal || kcal > maxKcal) continue;
    const p = Number(protein) || 0;
    const score = wantProtein ? p / Math.max(1, kcal) : -Math.abs(kcal - remainingKcal);
    scored.push({ id: recipe.id, title: recipe.title, imageUrl: recipe.imageUrl || recipe.images?.[0]?.url, kcal: Math.round(kcal), protein: Math.round(p), estimated, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return ok({ remainingKcal: Math.round(remainingKcal), suggestions: scored.slice(0, limit).map(({ score: _s, ...rest }) => rest) });
}

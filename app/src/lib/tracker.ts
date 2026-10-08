/**
 * Tracker data access for the app — local-first. Weight logs, meal plans and
 * diary entries live in the local replica and run through the SAME request
 * logic as the server endpoints (@core/trackerService), so the tracker works
 * offline; the sync engine replicates the rows per alias (sync.ts). Product and
 * ingredient-catalogue searches read the replica too.
 *
 * The body profile is stored per-alias on the server via /api/alias-settings
 * (same key the website uses, `cookbook.tracker.profile`) and cached locally so
 * the goal math has something to work with offline.
 */
import { apiGet, apiPost } from './api';
import { getAlias } from './settings';
import { getLocalDb } from './localDb';
import { runSync } from './syncRunner';
import { computeLivePanel } from './localNutrition';
import { roundNutritionValues } from '@core/recipeNutrition';
import {
  diaryDelete,
  diaryGet,
  diaryPost,
  diaryPut,
  mealPlansGet,
  recipeSuggestions,
  weightDelete,
  weightGet,
  weightPost,
  type ServiceResult,
} from '@core/trackerService';
import type { NutritionData } from '@shared/recipe';
import type {
  BodyProfile,
  DiaryComposition,
  DiaryEntry,
  MealPlan,
  Product,
  WeightLog,
} from '@shared/tracker';

const enc = encodeURIComponent;

// ---------------------------------------------------------------- profile ----
// The website keeps the profile in localStorage and syncs it via the alias
// settings engine. The app has no such engine, so it reads/writes the alias
// setting directly and keeps a local copy for offline goal math.
const PROFILE_KEY = 'cookbook.tracker.profile';

export function readLocalProfile(): BodyProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as BodyProfile) : {};
  } catch {
    return {};
  }
}

function writeLocalProfile(profile: BodyProfile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* ignore */
  }
}

interface AliasSettingsResponse {
  settings?: Array<{ key: string; value: string | null }>;
}

/** Fetch the profile from the server (falls back to the local cache offline). */
export async function fetchProfile(): Promise<BodyProfile> {
  const alias = getAlias();
  if (!alias) return readLocalProfile();
  try {
    const data = await apiGet<AliasSettingsResponse>(`/api/alias-settings?alias=${enc(alias)}`);
    const row = data.settings?.find((s) => s.key === PROFILE_KEY);
    if (row && row.value) {
      const profile = JSON.parse(row.value) as BodyProfile;
      writeLocalProfile(profile);
      return profile;
    }
  } catch {
    /* offline / not set yet — fall through to local */
  }
  return readLocalProfile();
}

/** Persist the profile locally and to the server alias settings. */
export async function saveProfile(profile: BodyProfile): Promise<void> {
  writeLocalProfile(profile);
  const alias = getAlias();
  if (!alias) return;
  try {
    await apiPost('/api/alias-settings', {
      alias,
      settings: [{ key: PROFILE_KEY, value: JSON.stringify(profile), updatedAt: Date.now() }],
    });
  } catch {
    /* best effort — local copy already saved */
  }
}

// ------------------------------------------------------------ local core ----
function unwrap<T>(r: ServiceResult): T {
  if (r.status >= 400) throw new Error((r.body as { error?: string })?.error || `Fehler ${r.status}`);
  return r.body as T;
}

/** Read through the shared tracker logic on the local replica. */
async function read<T>(fn: (db: any) => ServiceResult): Promise<T> {
  const { db } = await getLocalDb();
  return unwrap<T>(fn(db));
}

/** Write locally, persist, then sync in the background (no-op offline). */
async function write<T>(fn: (db: any) => ServiceResult): Promise<T> {
  const { db, persist } = await getLocalDb();
  const result = unwrap<T>(fn(db));
  await persist();
  runSync().catch(() => {});
  return result;
}

// ----------------------------------------------------------------- weight ----
export async function getWeightLogs(): Promise<WeightLog[]> {
  const alias = getAlias();
  if (!alias) return [];
  const data = await read<{ logs: WeightLog[] }>((db) => weightGet(db, alias));
  return data.logs || [];
}

export async function addWeightLog(weightKg: number, loggedAt: string): Promise<WeightLog> {
  return write<WeightLog>((db) => weightPost(db, { alias: getAlias(), weightKg, loggedAt }));
}

export async function deleteWeightLog(id: string): Promise<void> {
  await write((db) => weightDelete(db, id));
}

// ------------------------------------------------------------------ diary ----
export async function getDiary(fromIso: string, toIso: string): Promise<DiaryEntry[]> {
  const alias = getAlias();
  if (!alias) return [];
  const data = await read<{ entries: DiaryEntry[] }>((db) => diaryGet(db, { alias, from: fromIso, to: toIso }));
  return data.entries || [];
}

export interface DiaryEntryDetail extends DiaryEntry {
  composition?: DiaryComposition;
  compositionReconstructed?: boolean;
}

export async function getDiaryEntry(id: string): Promise<DiaryEntryDetail | null> {
  try {
    // May rebuild + store a missing composition (legacy entries) → persisted like a write.
    return await write<DiaryEntryDetail>((db) => diaryGet(db, { id }));
  } catch {
    return null;
  }
}

export async function addDiaryEntry(body: Record<string, unknown>): Promise<DiaryEntry> {
  return write<DiaryEntry>((db) => diaryPost(db, { alias: getAlias(), ...body }));
}

export async function updateComposition(body: Record<string, unknown>): Promise<DiaryEntryDetail> {
  return write<DiaryEntryDetail>((db) => diaryPut(db, body));
}

export async function deleteDiaryEntry(id: string): Promise<void> {
  await write((db) => diaryDelete(db, id));
}

// -------------------------------------------------------------- meal plans ----
export async function getActivePlans(activeOnIso: string): Promise<MealPlan[]> {
  const alias = getAlias();
  if (!alias) return [];
  const data = await read<{ plans: MealPlan[] }>((db) => mealPlansGet(db, { alias, activeOn: activeOnIso }));
  return data.plans || [];
}

// --------------------------------------------------------- recipe helpers ----
export interface RecipeSuggestion {
  id: string;
  title: string;
  imageUrl?: string;
  kcal: number;
  protein: number;
  estimated: boolean;
}

export async function getSuggestions(kcal: number, protein?: number, limit = 4): Promise<RecipeSuggestion[]> {
  try {
    const data = await read<{ suggestions: RecipeSuggestion[] }>((db) =>
      recipeSuggestions(db, { kcal, protein: protein && protein > 0 ? protein : undefined, limit })
    );
    return data.suggestions || [];
  } catch {
    return [];
  }
}

export interface LiveNutritionResult {
  nutrition?: { perServing?: NutritionData };
  price?: { hasAnyData?: boolean; perServing?: number };
}

/** Per-serving nutrition/price of a plan's recipe with its product choices (website: /live-nutrition). */
export async function getLiveNutrition(recipeId: string, productAssignments: Record<string, string>): Promise<LiveNutritionResult | null> {
  try {
    const { db } = await getLocalDb();
    const recipe = db.getRecipe(recipeId);
    if (!recipe) return null;
    const live = await computeLivePanel(recipe, { productAssignments });
    return { nutrition: { perServing: roundNutritionValues(live.nutrition.perServing) }, price: live.price };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------- product search ----
const direct = (body: unknown): ServiceResult => ({ status: 200, body });

export async function searchRegisterProducts(query: string, limit = 12): Promise<Product[]> {
  try {
    return await read<Product[]>((db) => direct(db.searchProducts(query, limit)));
  } catch {
    return [];
  }
}

export interface CatalogueRow {
  id: string;
  name: string;
  nutritionPer100g?: NutritionData;
  gramsByUnit?: Record<string, number>;
}

export async function searchCatalogue(query: string, limit = 8): Promise<CatalogueRow[]> {
  try {
    return await read<CatalogueRow[]>((db) => direct(db.searchCatalogueIngredients(query, limit)));
  } catch {
    return [];
  }
}

export async function linkedProducts(catalogueIngredientId: string): Promise<Product[]> {
  try {
    return await read<Product[]>((db) => direct(db.getProductsForIngredient(catalogueIngredientId)));
  } catch {
    return [];
  }
}

/** Save an unsaved (OFF) product to the register so a diary entry can reference it. */
export async function ensureSavedProduct(p: {
  id?: string;
  ean?: string;
  name: string;
  brand?: string;
  netGrams?: number;
  packageLabel?: string;
  imageUrl?: string;
  source: 'local' | 'openfoodfacts';
  offCode?: string;
  nutritionPer100g?: NutritionData;
}): Promise<string | undefined> {
  if (p.id) return p.id;
  try {
    const created = await write<Product>((db) =>
      direct(
        db.upsertProduct({
          ean: p.ean ?? null,
          name: p.name,
          brand: p.brand ?? null,
          netGrams: p.netGrams ?? null,
          packageLabel: p.packageLabel ?? null,
          imageUrl: p.imageUrl ?? null,
          source: p.source === 'openfoodfacts' ? 'openfoodfacts' : 'manual',
          offCode: p.offCode ?? null,
          nutritionPer100g: p.nutritionPer100g ?? {},
        })
      )
    );
    return created?.id;
  } catch {
    return undefined;
  }
}

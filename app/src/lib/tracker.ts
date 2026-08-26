/**
 * Tracker data access for the app. Mirrors the website's tracker.astro network
 * calls, but routed through the app's native-HTTP api client (api.ts) so it
 * works on device. Everything is keyed by the configured alias (kochbuch.alias).
 *
 * The body profile is stored per-alias on the server via /api/alias-settings
 * (same key the website uses, `cookbook.tracker.profile`) and cached locally so
 * the goal math has something to work with offline.
 */
import { apiGet, apiPost, apiPut, apiDelete } from './api';
import { getAlias } from './settings';
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

// ----------------------------------------------------------------- weight ----
export async function getWeightLogs(): Promise<WeightLog[]> {
  const alias = getAlias();
  if (!alias) return [];
  const data = await apiGet<{ logs: WeightLog[] }>(`/api/tracker/weight?alias=${enc(alias)}`);
  return data.logs || [];
}

export async function addWeightLog(weightKg: number, loggedAt: string): Promise<WeightLog> {
  return apiPost<WeightLog>('/api/tracker/weight', { alias: getAlias(), weightKg, loggedAt });
}

export async function deleteWeightLog(id: string): Promise<void> {
  await apiDelete(`/api/tracker/weight?id=${enc(id)}`);
}

// ------------------------------------------------------------------ diary ----
export async function getDiary(fromIso: string, toIso: string): Promise<DiaryEntry[]> {
  const alias = getAlias();
  if (!alias) return [];
  const data = await apiGet<{ entries: DiaryEntry[] }>(
    `/api/tracker/diary?alias=${enc(alias)}&from=${enc(fromIso)}&to=${enc(toIso)}`
  );
  return data.entries || [];
}

export interface DiaryEntryDetail extends DiaryEntry {
  composition?: DiaryComposition;
  compositionReconstructed?: boolean;
}

export async function getDiaryEntry(id: string): Promise<DiaryEntryDetail | null> {
  try {
    return await apiGet<DiaryEntryDetail>(`/api/tracker/diary?id=${enc(id)}`);
  } catch {
    return null;
  }
}

export async function addDiaryEntry(body: Record<string, unknown>): Promise<DiaryEntry> {
  return apiPost<DiaryEntry>('/api/tracker/diary', { alias: getAlias(), ...body });
}

export async function updateComposition(body: Record<string, unknown>): Promise<DiaryEntryDetail> {
  return apiPut<DiaryEntryDetail>('/api/tracker/diary', body);
}

export async function deleteDiaryEntry(id: string): Promise<void> {
  await apiDelete(`/api/tracker/diary?id=${enc(id)}`);
}

// -------------------------------------------------------------- meal plans ----
export async function getActivePlans(activeOnIso: string): Promise<MealPlan[]> {
  const alias = getAlias();
  if (!alias) return [];
  const data = await apiGet<{ plans: MealPlan[] }>(
    `/api/tracker/meal-plans?alias=${enc(alias)}&activeOn=${enc(activeOnIso)}`
  );
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
  const params = new URLSearchParams({ kcal: String(kcal), limit: String(limit) });
  if (protein && protein > 0) params.set('protein', String(protein));
  try {
    const data = await apiGet<{ suggestions: RecipeSuggestion[] }>(`/api/tracker/recipe-suggestions?${params.toString()}`);
    return data.suggestions || [];
  } catch {
    return [];
  }
}

export interface LiveNutritionResult {
  nutrition?: { perServing?: NutritionData };
  price?: { hasAnyData?: boolean; perServing?: number };
}

export async function getLiveNutrition(recipeId: string, productAssignments: Record<string, string>): Promise<LiveNutritionResult | null> {
  try {
    return await apiPost<LiveNutritionResult>(`/api/recipes/${enc(recipeId)}/live-nutrition`, { productAssignments });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------- product search ----
export async function searchRegisterProducts(query: string, limit = 12): Promise<Product[]> {
  try {
    const data = await apiGet<Product[]>(`/api/products?q=${enc(query)}&limit=${limit}`);
    return Array.isArray(data) ? data : [];
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
    const data = await apiGet<CatalogueRow[]>(`/api/ingredients/catalogue?q=${enc(query)}&limit=${limit}`);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function linkedProducts(catalogueIngredientId: string): Promise<Product[]> {
  try {
    const data = await apiGet<Product[]>(`/api/products?ingredientId=${enc(catalogueIngredientId)}`);
    return Array.isArray(data) ? data : [];
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
    const created = await apiPost<{ id?: string }>('/api/products', {
      ean: p.ean ?? null,
      name: p.name,
      brand: p.brand ?? null,
      netGrams: p.netGrams ?? null,
      packageLabel: p.packageLabel ?? null,
      imageUrl: p.imageUrl ?? null,
      source: p.source === 'openfoodfacts' ? 'openfoodfacts' : 'manual',
      offCode: p.offCode ?? null,
      nutritionPer100g: p.nutritionPer100g ?? null,
    });
    return created?.id;
  } catch {
    return undefined;
  }
}

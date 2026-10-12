/**
 * Website island for /dashboard: the shared Dashboard with a fetch()-based
 * data source. Auth headers (X-Alias / X-Auth-Token) are added by the global
 * fetch wrapper in Layout.astro.
 */
import { useMemo } from 'react';
import { scaleNutrition } from '../lib/calorieGoal';
import type { ShoppingList } from '../types/recipe';
import type { MealPlan } from '../types/tracker';
import Dashboard from './Dashboard';
import { DashboardDataProvider, readStoredTimers, type DashboardData, type LinkProps } from './data';

const enc = encodeURIComponent;

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error || `HTTP ${res.status}`);
  return body as T;
}

function send<T>(url: string, method: string, body: unknown): Promise<T> {
  return getJson<T>(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function WebLink({ to, className, title, children }: LinkProps) {
  return (
    <a href={to} className={className} title={title}>
      {children}
    </a>
  );
}

function createWebsiteData(alias: string): DashboardData {
  let recipesCache: Promise<any[]> | null = null;
  const recipes = () => {
    recipesCache ??= getJson<any[]>('/api/recipes').catch((e) => {
      recipesCache = null;
      throw e;
    });
    return recipesCache;
  };
  const favoriteIds = () => readJson<unknown[]>('cookbook.recipes.favorites', []).filter((x): x is string => typeof x === 'string');

  return {
    platform: 'web',
    alias,
    Link: WebLink,
    navigate: (to) => {
      location.href = to;
    },

    async recipes() {
      return (await recipes())
        .filter((r) => !r.parentRecipeId)
        .map((r) => ({
          id: r.id,
          title: r.title,
          imageUrl: r.imageUrl || r.images?.[0]?.url,
          category: r.category || undefined,
          createdAt: String(r.createdAt),
          servings: Number(r.metadata?.servings) || 2
        }));
    },
    favoriteIds,

    profile: () => readJson('cookbook.tracker.profile', {}),
    async weightLogs() {
      return (await getJson<{ logs: any[] }>(`/api/tracker/weight?alias=${enc(alias)}`)).logs;
    },
    async addWeight(weightKg, loggedAt) {
      await send('/api/tracker/weight', 'POST', { alias, weightKg, loggedAt });
    },
    async diary(from, to) {
      return (await getJson<{ entries: any[] }>(`/api/tracker/diary?alias=${enc(alias)}&from=${enc(from)}&to=${enc(to)}`)).entries;
    },

    async activePlans(asOf) {
      return (await getJson<{ plans: MealPlan[] }>(`/api/tracker/meal-plans?alias=${enc(alias)}&activeOn=${enc(asOf)}`)).plans;
    },
    async plans(from, to) {
      return (await getJson<{ plans: MealPlan[] }>(`/api/tracker/meal-plans?alias=${enc(alias)}&from=${enc(from)}&to=${enc(to)}`)).plans;
    },
    async createPlan({ recipeId, scheduledAt, servings }) {
      await send('/api/tracker/meal-plans', 'POST', { alias, recipeId, scheduledAt, servings });
    },
    async deletePlan(id) {
      await getJson(`/api/tracker/meal-plans?id=${enc(id)}`, { method: 'DELETE' });
    },
    async eatPortions(plan, portions) {
      const live = await send<any>(`/api/recipes/${enc(plan.recipeId)}/live-nutrition`, 'POST', { productAssignments: plan.productAssignments || {} }).catch(() => null);
      const perServingPrice = live?.price?.hasAnyData ? Number(live.price.perServing) : NaN;
      await send('/api/tracker/diary', 'POST', {
        alias,
        source: 'plan',
        planId: plan.id,
        recipeId: plan.recipeId,
        servings: portions,
        nutrition: scaleNutrition(live?.nutrition?.perServing || {}, portions),
        eatenAt: new Date().toISOString(),
        costSnapshot: Number.isFinite(perServingPrice) ? perServingPrice * portions : undefined
      });
    },

    async budgetSuggestions(kcal, protein, limit) {
      const q = `kcal=${Math.round(kcal)}${protein ? `&protein=${Math.round(protein)}` : ''}&limit=${limit}`;
      return (await getJson<{ suggestions: any[] }>(`/api/tracker/recipe-suggestions?${q}`)).suggestions;
    },
    async recommendations({ criteria, targetMealKcal, count, seed }) {
      const enabled = Object.entries(criteria)
        .filter(([, on]) => on)
        .map(([k]) => k)
        .join(',');
      const q = `alias=${enc(alias)}&favorites=${enc(favoriteIds().join(','))}&criteria=${enc(enabled)}&targetMealKcal=${Math.round(targetMealKcal)}&count=${count}&seed=${seed}`;
      return (await getJson<{ recommendations: any[] }>(`/api/tracker/recommendations?${q}`)).recommendations;
    },
    aiWeekPlan(params) {
      return send('/api/ai/week-plan', 'POST', { ...params, alias, favorites: favoriteIds(), ai: readJson('cookbook.ai.settings', {}) });
    },

    shoppingLists: () => getJson<ShoppingList[]>('/api/shopping-lists'),
    async setListItemChecked(listId, itemId, checked) {
      // Re-read right before writing so a concurrent edit elsewhere is not lost.
      const list = await getJson<ShoppingList>(`/api/shopping-lists?id=${enc(listId)}`);
      const items = list.items.map((i) => (i.id === itemId ? { ...i, isChecked: checked } : i));
      await send(`/api/shopping-lists?id=${enc(listId)}`, 'PUT', { items });
    },
    async createListFromRecipes(title, list) {
      const servings = new Map<string, number>();
      for (const r of list) servings.set(r.recipeId, (servings.get(r.recipeId) ?? 0) + r.servings);
      const created = await send<{ id: string }>('/api/shopping-lists', 'POST', {
        title,
        recipeIds: [...servings.keys()],
        recipeServingsById: Object.fromEntries(servings)
      });
      return created.id;
    },

    async priceChanges(limit) {
      return (await getJson<{ changes: any[] }>(`/api/receipts/price-changes?limit=${limit}`)).changes;
    },

    timers: readStoredTimers,

    onDataChanged(fn) {
      // Other tabs (storage) and alias-sync updates of favorites / profile.
      const events = ['cookbook:favorites-changed', 'storage'];
      for (const e of events) window.addEventListener(e, fn);
      for (const e of events) document.addEventListener(e, fn);
      return () => {
        for (const e of events) window.removeEventListener(e, fn);
        for (const e of events) document.removeEventListener(e, fn);
      };
    }
  };
}

export default function WebsiteDashboard() {
  const alias = (() => {
    try {
      return (localStorage.getItem('cookbook.alias') || '').trim();
    } catch {
      return '';
    }
  })();
  const data = useMemo(() => createWebsiteData(alias), [alias]);
  if (!alias) {
    return (
      <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-6 text-center dark:border-yellow-700 dark:bg-yellow-900/20">
        <h1 className="mb-2 text-xl font-semibold text-yellow-900 dark:text-yellow-100">Dashboard benötigt einen Alias</h1>
        <p className="mb-4 text-sm text-yellow-800 dark:text-yellow-200">Dein Dashboard (Widgets und Anordnung) wird pro Alias gespeichert und auf deinen Geräten synchronisiert.</p>
        <button type="button" data-open-alias-settings className="rounded bg-orange-500 px-4 py-2 font-medium text-white hover:bg-orange-600">
          Alias einrichten
        </button>
      </div>
    );
  }
  return (
    <DashboardDataProvider value={data}>
      <Dashboard />
    </DashboardDataProvider>
  );
}

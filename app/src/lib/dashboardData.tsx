/**
 * Dashboard data source for the app — local-first like the rest of the app:
 * recipes, shopping lists and the tracker read/write the offline replica
 * (trackerService runs locally, rows sync per alias). Only the AI week plan
 * and the receipt price history need the server.
 */
import { Link, type NavigateFunction } from 'react-router-dom';
import { readStoredTimers, type DashboardData, type LinkProps } from '@dashboard/data';
import { scaleNutrition } from '@core/calorieGoal';
import type { CreatePlan } from '@dashboard/cooking';
import { apiGet, apiPost } from './api';
import { getAiSettings, getAlias } from './settings';
import * as tracker from './tracker';
import { addRecipesToLocalShoppingList, createLocalShoppingList, localRecipes, localShoppingList, localShoppingLists, setLocalRecipeServings, updateLocalShoppingList } from './localData';
import { onSyncDataChanged, runSync } from './syncRunner';

function AppLink({ to, className, title, children }: LinkProps) {
  return (
    <Link to={to} className={className} title={title}>
      {children}
    </Link>
  );
}

function favoriteIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('cookbook.recipes.favorites') || '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const syncSoon = () => runSync().catch(() => undefined);

/** "Gekocht" → meal-prep portions in the local tracker (needs an alias). */
export function appCreatePlan(): CreatePlan | undefined {
  if (!getAlias()) return undefined;
  return async (input) => {
    await tracker.createPlan(input);
  };
}

export function createAppDashboardData(alias: string, navigate: NavigateFunction): DashboardData {
  return {
    platform: 'app',
    alias,
    Link: AppLink,
    navigate: (to) => navigate(to),

    async recipes() {
      return (await localRecipes())
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

    profile: () => tracker.readLocalProfile(),
    weightLogs: () => tracker.getWeightLogs(),
    async addWeight(kg, at) {
      await tracker.addWeightLog(kg, at);
    },
    diary: (from, to) => tracker.getDiary(from, to),

    activePlans: (asOf) => tracker.getActivePlans(asOf),
    plans: (from, to) => tracker.getPlans(from, to),
    async createPlan(input) {
      await tracker.createPlan(input);
    },
    deletePlan: (id) => tracker.deletePlan(id),
    async eatPortions(plan, portions) {
      // Same as the tracker page's "Abstreichen".
      const live = await tracker.getLiveNutrition(plan.recipeId, plan.productAssignments || {});
      const perServingPrice = live?.price?.hasAnyData ? Number(live.price.perServing) : NaN;
      await tracker.addDiaryEntry({
        source: 'plan',
        planId: plan.id,
        recipeId: plan.recipeId,
        servings: portions,
        nutrition: scaleNutrition(live?.nutrition?.perServing || {}, portions),
        eatenAt: new Date().toISOString(),
        costSnapshot: Number.isFinite(perServingPrice) ? perServingPrice * portions : undefined
      });
    },

    budgetSuggestions: (kcal, protein, limit) => tracker.getSuggestions(kcal, protein, limit),
    recommendations: (params) => tracker.getRecommendations({ ...params, favoriteIds: favoriteIds() }),
    aiWeekPlan: (params) =>
      apiPost('/api/ai/week-plan', { ...params, alias, favorites: favoriteIds(), ai: getAiSettings() }, { timeoutMs: 120_000 }),

    shoppingLists: () => localShoppingLists(),
    async setListItemChecked(listId, itemId, checked) {
      const list = await localShoppingList(listId);
      if (!list) throw new Error('Liste nicht gefunden.');
      await updateLocalShoppingList(listId, { items: list.items.map((i) => (i.id === itemId ? { ...i, isChecked: checked } : i)) });
      syncSoon();
    },
    async createListFromRecipes(title, recipes) {
      const servings = new Map<string, number>();
      for (const r of recipes) servings.set(r.recipeId, (servings.get(r.recipeId) ?? 0) + r.servings);
      const list = await createLocalShoppingList(title);
      await addRecipesToLocalShoppingList(list.id, [...servings.keys()]);
      for (const [recipeId, n] of servings) await setLocalRecipeServings(list.id, recipeId, n);
      syncSoon();
      return list.id;
    },

    async priceChanges(limit) {
      return (await apiGet<{ changes: any[] }>(`/api/receipts/price-changes?limit=${limit}`)).changes;
    },

    timers: readStoredTimers,

    onDataChanged(fn) {
      const offSync = onSyncDataChanged(fn);
      document.addEventListener('cookbook:favorites-changed', fn);
      return () => {
        offSync();
        document.removeEventListener('cookbook:favorites-changed', fn);
      };
    }
  };
}

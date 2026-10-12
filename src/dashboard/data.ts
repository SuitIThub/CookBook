/**
 * What the dashboard widgets need from their host. The website implements it
 * with fetch() against the API (websiteData.ts), the app with its local
 * offline replica (app/src/lib/dashboardData.tsx) — the widgets are the same.
 */
import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { BodyProfile, DiaryEntry, MealPlan, WeightLog } from '../types/tracker';
import type { ShoppingList } from '../types/recipe';
import type { Recommendation, RecommendationCriteria } from '../lib/weekRecommendations';

export interface RecipeSummary {
  id: string;
  title: string;
  imageUrl?: string;
  category?: string;
  createdAt: string;
  servings: number;
}

export interface BudgetSuggestion {
  id: string;
  title: string;
  imageUrl?: string;
  kcal: number;
  protein: number;
  estimated: boolean;
}

export interface PriceChange {
  productId: string;
  productName: string;
  supermarketName: string;
  price: number;
  previousPrice: number;
  observedAt: string;
}

export interface AiPlanEntry {
  date: string;
  recipeId: string;
  title: string;
  imageUrl?: string;
  kcal?: number;
  servings: number;
  reason: string;
}

export interface DashboardTimer {
  id: string;
  label: string;
  recipeName?: string;
  /** Seconds left right now. */
  remaining: number;
  isRunning: boolean;
  isCompleted: boolean;
}

export interface LinkProps {
  to: string;
  className?: string;
  title?: string;
  children: ReactNode;
}

export interface DashboardData {
  platform: 'web' | 'app';
  alias: string;
  Link: ComponentType<LinkProps>;
  navigate(to: string): void;

  recipes(): Promise<RecipeSummary[]>;
  favoriteIds(): string[];

  profile(): BodyProfile;
  weightLogs(): Promise<WeightLog[]>;
  addWeight(weightKg: number, loggedAtIso: string): Promise<void>;
  diary(fromIso: string, toIso: string): Promise<DiaryEntry[]>;

  /** Meal-prep batches with portions left on that day. */
  activePlans(asOfIso: string): Promise<MealPlan[]>;
  /** Meal plans whose start lies in the range. */
  plans(fromIso: string, toIso: string): Promise<MealPlan[]>;
  createPlan(input: { recipeId: string; scheduledAt: string; servings: number }): Promise<void>;
  deletePlan(id: string): Promise<void>;
  /** Strike portions of a batch off: diary entry with the live nutrition snapshot. */
  eatPortions(plan: MealPlan, portions: number): Promise<void>;

  budgetSuggestions(kcal: number, protein: number | undefined, limit: number): Promise<BudgetSuggestion[]>;
  recommendations(params: { criteria: RecommendationCriteria; targetMealKcal: number; count: number; seed: number }): Promise<Recommendation[]>;
  /** Server + AI (online only). */
  aiWeekPlan(params: { criteria: RecommendationCriteria; targetMealKcal: number; count: number; startDate: string; days: number }): Promise<{ note: string; plan: AiPlanEntry[] }>;

  shoppingLists(): Promise<ShoppingList[]>;
  setListItemChecked(listId: string, itemId: string, checked: boolean): Promise<void>;
  /** New list with these recipes (portions per recipe); returns its id. */
  createListFromRecipes(title: string, recipes: { recipeId: string; servings: number }[]): Promise<string>;

  /** Server (online only). */
  priceChanges(limit: number): Promise<PriceChange[]>;

  timers(): DashboardTimer[];

  /** Called when synced data changed (another device, a background sync). */
  onDataChanged(fn: () => void): () => void;
}

const DataContext = createContext<DashboardData | null>(null);

export const DashboardDataProvider = DataContext.Provider;

export function useDashboardData(): DashboardData {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useDashboardData outside <DashboardDataProvider>');
  return ctx;
}

/** Timers persisted by the cooking-mode timers (website + app share `active-timers`). */
export function readStoredTimers(): DashboardTimer[] {
  try {
    const raw = localStorage.getItem('active-timers');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? Object.values(parsed) : [];
    const now = Date.now();
    return (list as Record<string, unknown>[])
      .filter((t) => t && typeof t.id === 'string')
      .map((t) => {
        let remaining = Number(t.remaining) || 0;
        if (t.isRunning) {
          if (Number(t.endsAt) > 0) remaining = Math.max(0, Math.round((Number(t.endsAt) - now) / 1000));
          else if (Number(t.startTime) > 0) remaining = Math.max(0, remaining - Math.round((now - Number(t.startTime)) / 1000));
        }
        return {
          id: String(t.id),
          label: String(t.label || 'Timer'),
          recipeName: typeof t.recipeName === 'string' ? t.recipeName : undefined,
          remaining,
          isRunning: !!t.isRunning && remaining > 0,
          isCompleted: !!t.isCompleted || (!!t.isRunning && remaining <= 0)
        };
      });
  } catch {
    return [];
  }
}

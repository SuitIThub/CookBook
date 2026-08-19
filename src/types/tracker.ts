import type { NutritionData } from './recipe';

/**
 * A supermarket / retailer where products can be priced.
 */
export interface Supermarket {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Catalogue ingredient (autocomplete + nutrition defaults).
 * Nutrition is stored per 100 g (LMIV/OFF convention).
 *
 * gramsByUnit is a map from a canonical unit name (see src/lib/units.ts) to
 * the gram weight of ONE unit of that kind for this ingredient. Used for
 * ingredients where converting via base units alone is impossible
 * (e.g. `Stück`, `Zehe`, `Kopf`, `Bund`, `TL`, `EL`, `Tasse`).
 * These values are estimates — nutrition/price calculations mark the whole
 * recipe as `~ estimated` as soon as any ingredient uses one.
 *
 * densityGPerMl is used when an ingredient can be measured in ml (or a
 * ml-equivalent unit like TL/EL/Tasse via the global defaults) but not by
 * weight — e.g. oil (~0.91), water (1.0), milk (~1.03).
 */
export interface CatalogueIngredient {
  id: string;
  name: string;
  description?: string;
  usageCount: number;
  nutritionPer100g?: NutritionData;
  densityGPerMl?: number;
  gramsByUnit?: Record<string, number>;
  defaultProductId?: string;
}

/**
 * Catalogue product (may correspond to a real EAN item, or a manual entry).
 * Nutrition is stored per 100 g.
 */
export interface Product {
  id: string;
  ean?: string;
  name: string;
  brand?: string;
  netGrams?: number;
  packageLabel?: string;
  nutritionPer100g?: NutritionData;
  defaultPrice?: number; // EUR per package (netGrams)
  imageUrl?: string;
  source: 'manual' | 'openfoodfacts';
  offCode?: string;
  supermarkets: ProductSupermarketPrice[];
  ingredientIds: string[]; // linked catalogue ingredients
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductSupermarketPrice {
  supermarketId: string;
  price: number; // EUR per package (Product.netGrams)
}

/**
 * Body profile stored per alias.
 * Height in cm, weight in kg, age in years, activity is Mifflin-St Jeor
 * activity multiplier (1.2 sedentary, 1.9 very active).
 * targetWeightKg + weeklyChangeKg drive the calorie goal.
 */
export interface BodyProfile {
  heightCm?: number;
  gender?: 'male' | 'female' | 'other';
  ageYears?: number;
  activity?: number;
  weeklyChangeKg?: number;
  targetWeightKg?: number;
  proteinGramsPerKg?: number; // optional override, defaults handled in calorieGoal.ts
}

export interface WeightLog {
  id: string;
  alias: string;
  loggedAt: Date;
  weightKg: number;
}

export type MealPlanStatus = 'planned' | 'eaten' | 'skipped';

export interface MealPlan {
  id: string;
  alias: string;
  recipeId: string;
  recipeTitle?: string;
  /** Start of availability (meal prep is ready from this moment onward). */
  scheduledAt: Date;
  /** Total portions prepared. Eaten over subsequent days, not all on scheduledAt. */
  servings: number;
  servingsConsumed: number;
  servingsRemaining: number;
  supermarketId?: string;
  status: MealPlanStatus;
  productAssignments: Record<string, string>; // recipeIngredientId -> productId
  reminderMinutes?: number; // minutes before scheduledAt to remind
  nutritionSnapshot?: NutritionData; // last consume snapshot; history lives in diary
  createdAt: Date;
  updatedAt: Date;
}

export type DiarySource = 'plan' | 'recipe' | 'product' | 'free';

export interface DiaryEntry {
  id: string;
  alias: string;
  eatenAt: Date;
  source: DiarySource;
  planId?: string;
  recipeId?: string;
  recipeTitle?: string;
  productId?: string;
  productName?: string;
  label?: string; // free-form label for source=free
  grams?: number; // amount consumed
  servings?: number; // for recipe/plan
  nutrition: NutritionData; // absolute snapshot of what was consumed
  createdAt: Date;
}

export interface CalorieGoal {
  bmr: number; // estimated RMR (Mifflin-St Jeor), kcal
  tdee: number; // maintenance = BMR * PAL (TEF already included)
  targetKcal: number; // kcal after applying weekly change
  minKcal: number; // unsupervised floor: estimated BMR
  warningLowKcal: number; // 1500 male / 1200 otherwise — warning, not a clamp
  targetProteinG: number;
  targetFatG: number;
  targetCarbsG: number;
  targetFiberG: number;
  targetSaltG: number;
  /** True when the raw deficit would have gone below BMR. */
  clampedToBmr: boolean;
  /** True when target is below the gender-based low-energy warning. */
  lowEnergyWarning: boolean;
}

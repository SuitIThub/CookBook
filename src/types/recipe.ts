export interface TimeEntry {
  id: string;
  label: string; // e.g., "Kochzeit", "Backzeit", "Ruhezeit", "Vorbereitungszeit"
  minutes: number;
}

export interface RecipeMetadata {
  servings: number;
  timeEntries: TimeEntry[]; // New: flexible time entries
  difficulty: 'leicht' | 'mittel' | 'schwer';
  nutrition?: NutritionData; // New: optional nutrition data
}

export interface NutritionData {
  calories?: number; // kcal per serving
  carbohydrates?: number; // grams per serving
  protein?: number; // grams per serving
  fat?: number; // grams per serving
}

export interface Quantity {
  amount: number;
  unit: string;
}

export interface Ingredient {
  id: string;
  name: string;
  description?: string;
  quantities: Quantity[];
}

export interface IngredientGroup {
  id: string;
  title?: string;
  ingredients: (Ingredient | IngredientGroup)[];
}

export interface IntermediateIngredient {
  id: string;
  name: string;
  description?: string;
}

export interface LinkedIngredient {
  ingredientId: string;
  selectedQuantityIndex: number;
  isIntermediate?: boolean; // Flag to identify intermediate ingredients
}

export interface PreparationStep {
  id: string;
  text: string;
  linkedIngredients: LinkedIngredient[];
  intermediateIngredients: IntermediateIngredient[]; // New: intermediate ingredients for this step
  timeInSeconds?: number;
}

export interface PreparationGroup {
  id: string;
  title?: string;
  steps: (PreparationStep | PreparationGroup)[];
}

export interface RecipeImage {
  id: string;
  filename: string;
  url: string;
  uploadedAt: Date;
}

export interface Recipe {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  metadata: RecipeMetadata;
  category?: string; // New: recipe category
  tags?: string[]; // New: recipe tags
  ingredientGroups: IngredientGroup[];
  preparationGroups: PreparationGroup[];
  imageUrl?: string; // Keep for backward compatibility
  images?: RecipeImage[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ShoppingListItem {
  id: string;
  ingredientName: string;
  quantity: Quantity;
  isChecked?: boolean;
}

export interface ShoppingList {
  id: string;
  title: string;
  items: ShoppingListItem[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Timer {
  id: string;
  label: string;
  duration: number; // in seconds
  remaining: number; // in seconds
  isRunning: boolean;
  isCompleted: boolean;
}

// Utility functions for time handling
export function formatTime(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} Min`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  if (remainingMinutes === 0) {
    return `${hours} Std`;
  }
  
  return `${hours} Std ${remainingMinutes} Min`;
}

export function getTotalTime(timeEntries: TimeEntry[]): number {
  return timeEntries.reduce((total, entry) => total + entry.minutes, 0);
} 
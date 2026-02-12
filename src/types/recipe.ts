export interface TimeEntry {
  id: string;
  label: string; // e.g., "Kochzeit", "Backzeit", "Ruhezeit", "Vorbereitungszeit"
  minutes: number;
}

export interface RecipeMetadata {
  servings: number;
  timeEntries: TimeEntry[]; // New: flexible time entries
  difficulty?: 'leicht' | 'mittel' | 'schwer'; // Optional: may be undefined if not extractable
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
  timer?: number; // Timer duration in minutes
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
  sourceUrl?: string; // URL of the recipe if imported via URL
  parentRecipeId?: string; // Optional: ID of the original recipe if this is a variant
  variantName?: string; // Optional: short title/name to identify this variant
  createdAt: Date;
  updatedAt: Date;
}

export interface ShoppingListItem {
  id: string;
  name: string;
  description?: string;
  quantity?: Quantity; // Optional: can be omitted for items without amount/unit
  originalQuantity?: Quantity; // Optional: original quantity from recipe before scaling
  isChecked?: boolean;
  recipeId?: string; // Optional: verknüpft Item mit Rezept
  recipeIngredientId?: string; // Optional: Original Ingredient ID aus dem Rezept
  manualGroupId?: string; // Optional: ID for manually grouped items
  note?: string; // Optional: rich text note for this product (HTML from TinyMCE)
}

export interface ShoppingListRecipe {
  id: string; // Recipe ID
  title: string;
  servings: number;
  currentServings?: number; // Optional: current number of servings (defaults to servings if not set)
  isCompleted: boolean; // Ob alle Zutaten des Rezepts markiert sind
  addedAt: Date;
}

export interface ShoppingList {
  id: string;
  title: string;
  description?: string;
  items: ShoppingListItem[];
  recipes: ShoppingListRecipe[]; // Hinzugefügte Rezepte
  // Permanent list flags:
  // permanentType: 0 = normal list, 1 = personal Sammelliste, 2 = globale Vorlage
  permanentType?: number;
  isPermanent?: boolean; // Convenience flag: true when permanentType > 0
  hasSeenGlobalTemplatePrompt?: boolean; // Whether user already saw/applied the global template prompt
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
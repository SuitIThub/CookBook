export interface RecipeMetadata {
  servings: number;
  preparationTime: number; // in minutes
  cookingTime: number; // in minutes
  difficulty: 'leicht' | 'mittel' | 'schwer';
}

export interface Quantity {
  amount: number;
  unit: string;
}

export interface Ingredient {
  id: string;
  name: string;
  quantities: Quantity[];
}

export interface IngredientGroup {
  id: string;
  title?: string;
  ingredients: (Ingredient | IngredientGroup)[];
}

export interface PreparationStep {
  id: string;
  text: string;
  linkedIngredients: { ingredientId: string; selectedQuantityIndex: number }[];
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
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Recipe, ShoppingList, ShoppingListItem, ShoppingListRecipe, Quantity } from '../types/recipe';
import { eventBus, EVENTS } from './events';

export class CookbookDatabase {
  private db: Database.Database;

  constructor(dbPath: string = './cookbook.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initTables();
  }

  private initTables(): void {
    // Recipes table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        subtitle TEXT,
        description TEXT,
        metadata TEXT,
        category TEXT,
        tags TEXT,
        ingredient_groups TEXT,
        preparation_groups TEXT,
        image_url TEXT,
        images TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Categories table for predefined categories
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        usage_count INTEGER DEFAULT 0
      )
    `);

    // Tags table for autocomplete and tracking
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS recipe_tags (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        usage_count INTEGER DEFAULT 1
      )
    `);

    // Shopping lists table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS shopping_lists (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        items TEXT,
        recipes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ingredients table for autocomplete
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ingredients (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        usage_count INTEGER DEFAULT 1
      )
    `);

    // Units table for conversions
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS units (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        category TEXT,
        base_unit TEXT,
        conversion_factor REAL
      )
    `);
  }

  // Recipe CRUD operations
  createRecipe(recipe: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>): Recipe {
    const id = uuidv4();
    const now = new Date();
    const newRecipe: Recipe = {
      ...recipe,
      id,
      createdAt: now,
      updatedAt: now
    };

    const stmt = this.db.prepare(`
      INSERT INTO recipes (id, title, subtitle, description, metadata, category, tags, ingredient_groups, preparation_groups, image_url, images, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      newRecipe.id,
      newRecipe.title,
      newRecipe.subtitle,
      newRecipe.description,
      JSON.stringify(newRecipe.metadata),
      newRecipe.category,
      JSON.stringify(newRecipe.tags || []),
      JSON.stringify(newRecipe.ingredientGroups),
      JSON.stringify(newRecipe.preparationGroups),
      newRecipe.imageUrl,
      JSON.stringify(newRecipe.images || []),
      newRecipe.createdAt.toISOString(),
      newRecipe.updatedAt.toISOString()
    );

    // Add ingredients to autocomplete
    this.addIngredientsToAutocomplete(newRecipe.ingredientGroups);

    // Update category and tags usage count
    if (newRecipe.category) {
      this.updateCategoryUsage(newRecipe.category);
    }
    if (newRecipe.tags && newRecipe.tags.length > 0) {
      this.updateTagsUsage(newRecipe.tags);
    }

    return newRecipe;
  }

  getRecipe(id: string): Recipe | null {
    const stmt = this.db.prepare('SELECT * FROM recipes WHERE id = ?');
    const row = stmt.get(id) as any;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      subtitle: row.subtitle,
      description: row.description,
      metadata: JSON.parse(row.metadata),
      category: row.category,
      tags: row.tags ? JSON.parse(row.tags) : [],
      ingredientGroups: JSON.parse(row.ingredient_groups),
      preparationGroups: JSON.parse(row.preparation_groups),
      imageUrl: row.image_url,
      images: row.images ? JSON.parse(row.images) : [],
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  getAllRecipes(): Recipe[] {
    const stmt = this.db.prepare('SELECT * FROM recipes ORDER BY updated_at DESC');
    const rows = stmt.all() as any[];

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      subtitle: row.subtitle,
      description: row.description,
      metadata: JSON.parse(row.metadata),
      category: row.category,
      tags: row.tags ? JSON.parse(row.tags) : [],
      ingredientGroups: JSON.parse(row.ingredient_groups),
      preparationGroups: JSON.parse(row.preparation_groups),
      imageUrl: row.image_url,
      images: row.images ? JSON.parse(row.images) : [],
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    }));
  }

  updateRecipe(id: string, updates: Partial<Recipe>): Recipe | null {
    const existingRecipe = this.getRecipe(id);
    if (!existingRecipe) {
      return null;
    }

    const updatedRecipe = {
      ...existingRecipe,
      ...updates,
      updatedAt: new Date()
    };

    const stmt = this.db.prepare(`
      UPDATE recipes 
      SET title = ?, subtitle = ?, description = ?, metadata = ?, category = ?, tags = ?,
          ingredient_groups = ?, preparation_groups = ?, image_url = ?, images = ?, updated_at = ?
      WHERE id = ?
    `);

    const result = stmt.run(
      updatedRecipe.title,
      updatedRecipe.subtitle,
      updatedRecipe.description,
      JSON.stringify(updatedRecipe.metadata),
      updatedRecipe.category,
      JSON.stringify(updatedRecipe.tags || []),
      JSON.stringify(updatedRecipe.ingredientGroups),
      JSON.stringify(updatedRecipe.preparationGroups),
      updatedRecipe.imageUrl,
      JSON.stringify(updatedRecipe.images || []),
      updatedRecipe.updatedAt.toISOString(),
      id
    );

    // Check if the update actually affected any rows
    if (result.changes === 0) {
      console.error('Database update failed - no rows affected');
      return null;
    }

    // Update ingredients autocomplete
    if (updates.ingredientGroups) {
      this.addIngredientsToAutocomplete(updates.ingredientGroups);
    }

    // Update category and tags usage count
    if (updates.category) {
      this.updateCategoryUsage(updates.category);
    }
    if (updates.tags) {
      this.updateTagsUsage(updates.tags);
    }

    return updatedRecipe;
  }

  deleteRecipe(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM recipes WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // Shopping list operations
  createShoppingList(title: string, description?: string): ShoppingList {
    const id = uuidv4();
    const now = new Date();
    const shoppingList: ShoppingList = {
      id,
      title,
      description,
      items: [],
      recipes: [],
      createdAt: now,
      updatedAt: now
    };

    const stmt = this.db.prepare(`
      INSERT INTO shopping_lists (id, title, description, items, recipes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      shoppingList.id,
      shoppingList.title,
      shoppingList.description,
      JSON.stringify(shoppingList.items),
      JSON.stringify(shoppingList.recipes),
      shoppingList.createdAt.toISOString(),
      shoppingList.updatedAt.toISOString()
    );

    // Emit event for new shopping list
    eventBus.emit(EVENTS.SHOPPING_LIST_CREATED, { list: shoppingList });

    return shoppingList;
  }

  getShoppingList(id: string): ShoppingList | null {
    const stmt = this.db.prepare('SELECT * FROM shopping_lists WHERE id = ?');
    const row = stmt.get(id) as any;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      items: JSON.parse(row.items),
      recipes: row.recipes ? JSON.parse(row.recipes) : [],
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  getAllShoppingLists(): ShoppingList[] {
    const stmt = this.db.prepare('SELECT * FROM shopping_lists ORDER BY updated_at DESC');
    const rows = stmt.all() as any[];

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      items: JSON.parse(row.items),
      recipes: row.recipes ? JSON.parse(row.recipes) : [],
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    }));
  }

  updateShoppingList(id: string, updates: Partial<ShoppingList>): ShoppingList | null {
    const existingList = this.getShoppingList(id);
    if (!existingList) {
      return null;
    }

    const updatedList = {
      ...existingList,
      ...updates,
      updatedAt: new Date()
    };

    const stmt = this.db.prepare(`
      UPDATE shopping_lists 
      SET title = ?, description = ?, items = ?, recipes = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      updatedList.title,
      updatedList.description,
      JSON.stringify(updatedList.items),
      JSON.stringify(updatedList.recipes),
      updatedList.updatedAt.toISOString(),
      id
    );

    // Emit event for shopping list update
    eventBus.emit(EVENTS.SHOPPING_LIST_UPDATED, { listId: id, list: updatedList });

    return updatedList;
  }

  deleteShoppingList(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM shopping_lists WHERE id = ?');
    const result = stmt.run(id);
    
    if (result.changes > 0) {
      // Emit event for shopping list deletion
      eventBus.emit(EVENTS.SHOPPING_LIST_DELETED, { listId: id });
    }
    
    return result.changes > 0;
  }

  addItemToShoppingList(listId: string, item: Omit<ShoppingListItem, 'id'>): ShoppingList | null {
    const list = this.getShoppingList(listId);
    if (!list) {
      return null;
    }

    const newItem: ShoppingListItem = {
      ...item,
      id: uuidv4()
    };

    list.items.push(newItem);
    return this.updateShoppingList(listId, { items: list.items });
  }

  // Recipe management for shopping lists
  addRecipeToShoppingList(listId: string, recipeId: string): ShoppingList | null {
    const shoppingList = this.getShoppingList(listId);
    const recipe = this.getRecipe(recipeId);
    
    if (!shoppingList || !recipe) {
      return null;
    }

    // Check if recipe is already in list
    if (shoppingList.recipes.some(r => r.id === recipeId)) {
      return shoppingList;
    }

    // Add recipe to list
    const shoppingListRecipe: ShoppingListRecipe = {
      id: recipe.id,
      title: recipe.title,
      servings: recipe.metadata.servings,
      currentServings: recipe.metadata.servings,
      isCompleted: false,
      addedAt: new Date()
    };

    shoppingList.recipes.push(shoppingListRecipe);

    // Extract and add ingredients
    const extractIngredients = (groups: any[]): void => {
      groups.forEach(group => {
        if (group.ingredients) {
          group.ingredients.forEach((item: any) => {
            if (item.ingredients) {
              // It's a nested group
              extractIngredients([item]);
            } else if (item.name && item.quantities && item.quantities.length > 0) {
              // It's an ingredient with quantities
              item.quantities.forEach((quantity: Quantity) => {
                const shoppingItem: ShoppingListItem = {
                  id: uuidv4(),
                  name: item.name,
                  description: item.description,
                  quantity: { ...quantity },
                  originalQuantity: { ...quantity },
                  isChecked: false,
                  recipeId: recipe.id,
                  recipeIngredientId: item.id
                };
                shoppingList.items.push(shoppingItem);
              });
            }
          });
        }
      });
    };

    extractIngredients(recipe.ingredientGroups);

    // Save updated shopping list
    const stmt = this.db.prepare(`
      UPDATE shopping_lists 
      SET items = ?, recipes = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      JSON.stringify(shoppingList.items),
      JSON.stringify(shoppingList.recipes),
      new Date().toISOString(),
      listId
    );

    // Notify about the update
    eventBus.emit(EVENTS.SHOPPING_LIST_UPDATED, { listId });

    return shoppingList;
  }

  removeRecipeFromShoppingList(listId: string, recipeId: string): ShoppingList | null {
    const shoppingList = this.getShoppingList(listId);
    if (!shoppingList) {
      return null;
    }

    // Remove recipe from recipes list
    shoppingList.recipes = shoppingList.recipes.filter(r => r.id !== recipeId);
    
    // Remove all items associated with this recipe
    shoppingList.items = shoppingList.items.filter(item => item.recipeId !== recipeId);

    return this.updateShoppingList(listId, { 
      items: shoppingList.items, 
      recipes: shoppingList.recipes 
    });
  }

  toggleRecipeCompletion(listId: string, recipeId: string, isCompleted: boolean): ShoppingList | null {
    const shoppingList = this.getShoppingList(listId);
    if (!shoppingList) {
      return null;
    }

    // Update recipe completion status
    const recipe = shoppingList.recipes.find(r => r.id === recipeId);
    if (recipe) {
      recipe.isCompleted = isCompleted;
    }

    // Update all items from this recipe
    shoppingList.items.forEach(item => {
      if (item.recipeId === recipeId) {
        item.isChecked = isCompleted;
      }
    });

    return this.updateShoppingList(listId, { 
      items: shoppingList.items, 
      recipes: shoppingList.recipes 
    });
  }

  // Ingredient autocomplete
  searchIngredients(query: string): string[] {
    const stmt = this.db.prepare(`
      SELECT name FROM ingredients 
      WHERE name LIKE ? 
      ORDER BY usage_count DESC 
      LIMIT 20
    `);
    const rows = stmt.all(`%${query}%`) as any[];
    return rows.map(row => row.name);
  }

  private addIngredientsToAutocomplete(ingredientGroups: any[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ingredients (id, name, description, usage_count) 
      VALUES (?, ?, ?, COALESCE((SELECT usage_count FROM ingredients WHERE name = ?) + 1, 1))
    `);

    ingredientGroups.forEach(group => {
      group.ingredients.forEach((ingredient: any) => {
        if (ingredient.name) {
          stmt.run(uuidv4(), ingredient.name, ingredient.description, ingredient.name);
        }
      });
    });
  }

  // Category methods
  getAllCategories(): string[] {
    const stmt = this.db.prepare(`
      SELECT name FROM categories 
      ORDER BY usage_count DESC, name ASC
    `);
    const rows = stmt.all() as any[];
    return rows.map(row => row.name);
  }

  private updateCategoryUsage(category: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO categories (id, name, usage_count) 
      VALUES (?, ?, COALESCE((SELECT usage_count FROM categories WHERE name = ?) + 1, 1))
    `);
    stmt.run(uuidv4(), category, category);
  }

  // Tag methods
  searchTags(query: string): string[] {
    const stmt = this.db.prepare(`
      SELECT name FROM recipe_tags 
      WHERE name LIKE ? 
      ORDER BY usage_count DESC 
      LIMIT 10
    `);
    const rows = stmt.all(`%${query}%`) as any[];
    return rows.map(row => row.name);
  }

  getAllTags(): string[] {
    const stmt = this.db.prepare(`
      SELECT name FROM recipe_tags 
      ORDER BY usage_count DESC, name ASC
    `);
    const rows = stmt.all() as any[];
    return rows.map(row => row.name);
  }

  private updateTagsUsage(tags: string[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO recipe_tags (id, name, usage_count) 
      VALUES (?, ?, COALESCE((SELECT usage_count FROM recipe_tags WHERE name = ?) + 1, 1))
    `);
    
    tags.forEach(tag => {
      stmt.run(uuidv4(), tag, tag);
    });
  }

  updateRecipeServingsInShoppingList(listId: string, recipeId: string, newServings: number): ShoppingList | null {
    const shoppingList = this.getShoppingList(listId);
    if (!shoppingList) return null;

    // Find the recipe in the shopping list
    const shoppingListRecipe = shoppingList.recipes.find(r => r.id === recipeId);
    if (!shoppingListRecipe) return null;

    // Calculate scaling factor using the original servings from the shopping list recipe
    const originalServings = shoppingListRecipe.servings;
    const scalingFactor = newServings / originalServings;

    // Update recipe servings in shopping list
    shoppingListRecipe.currentServings = newServings;

    // Update quantities of items from this recipe
    shoppingList.items = shoppingList.items.map(item => {
      if (item.recipeId === recipeId && item.originalQuantity) {
        return {
          ...item,
          quantity: {
            ...item.quantity,
            amount: parseFloat((item.originalQuantity.amount * scalingFactor).toFixed(2))
          }
        };
      }
      return item;
    });

    // Save the updated shopping list
    const stmt = this.db.prepare(`
      UPDATE shopping_lists 
      SET items = ?, recipes = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      JSON.stringify(shoppingList.items),
      JSON.stringify(shoppingList.recipes),
      new Date().toISOString(),
      listId
    );

    // Notify about the update
    eventBus.emit(EVENTS.SHOPPING_LIST_UPDATED, { listId });

    return shoppingList;
  }

  close(): void {
    this.db.close();
  }
}

// Create a singleton instance
export const db = new CookbookDatabase();
export default CookbookDatabase; 
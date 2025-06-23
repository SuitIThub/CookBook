import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Recipe, ShoppingList, ShoppingListItem } from '../types/recipe';

class CookbookDatabase {
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
        ingredient_groups TEXT,
        preparation_groups TEXT,
        image_url TEXT,
        images TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Shopping lists table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS shopping_lists (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        items TEXT,
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
      INSERT INTO recipes (id, title, subtitle, description, metadata, ingredient_groups, preparation_groups, image_url, images, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      newRecipe.id,
      newRecipe.title,
      newRecipe.subtitle,
      newRecipe.description,
      JSON.stringify(newRecipe.metadata),
      JSON.stringify(newRecipe.ingredientGroups),
      JSON.stringify(newRecipe.preparationGroups),
      newRecipe.imageUrl,
      JSON.stringify(newRecipe.images || []),
      newRecipe.createdAt.toISOString(),
      newRecipe.updatedAt.toISOString()
    );

    // Add ingredients to autocomplete
    this.addIngredientsToAutocomplete(newRecipe.ingredientGroups);

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
      SET title = ?, subtitle = ?, description = ?, metadata = ?, 
          ingredient_groups = ?, preparation_groups = ?, image_url = ?, images = ?, updated_at = ?
      WHERE id = ?
    `);

    const result = stmt.run(
      updatedRecipe.title,
      updatedRecipe.subtitle,
      updatedRecipe.description,
      JSON.stringify(updatedRecipe.metadata),
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

    return updatedRecipe;
  }

  deleteRecipe(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM recipes WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // Shopping list operations
  createShoppingList(title: string): ShoppingList {
    const id = uuidv4();
    const now = new Date();
    const shoppingList: ShoppingList = {
      id,
      title,
      items: [],
      createdAt: now,
      updatedAt: now
    };

    const stmt = this.db.prepare(`
      INSERT INTO shopping_lists (id, title, items, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      shoppingList.id,
      shoppingList.title,
      JSON.stringify(shoppingList.items),
      shoppingList.createdAt.toISOString(),
      shoppingList.updatedAt.toISOString()
    );

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
      items: JSON.parse(row.items),
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
      items: JSON.parse(row.items),
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
      SET title = ?, items = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      updatedList.title,
      JSON.stringify(updatedList.items),
      updatedList.updatedAt.toISOString(),
      id
    );

    return updatedList;
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

  close(): void {
    this.db.close();
  }
}

// Create a singleton instance
export const db = new CookbookDatabase();
export default CookbookDatabase; 
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
        source_url TEXT,
        parent_recipe_id TEXT,
        variant_name TEXT,
        is_draft INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migration: ensure new columns for recipe variants exist on existing databases
    try {
      this.db.exec(`ALTER TABLE recipes ADD COLUMN parent_recipe_id TEXT`);
    } catch (error) {
      // Ignore error if column already exists
    }
    try {
      this.db.exec(`ALTER TABLE recipes ADD COLUMN variant_name TEXT`);
    } catch (error) {
      // Ignore error if column already exists
    }

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
        is_permanent INTEGER NOT NULL DEFAULT 0,
        has_seen_global_template_prompt INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    try {
      this.db.exec('ALTER TABLE shopping_lists ADD COLUMN is_permanent INTEGER NOT NULL DEFAULT 0');
    } catch {
      // Column already exists
    }
    try {
      this.db.exec('ALTER TABLE shopping_lists ADD COLUMN has_seen_global_template_prompt INTEGER NOT NULL DEFAULT 0');
    } catch {
      // Column already exists
    }

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

    // Global timers table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS global_timers (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        duration INTEGER NOT NULL,
        remaining INTEGER NOT NULL,
        is_running INTEGER NOT NULL DEFAULT 0,
        is_completed INTEGER NOT NULL DEFAULT 0,
        recipe_name TEXT,
        step_description TEXT,
        recipe_id TEXT,
        step_id TEXT,
        start_time INTEGER,
        pause_time INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Recipe drafts table - just references to draft recipes
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS recipe_drafts (
        recipe_id TEXT PRIMARY KEY,
        draft_recipe_id TEXT NOT NULL UNIQUE,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
        FOREIGN KEY (draft_recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
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
      INSERT INTO recipes (id, title, subtitle, description, metadata, category, tags, ingredient_groups, preparation_groups, image_url, images, source_url, parent_recipe_id, variant_name, is_draft, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      newRecipe.sourceUrl,
      newRecipe.parentRecipeId || null,
      newRecipe.variantName || null,
      0, // is_draft = false for regular recipes
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
    const stmt = this.db.prepare('SELECT * FROM recipes WHERE id = ? AND is_draft = 0');
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
      sourceUrl: row.source_url,
      parentRecipeId: row.parent_recipe_id || undefined,
      variantName: row.variant_name || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
  
  // Get recipe including drafts (for internal use)
  getRecipeIncludingDraft(id: string): Recipe | null {
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
      sourceUrl: row.source_url,
      parentRecipeId: row.parent_recipe_id || undefined,
      variantName: row.variant_name || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  getAllRecipes(): Recipe[] {
    const stmt = this.db.prepare('SELECT * FROM recipes WHERE is_draft = 0 ORDER BY updated_at DESC');
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
      sourceUrl: row.source_url,
      parentRecipeId: row.parent_recipe_id || undefined,
      variantName: row.variant_name || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    }));
  }

  getRecipeBySourceUrl(sourceUrl: string): Recipe | null {
    const stmt = this.db.prepare('SELECT * FROM recipes WHERE source_url = ? AND is_draft = 0');
    const row = stmt.get(sourceUrl) as any;

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
      sourceUrl: row.source_url,
      parentRecipeId: row.parent_recipe_id || undefined,
      variantName: row.variant_name || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  /**
   * Get all non-draft variants for a given original recipe.
   */
  getVariantsForRecipe(parentId: string): Recipe[] {
    const stmt = this.db.prepare('SELECT * FROM recipes WHERE parent_recipe_id = ? AND is_draft = 0 ORDER BY created_at ASC');
    const rows = stmt.all(parentId) as any[];

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
      sourceUrl: row.source_url,
      parentRecipeId: row.parent_recipe_id || undefined,
      variantName: row.variant_name || undefined,
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
          ingredient_groups = ?, preparation_groups = ?, image_url = ?, images = ?, source_url = ?, parent_recipe_id = ?, variant_name = ?, updated_at = ?
      WHERE id = ? AND is_draft = 0
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
      updatedRecipe.sourceUrl,
      updatedRecipe.parentRecipeId || null,
      updatedRecipe.variantName || null,
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
      INSERT INTO shopping_lists (id, title, description, items, recipes, is_permanent, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
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

    return this.shoppingListFromRow(row);
  }

  private shoppingListFromRow(row: any): ShoppingList {
    const items = row.items ? JSON.parse(row.items) : [];
    const permanentType = row.is_permanent != null ? Number(row.is_permanent) : 0;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      items,
      recipes: row.recipes ? JSON.parse(row.recipes) : [],
      permanentType,
      isPermanent: permanentType > 0,
      hasSeenGlobalTemplatePrompt: !!(row.has_seen_global_template_prompt ?? 0),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  getAllShoppingLists(): ShoppingList[] {
    const stmt = this.db.prepare('SELECT * FROM shopping_lists ORDER BY is_permanent DESC, updated_at DESC');
    const rows = stmt.all() as any[];

    return rows.map(row => this.shoppingListFromRow(row));
  }

  /** Returns the permanent shopping list (Sammelliste), or null if not found. */
  getPermanentShoppingList(): ShoppingList | null {
    const PERMANENT_LIST_ID = 'permanent-shopping-list';
    return this.getShoppingList(PERMANENT_LIST_ID);
  }

  /** Returns the global template shopping list, or null if not found. */
  getGlobalTemplateShoppingList(): ShoppingList | null {
    const GLOBAL_TEMPLATE_LIST_ID = 'global-template-shopping-list';
    return this.getShoppingList(GLOBAL_TEMPLATE_LIST_ID);
  }

  updateShoppingList(id: string, updates: Partial<ShoppingList>): ShoppingList | null {
    const existingList = this.getShoppingList(id);
    if (!existingList) {
      return null;
    }

    let mergedItems = updates.items !== undefined ? updates.items : existingList.items;
    const mergedHasSeenGlobalTemplatePrompt =
      updates.hasSeenGlobalTemplatePrompt !== undefined
        ? updates.hasSeenGlobalTemplatePrompt
        : existingList.hasSeenGlobalTemplatePrompt ?? false;
    // Permanent list: items cannot be crossed off – force isChecked to false
    if (existingList.isPermanent && mergedItems.length > 0) {
      mergedItems = mergedItems.map(item => ({ ...item, isChecked: false }));
    }

    const updatedList = {
      ...existingList,
      ...updates,
      items: mergedItems,
      hasSeenGlobalTemplatePrompt: mergedHasSeenGlobalTemplatePrompt,
      updatedAt: new Date()
    };

    const stmt = this.db.prepare(`
      UPDATE shopping_lists 
      SET title = ?, description = ?, items = ?, recipes = ?, is_permanent = ?, has_seen_global_template_prompt = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      updatedList.title,
      updatedList.description,
      JSON.stringify(updatedList.items),
      JSON.stringify(updatedList.recipes),
      updatedList.permanentType ?? (updatedList.isPermanent ? 1 : 0),
      mergedHasSeenGlobalTemplatePrompt ? 1 : 0,
      updatedList.updatedAt.toISOString(),
      id
    );

    // Emit event for shopping list update
    eventBus.emit(EVENTS.SHOPPING_LIST_UPDATED, { listId: id, list: updatedList });

    return updatedList;
  }

  deleteShoppingList(id: string): boolean {
    const list = this.getShoppingList(id);
    if (list?.isPermanent) {
      return false; // Permanent list cannot be deleted
    }
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

    // Build display title: include variant name when this is a variant
    const displayTitle = recipe.variantName
      ? `${recipe.title} - ${recipe.variantName}`
      : recipe.title;

    // Add recipe to list
    const shoppingListRecipe: ShoppingListRecipe = {
      id: recipe.id,
      title: displayTitle,
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

  /**
   * Transfer items and recipes from the permanent list to a normal shopping list.
   * Standalone products and recipes not yet on the target are moved.
   * Recipes already on the target are either skipped (and returned in duplicateRecipeIds)
   * or merged by adding portions when their id is in addPortionsForRecipeIds.
   * Returns { duplicateRecipeIds, transferredItemCount, transferredRecipeCount }.
   */
  transferFromPermanentList(
    targetListId: string,
    addPortionsForRecipeIds: string[] = []
  ): { duplicateRecipeIds: string[]; transferredItemCount: number; transferredRecipeCount: number } | null {
    const PERMANENT_LIST_ID = 'permanent-shopping-list';
    const permanent = this.getPermanentShoppingList();
    let target = this.getShoppingList(targetListId);
    if (!permanent || !target || target.isPermanent || targetListId === PERMANENT_LIST_ID) {
      return null;
    }

    let transferredItemCount = 0;
    let transferredRecipeCount = 0;
    const duplicateRecipeIds: string[] = [];
    let permanentItems = [...permanent.items];
    let permanentRecipes = [...(permanent.recipes || [])];

    // Standalone products (no recipeId): add to target and remove from permanent
    const standaloneItems = permanentItems.filter(item => !item.recipeId);
    for (const item of standaloneItems) {
      const { id: _id, ...itemWithoutId } = item;
      this.addItemToShoppingList(targetListId, { ...itemWithoutId, isChecked: false });
      transferredItemCount++;
    }
    permanentItems = permanentItems.filter(item => item.recipeId != null);

    // Recipes: add new ones; for duplicates either add portions or record for user
    const permRecipesToProcess = [...permanentRecipes];
    for (const permRecipe of permRecipesToProcess) {
      target = this.getShoppingList(targetListId)!;
      const targetRecipeIds = new Set((target.recipes || []).map(r => r.id));
      const recipeId = permRecipe.id;
      if (!targetRecipeIds.has(recipeId)) {
        this.addRecipeToShoppingList(targetListId, recipeId);
        transferredRecipeCount++;
        permanentRecipes = permanentRecipes.filter(r => r.id !== recipeId);
        permanentItems = permanentItems.filter(item => item.recipeId !== recipeId);
      } else if (addPortionsForRecipeIds.includes(recipeId)) {
        const targetRecipe = this.getShoppingList(targetListId)!.recipes.find(r => r.id === recipeId)!;
        const newServings = (targetRecipe.currentServings ?? targetRecipe.servings) + (permRecipe.currentServings ?? permRecipe.servings);
        this.updateRecipeServingsInShoppingList(targetListId, recipeId, newServings);
        transferredRecipeCount++;
        permanentRecipes = permanentRecipes.filter(r => r.id !== recipeId);
        permanentItems = permanentItems.filter(item => item.recipeId !== recipeId);
      } else {
        duplicateRecipeIds.push(recipeId);
      }
    }

    this.updateShoppingList(PERMANENT_LIST_ID, { items: permanentItems, recipes: permanentRecipes });

    return { duplicateRecipeIds, transferredItemCount, transferredRecipeCount };
  }

  /**
   * Apply the global template shopping list to a normal list.
   * Products and recipes are copied but NOT removed from the template list.
   * Recipes that already exist on the target list are skipped.
   */
  applyGlobalTemplateToList(targetListId: string): { copiedItemCount: number; copiedRecipeCount: number } | null {
    const GLOBAL_TEMPLATE_LIST_ID = 'global-template-shopping-list';
    const template = this.getGlobalTemplateShoppingList();
    const target = this.getShoppingList(targetListId);
    if (!template || !target || target.isPermanent || target.id === GLOBAL_TEMPLATE_LIST_ID) {
      return null;
    }

    let copiedItemCount = 0;
    let copiedRecipeCount = 0;

    // Copy standalone products (no recipeId)
    const standaloneItems = template.items.filter(item => !item.recipeId);
    for (const item of standaloneItems) {
      const { id: _id, ...itemWithoutId } = item;
      this.addItemToShoppingList(targetListId, { ...itemWithoutId, isChecked: false });
      copiedItemCount++;
    }

    // Copy recipes that are not yet on the target list
    const targetRecipeIds = new Set((target.recipes || []).map(r => r.id));
    for (const tplRecipe of template.recipes || []) {
      if (!targetRecipeIds.has(tplRecipe.id)) {
        this.addRecipeToShoppingList(targetListId, tplRecipe.id);
        copiedRecipeCount++;
      }
    }

    return { copiedItemCount, copiedRecipeCount };
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

  // Get all unique ingredients from all recipes
  getAllIngredientsFromRecipes(): Array<{ name: string; usageCount: number }> {
    const recipes = this.getAllRecipes();
    const ingredientMap = new Map<string, number>();

    const extractIngredients = (groups: any[]): void => {
      groups.forEach(group => {
        if (group.ingredients) {
          group.ingredients.forEach((item: any) => {
            if (item.ingredients) {
              // It's a nested group
              extractIngredients([item]);
            } else if (item.name) {
              // It's an ingredient
              const currentCount = ingredientMap.get(item.name) || 0;
              ingredientMap.set(item.name, currentCount + 1);
            }
          });
        }
      });
    };

    recipes.forEach(recipe => {
      extractIngredients(recipe.ingredientGroups);
    });

    return Array.from(ingredientMap.entries())
      .map(([name, usageCount]) => ({ name, usageCount }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // Get all recipes that contain a specific ingredient
  getRecipesByIngredient(ingredientName: string): Array<{ id: string; title: string }> {
    const recipes = this.getAllRecipes();
    const matchingRecipes: Array<{ id: string; title: string }> = [];

    const hasIngredient = (groups: any[]): boolean => {
      for (const group of groups) {
        if (group.ingredients) {
          for (const item of group.ingredients) {
            if (item.ingredients) {
              // It's a nested group
              if (hasIngredient([item])) {
                return true;
              }
            } else if (item.name === ingredientName) {
              return true;
            }
          }
        }
      }
      return false;
    };

    recipes.forEach(recipe => {
      if (hasIngredient(recipe.ingredientGroups)) {
        matchingRecipes.push({
          id: recipe.id,
          title: recipe.title
        });
      }
    });

    return matchingRecipes.sort((a, b) => a.title.localeCompare(b.title));
  }

  // Unify ingredients: replace oldName with newName in all recipes
  unifyIngredients(oldName: string, newName: string): { updated: number; shoppingListsUpdated: number } {
    const recipes = this.getAllRecipes();
    let updatedCount = 0;

    const replaceIngredientName = (groups: any[]): boolean => {
      let changed = false;
      groups.forEach(group => {
        if (group.ingredients) {
          group.ingredients.forEach((item: any) => {
            if (item.ingredients) {
              // It's a nested group
              if (replaceIngredientName([item])) {
                changed = true;
              }
            } else if (item.name === oldName) {
              // Replace the ingredient name
              item.name = newName;
              changed = true;
            }
          });
        }
      });
      return changed;
    };

    recipes.forEach(recipe => {
      if (replaceIngredientName(recipe.ingredientGroups)) {
        this.updateRecipe(recipe.id, { ingredientGroups: recipe.ingredientGroups });
        updatedCount++;
      }
    });

    // Update shopping lists: replace old ingredient name with new name in all shopping list items
    const shoppingLists = this.getAllShoppingLists();
    let updatedShoppingLists = 0;
    shoppingLists.forEach(list => {
      let changed = false;
      list.items.forEach(item => {
        if (item.name === oldName) {
          item.name = newName;
          changed = true;
        }
      });
      if (changed) {
        this.updateShoppingList(list.id, { items: list.items });
        updatedShoppingLists++;
      }
    });

    // Update ingredients table: remove old name, update new name usage count
    const deleteOldStmt = this.db.prepare('DELETE FROM ingredients WHERE name = ?');
    deleteOldStmt.run(oldName);

    // Get current usage count for new name
    const getCurrentCountStmt = this.db.prepare('SELECT usage_count FROM ingredients WHERE name = ?');
    const currentRow = getCurrentCountStmt.get(newName) as { usage_count: number } | undefined;
    const currentCount = currentRow?.usage_count || 0;

    // Update new name usage count (add the number of recipes that were updated)
    const updateNewStmt = this.db.prepare(`
      INSERT OR REPLACE INTO ingredients (id, name, description, usage_count) 
      VALUES (?, ?, ?, ?)
    `);
    updateNewStmt.run(uuidv4(), newName, null, currentCount + updatedCount);

    return { updated: updatedCount, shoppingListsUpdated: updatedShoppingLists };
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
      if (item.recipeId === recipeId && item.originalQuantity && item.quantity) {
        return {
          ...item,
          quantity: {
            amount: parseFloat((item.originalQuantity.amount * scalingFactor).toFixed(2)),
            unit: item.quantity.unit
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

  /**
   * Health check method to verify database connectivity
   */
  healthCheck(): { healthy: boolean; error?: string } {
    try {
      const result = this.db.prepare('SELECT 1 as health').get();
      return { healthy: !!result };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get basic statistics about the database
   */
  getStats(): { recipes: number; shoppingLists: number } {
    try {
      const recipeCount = this.db.prepare('SELECT COUNT(*) as count FROM recipes').get() as { count: number };
      const shoppingListCount = this.db.prepare('SELECT COUNT(*) as count FROM shopping_lists').get() as { count: number };
      return {
        recipes: recipeCount.count,
        shoppingLists: shoppingListCount.count
      };
    } catch (error) {
      console.error('Error getting database stats:', error);
      return { recipes: 0, shoppingLists: 0 };
    }
  }

  // Global Timer operations
  createGlobalTimer(timer: {
    id: string;
    label: string;
    duration: number;
    remaining: number;
    isRunning: boolean;
    isCompleted: boolean;
    recipeName?: string;
    stepDescription?: string;
    recipeId?: string;
    stepId?: string;
    startTime?: number;
    pauseTime?: number;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO global_timers (
        id, label, duration, remaining, is_running, is_completed,
        recipe_name, step_description, recipe_id, step_id,
        start_time, pause_time, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    stmt.run(
      timer.id,
      timer.label,
      timer.duration,
      timer.remaining,
      timer.isRunning ? 1 : 0,
      timer.isCompleted ? 1 : 0,
      timer.recipeName || null,
      timer.stepDescription || null,
      timer.recipeId || null,
      timer.stepId || null,
      timer.startTime || null,
      timer.pauseTime || null
    );

    eventBus.emit(EVENTS.GLOBAL_TIMER_CREATED, { timer });
  }

  getAllGlobalTimers(): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM global_timers 
      WHERE is_completed = 0 
      ORDER BY created_at DESC
    `);
    const rows = stmt.all() as any[];

    return rows.map(row => ({
      id: row.id,
      label: row.label,
      duration: row.duration,
      remaining: row.remaining,
      isRunning: row.is_running === 1,
      isCompleted: row.is_completed === 1,
      recipeName: row.recipe_name,
      stepDescription: row.step_description,
      recipeId: row.recipe_id,
      stepId: row.step_id,
      startTime: row.start_time,
      pauseTime: row.pause_time,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  getGlobalTimer(id: string): any | null {
    const stmt = this.db.prepare('SELECT * FROM global_timers WHERE id = ?');
    const row = stmt.get(id) as any;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      label: row.label,
      duration: row.duration,
      remaining: row.remaining,
      isRunning: row.is_running === 1,
      isCompleted: row.is_completed === 1,
      recipeName: row.recipe_name,
      stepDescription: row.step_description,
      recipeId: row.recipe_id,
      stepId: row.step_id,
      startTime: row.start_time,
      pauseTime: row.pause_time,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  updateGlobalTimer(id: string, updates: {
    remaining?: number;
    isRunning?: boolean;
    isCompleted?: boolean;
    startTime?: number | null;
    pauseTime?: number | null;
  }): void {
    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.remaining !== undefined) {
      setClauses.push('remaining = ?');
      values.push(updates.remaining);
    }
    if (updates.isRunning !== undefined) {
      setClauses.push('is_running = ?');
      values.push(updates.isRunning ? 1 : 0);
    }
    if (updates.isCompleted !== undefined) {
      setClauses.push('is_completed = ?');
      values.push(updates.isCompleted ? 1 : 0);
    }
    if (updates.startTime !== undefined) {
      setClauses.push('start_time = ?');
      values.push(updates.startTime);
    }
    if (updates.pauseTime !== undefined) {
      setClauses.push('pause_time = ?');
      values.push(updates.pauseTime);
    }

    if (setClauses.length === 0) {
      return;
    }

    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE global_timers 
      SET ${setClauses.join(', ')}
      WHERE id = ?
    `);

    stmt.run(...values);
    eventBus.emit(EVENTS.GLOBAL_TIMER_UPDATED, { timerId: id, updates });
  }

  deleteGlobalTimer(id: string): void {
    const stmt = this.db.prepare('DELETE FROM global_timers WHERE id = ?');
    stmt.run(id);
    eventBus.emit(EVENTS.GLOBAL_TIMER_DELETED, { timerId: id });
  }

  // Draft operations
  saveDraft(recipeId: string, recipe: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>): void {
    // Get current recipe to always use its images (images are directly applied, not part of drafts)
    const currentRecipe = this.getRecipe(recipeId);
    const currentImages = currentRecipe?.images || [];
    const currentImageUrl = currentRecipe?.imageUrl;
    
    // Check if draft already exists
    const draftRefStmt = this.db.prepare('SELECT draft_recipe_id FROM recipe_drafts WHERE recipe_id = ?');
    const draftRef = draftRefStmt.get(recipeId) as { draft_recipe_id: string } | undefined;
    
    let draftRecipeId: string;
    
    if (draftRef) {
      // Update existing draft recipe (use ISO string for consistency)
      // Always use current recipe's images instead of draft's images
      draftRecipeId = draftRef.draft_recipe_id;
      const now = new Date().toISOString();
      const updateStmt = this.db.prepare(`
        UPDATE recipes SET
          title = ?, subtitle = ?, description = ?, metadata = ?, category = ?,
          tags = ?, ingredient_groups = ?, preparation_groups = ?,
          image_url = ?, images = ?, source_url = ?, updated_at = ?
        WHERE id = ?
      `);
      
      updateStmt.run(
        recipe.title,
        recipe.subtitle,
        recipe.description,
        JSON.stringify(recipe.metadata),
        recipe.category,
        JSON.stringify(recipe.tags || []),
        JSON.stringify(recipe.ingredientGroups),
        JSON.stringify(recipe.preparationGroups),
        currentImageUrl, // Use current recipe's imageUrl
        JSON.stringify(currentImages), // Always use current recipe's images
        recipe.sourceUrl,
        now,
        draftRecipeId
      );
      
      // Update last_updated in draft reference (use ISO string for consistency)
      const updateRefStmt = this.db.prepare('UPDATE recipe_drafts SET last_updated = ? WHERE recipe_id = ?');
      updateRefStmt.run(now, recipeId);
    } else {
      // Create new draft recipe (use ISO strings for consistency)
      // Always use current recipe's images instead of draft's images
      draftRecipeId = uuidv4();
      const now = new Date().toISOString();
      const insertStmt = this.db.prepare(`
        INSERT INTO recipes (id, title, subtitle, description, metadata, category, tags,
          ingredient_groups, preparation_groups, image_url, images, source_url, is_draft, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `);
      
      insertStmt.run(
        draftRecipeId,
        recipe.title,
        recipe.subtitle,
        recipe.description,
        JSON.stringify(recipe.metadata),
        recipe.category,
        JSON.stringify(recipe.tags || []),
        JSON.stringify(recipe.ingredientGroups),
        JSON.stringify(recipe.preparationGroups),
        currentImageUrl, // Use current recipe's imageUrl
        JSON.stringify(currentImages), // Always use current recipe's images
        recipe.sourceUrl,
        now,
        now
      );
      
      // Create draft reference (use ISO string for consistency)
      const refStmt = this.db.prepare(`
        INSERT INTO recipe_drafts (recipe_id, draft_recipe_id, last_updated)
        VALUES (?, ?, ?)
      `);
      refStmt.run(recipeId, draftRecipeId, now);
    }
  }

  getDraft(recipeId: string): Recipe & { draftLastUpdated?: Date } | null {
    const stmt = this.db.prepare(`
      SELECT r.*, rd.last_updated as draft_last_updated FROM recipes r
      INNER JOIN recipe_drafts rd ON r.id = rd.draft_recipe_id
      WHERE rd.recipe_id = ?
    `);
    const row = stmt.get(recipeId) as any;

    if (!row) {
      return null;
    }

    // Always use current recipe's images (images are directly applied, not part of drafts)
    const currentRecipe = this.getRecipe(recipeId);
    const currentImages = currentRecipe?.images || [];
    const currentImageUrl = currentRecipe?.imageUrl;

    const draft: Recipe & { draftLastUpdated?: Date } = {
      id: row.id,
      title: row.title,
      subtitle: row.subtitle || undefined,
      description: row.description || undefined,
      metadata: JSON.parse(row.metadata),
      category: row.category || undefined,
      tags: JSON.parse(row.tags || '[]'),
      ingredientGroups: JSON.parse(row.ingredient_groups),
      preparationGroups: JSON.parse(row.preparation_groups),
      imageUrl: currentImageUrl, // Always use current recipe's imageUrl
      images: currentImages, // Always use current recipe's images
      sourceUrl: row.source_url || undefined,
      parentRecipeId: row.parent_recipe_id || undefined,
      variantName: row.variant_name || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.draft_last_updated || row.updated_at), // Use draft's last_updated timestamp
      draftLastUpdated: new Date(row.draft_last_updated || row.updated_at)
    };
    
    return draft;
  }

  deleteDraft(recipeId: string): void {
    // Get draft recipe ID
    const draftRefStmt = this.db.prepare('SELECT draft_recipe_id FROM recipe_drafts WHERE recipe_id = ?');
    const draftRef = draftRefStmt.get(recipeId) as { draft_recipe_id: string } | undefined;
    
    if (draftRef) {
      // Delete draft recipe
      const deleteRecipeStmt = this.db.prepare('DELETE FROM recipes WHERE id = ?');
      deleteRecipeStmt.run(draftRef.draft_recipe_id);
      
      // Delete draft reference (should cascade, but explicit is better)
      const deleteRefStmt = this.db.prepare('DELETE FROM recipe_drafts WHERE recipe_id = ?');
      deleteRefStmt.run(recipeId);
    }
  }

  deleteDraftReference(recipeId: string): void {
    // Delete only the draft reference (not the draft recipe itself)
    const deleteRefStmt = this.db.prepare('DELETE FROM recipe_drafts WHERE recipe_id = ?');
    deleteRefStmt.run(recipeId);
  }

  hasDraft(recipeId: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM recipe_drafts WHERE recipe_id = ?');
    const row = stmt.get(recipeId);
    return !!row;
  }

  cleanupOrphanedDrafts(): void {
    // Find and delete drafts that reference recipes that no longer exist
    const checkStmt = this.db.prepare(`
      SELECT rd.recipe_id, rd.draft_recipe_id
      FROM recipe_drafts rd
      WHERE NOT EXISTS (
        SELECT 1 FROM recipes r WHERE r.id = rd.recipe_id
      )
    `);
    const orphanedDrafts = checkStmt.all() as Array<{ recipe_id: string; draft_recipe_id: string }>;
    
    // Delete each orphaned draft
    for (const orphan of orphanedDrafts) {
      try {
        // Delete the draft recipe first (if it exists)
        if (orphan.draft_recipe_id) {
          try {
            this.deleteRecipe(orphan.draft_recipe_id);
          } catch (error) {
            // Draft recipe might already be deleted, which is fine
          }
        }
        // Delete the draft reference
        this.deleteDraftReference(orphan.recipe_id);
      } catch (error) {
        // Silently continue if deletion fails
        console.log('Error cleaning up orphaned draft:', orphan.recipe_id, error);
      }
    }
  }

  getAllDrafts(): Array<{ recipeId: string; title: string; lastUpdated: Date }> {
    // Clean up orphaned drafts before returning the list
    this.cleanupOrphanedDrafts();
    
    const stmt = this.db.prepare(`
      SELECT rd.recipe_id, r.title, rd.last_updated 
      FROM recipe_drafts rd
      INNER JOIN recipes r ON rd.draft_recipe_id = r.id
      ORDER BY rd.last_updated DESC
    `);
    const rows = stmt.all() as Array<{ recipe_id: string; title: string; last_updated: string }>;
    
    return rows.map(row => ({
      recipeId: row.recipe_id,
      title: row.title,
      lastUpdated: new Date(row.last_updated)
    }));
  }

  close(): void {
    this.db.close();
  }
}

// Create a singleton instance
export const db = new CookbookDatabase();
export default CookbookDatabase; 
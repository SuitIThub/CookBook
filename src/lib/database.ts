import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { NutritionData, Recipe, ShoppingList, ShoppingListItem, ShoppingListRecipe, Quantity } from '../types/recipe';
import type {
  BodyProfile,
  CatalogueIngredient,
  DiaryEntry,
  MealPlan,
  MealPlanStatus,
  Product,
  ProductSupermarketPrice,
  Supermarket,
  WeightLog,
} from '../types/tracker';
import { eventBus, EVENTS } from './events';
import {
  getDefaultSelection,
  getAlternativeGroups,
  filterRecipeBySelection,
  buildShoppingAlternativeSelections,
  mergeSelection,
  resolveSelection,
  type AlternativeSelection,
} from './alternatives';
import { resolveMainCategory } from './recipeCategories';
import { collectIngredientsFromGroups, applyProductAssignmentsToGroups } from './recipeNutrition';

export class CookbookDatabase {
  private db: Database.Database;

  constructor(dbPath: string = './cookbook.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    // Enforce foreign keys so ON DELETE CASCADE on the tracker junction tables
    // (ingredient_products, product_supermarkets) actually fires. better-sqlite3
    // leaves this OFF by default. Must be set outside any transaction.
    this.db.pragma('foreign_keys = ON');
    this.initTables();
  }

  /** Safe to call repeatedly (HMR / older processes that skipped initTables ALTERs). */
  private ensureRecipeProductSelectionColumns(): void {
    try {
      this.db.exec(`ALTER TABLE recipes ADD COLUMN product_assignments_json TEXT`);
    } catch {
      // column already exists
    }
    try {
      this.db.exec(`ALTER TABLE recipes ADD COLUMN preferred_supermarket_id TEXT`);
    } catch {
      // column already exists
    }
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
    this.ensureRecipeProductSelectionColumns();

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

    // Alias settings table - per-alias, per-key client settings synced across devices.
    // updated_at stores a client timestamp (ms) used for last-write-wins merging.
    // value is stored as TEXT (JSON/string); NULL means the setting was cleared.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS alias_settings (
        alias TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (alias, key)
      )
    `);

    // Nutrition/tracker tables (Phase 1). These use full CREATE statements
    // (not the generic EXPECTED_SCHEMA migrator) because we rely on UNIQUE
    // and indexes that the generic migrator cannot express.
    // Ingredients get catalogue-level nutrition and unit conversion data.
    try {
      this.db.exec(`ALTER TABLE ingredients ADD COLUMN nutrition_json TEXT`);
    } catch (error) {
      // column already exists
    }
    try {
      this.db.exec(`ALTER TABLE ingredients ADD COLUMN density_g_per_ml REAL`);
    } catch (error) {
      // column already exists
    }
    try {
      this.db.exec(`ALTER TABLE ingredients ADD COLUMN grams_by_unit_json TEXT`);
    } catch (error) {
      // column already exists
    }
    try {
      this.db.exec(`ALTER TABLE ingredients ADD COLUMN default_product_id TEXT`);
    } catch (error) {
      // column already exists
    }

    // Shopping list: preferred supermarket for price lookups.
    try {
      this.db.exec(`ALTER TABLE shopping_lists ADD COLUMN preferred_supermarket_id TEXT`);
    } catch (error) {
      // column already exists
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS supermarkets (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        ean TEXT UNIQUE,
        name TEXT NOT NULL,
        brand TEXT,
        net_grams REAL,
        package_label TEXT,
        nutrition_json TEXT,
        default_price REAL,
        image_url TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        off_code TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_products_name ON products(name)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_products_ean ON products(ean)`);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ingredient_products (
        ingredient_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (ingredient_id, product_id),
        FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_ingredient_products_product ON ingredient_products(product_id)`);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS product_supermarkets (
        product_id TEXT NOT NULL,
        supermarket_id TEXT NOT NULL,
        price REAL NOT NULL,
        PRIMARY KEY (product_id, supermarket_id),
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        FOREIGN KEY (supermarket_id) REFERENCES supermarkets(id) ON DELETE CASCADE
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_product_supermarkets_market ON product_supermarkets(supermarket_id)`);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS weight_logs (
        id TEXT PRIMARY KEY,
        alias TEXT NOT NULL,
        logged_at DATETIME NOT NULL,
        weight_kg REAL NOT NULL
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_weight_logs_alias_time ON weight_logs(alias, logged_at)`);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meal_plans (
        id TEXT PRIMARY KEY,
        alias TEXT NOT NULL,
        recipe_id TEXT NOT NULL,
        scheduled_at DATETIME NOT NULL,
        servings REAL NOT NULL DEFAULT 1,
        supermarket_id TEXT,
        status TEXT NOT NULL DEFAULT 'planned',
        product_assignments_json TEXT,
        reminder_minutes INTEGER,
        nutrition_snapshot_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_meal_plans_alias_time ON meal_plans(alias, scheduled_at)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_meal_plans_recipe ON meal_plans(recipe_id)`);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS diary_entries (
        id TEXT PRIMARY KEY,
        alias TEXT NOT NULL,
        eaten_at DATETIME NOT NULL,
        source TEXT NOT NULL,
        plan_id TEXT,
        recipe_id TEXT,
        product_id TEXT,
        label TEXT,
        grams REAL,
        servings REAL,
        nutrition_json TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_diary_alias_time ON diary_entries(alias, eaten_at)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_diary_plan ON diary_entries(plan_id)`);
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
      INSERT INTO recipes (id, title, subtitle, description, metadata, category, tags, ingredient_groups, preparation_groups, image_url, images, source_url, parent_recipe_id, variant_name, product_assignments_json, preferred_supermarket_id, is_draft, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      JSON.stringify(newRecipe.productAssignments ?? {}),
      newRecipe.preferredSupermarketId || null,
      0, // is_draft = false for regular recipes
      newRecipe.createdAt.toISOString(),
      newRecipe.updatedAt.toISOString()
    );

    // Side effects must not roll back a successful insert (better-sqlite3 autocommits).
    try {
      this.addIngredientsToAutocomplete(newRecipe.ingredientGroups);
      if (newRecipe.category) {
        this.updateCategoryUsage(newRecipe.category);
      }
      if (newRecipe.tags && newRecipe.tags.length > 0) {
        this.updateTagsUsage(newRecipe.tags);
      }
    } catch (sideEffectError) {
      console.error('createRecipe side effects failed (recipe was still saved):', sideEffectError);
    }

    return newRecipe;
  }

  getRecipe(id: string): Recipe | null {
    const stmt = this.db.prepare('SELECT * FROM recipes WHERE id = ? AND is_draft = 0');
    const row = stmt.get(id) as any;

    if (!row) {
      return null;
    }

    return rowToRecipe(row);
  }
  
  // Get recipe including drafts (for internal use)
  getRecipeIncludingDraft(id: string): Recipe | null {
    const stmt = this.db.prepare('SELECT * FROM recipes WHERE id = ?');
    const row = stmt.get(id) as any;

    if (!row) {
      return null;
    }

    return rowToRecipe(row);
  }

  getAllRecipes(): Recipe[] {
    const stmt = this.db.prepare('SELECT * FROM recipes WHERE is_draft = 0 ORDER BY updated_at DESC');
    const rows = stmt.all() as any[];

    return rows.map(row => rowToRecipe(row));
  }

  getRecipeBySourceUrl(sourceUrl: string): Recipe | null {
    const stmt = this.db.prepare('SELECT * FROM recipes WHERE source_url = ? AND is_draft = 0');
    const row = stmt.get(sourceUrl) as any;

    if (!row) {
      return null;
    }

    return rowToRecipe(row);
  }

  /**
   * Get all non-draft variants for a given original recipe.
   */
  getVariantsForRecipe(parentId: string): Recipe[] {
    const stmt = this.db.prepare('SELECT * FROM recipes WHERE parent_recipe_id = ? AND is_draft = 0 ORDER BY created_at ASC');
    const rows = stmt.all(parentId) as any[];

    return rows.map(row => rowToRecipe(row));
  }

  updateRecipe(id: string, updates: Partial<Recipe> & { imageUrl?: string | null }): Recipe | null {
    this.ensureRecipeProductSelectionColumns();
    const existingRecipe = this.getRecipe(id);
    if (!existingRecipe) {
      return null;
    }

    // Keep imageUrl in sync with images[] when images are updated but imageUrl was omitted
    // (JSON.stringify drops undefined, which previously left a stale imageUrl behind)
    const normalizedUpdates: Partial<Recipe> & { imageUrl?: string | null } = { ...updates };
    if (Array.isArray(normalizedUpdates.images) && !('imageUrl' in normalizedUpdates)) {
      normalizedUpdates.imageUrl = normalizedUpdates.images[0]?.url ?? null;
    }

    const updatedRecipe: Recipe = {
      ...existingRecipe,
      ...normalizedUpdates,
      productAssignments: normalizedUpdates.productAssignments !== undefined
        ? normalizedUpdates.productAssignments
        : existingRecipe.productAssignments,
      preferredSupermarketId: 'preferredSupermarketId' in normalizedUpdates
        ? normalizedUpdates.preferredSupermarketId
        : existingRecipe.preferredSupermarketId,
      updatedAt: new Date()
    };

    if (updates.ingredientGroups) {
      const previousIds = new Map<string, string>();
      for (const ing of collectIngredientsFromGroups(existingRecipe.ingredientGroups)) {
        if (ing.productId) previousIds.set(ing.id, ing.productId);
      }
      const restoreProductIds = (items: typeof updatedRecipe.ingredientGroups): typeof updatedRecipe.ingredientGroups =>
        items.map((item: any) => {
          if (item && Array.isArray(item.ingredients)) {
            return { ...item, ingredients: restoreProductIds(item.ingredients) };
          }
          if (item && !item.productId && previousIds.has(item.id)) {
            return { ...item, productId: previousIds.get(item.id) };
          }
          return item;
        });
      updatedRecipe.ingredientGroups = restoreProductIds(updatedRecipe.ingredientGroups);
      const liveIds = new Set(collectIngredientsFromGroups(updatedRecipe.ingredientGroups).map((ing) => ing.id));
      const pruned: Record<string, string> = {};
      for (const [ingredientId, productId] of Object.entries(updatedRecipe.productAssignments || {})) {
        if (liveIds.has(ingredientId)) pruned[ingredientId] = productId;
      }
      for (const ing of collectIngredientsFromGroups(updatedRecipe.ingredientGroups)) {
        if (ing.productId && pruned[ing.id] == null) pruned[ing.id] = ing.productId;
      }
      updatedRecipe.productAssignments = pruned;
    }

    const stmt = this.db.prepare(`
      UPDATE recipes 
      SET title = ?, subtitle = ?, description = ?, metadata = ?, category = ?, tags = ?,
          ingredient_groups = ?, preparation_groups = ?, image_url = ?, images = ?, source_url = ?, parent_recipe_id = ?, variant_name = ?, product_assignments_json = ?, preferred_supermarket_id = ?, updated_at = ?
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
      updatedRecipe.imageUrl ?? null,
      JSON.stringify(updatedRecipe.images || []),
      updatedRecipe.sourceUrl,
      updatedRecipe.parentRecipeId || null,
      updatedRecipe.variantName || null,
      JSON.stringify(updatedRecipe.productAssignments ?? {}),
      updatedRecipe.preferredSupermarketId || null,
      updatedRecipe.updatedAt.toISOString(),
      id
    );

    // Check if the update actually affected any rows
    if (result.changes === 0) {
      console.error('Database update failed - no rows affected');
      return null;
    }

    try {
      if (updates.ingredientGroups) {
        this.addIngredientsToAutocomplete(updates.ingredientGroups);
      }
      if (updates.category) {
        this.updateCategoryUsage(updates.category);
      }
      if (updates.tags) {
        this.updateTagsUsage(updates.tags);
      }
    } catch (sideEffectError) {
      console.error('updateRecipe side effects failed (recipe was still saved):', sideEffectError);
    }

    return updatedRecipe;
  }

  /**
   * Persist recipe-level product picks / supermarket without bumping updated_at.
   * Incoming assignments are merged; empty string means "explicitly no product".
   */
  setRecipeProductSelection(
    id: string,
    input: {
      productAssignments?: Record<string, string>;
      preferredSupermarketId?: string | null;
    }
  ): Recipe | null {
    this.ensureRecipeProductSelectionColumns();
    const existing = this.getRecipe(id);
    if (!existing) return null;
    const productAssignments = input.productAssignments
      ? { ...(existing.productAssignments || {}), ...input.productAssignments }
      : existing.productAssignments;
    const preferredSupermarketId = input.preferredSupermarketId === undefined
      ? existing.preferredSupermarketId
      : input.preferredSupermarketId || undefined;
    const ingredientGroups = applyProductAssignmentsToGroups(
      existing.ingredientGroups,
      productAssignments || {}
    ) as typeof existing.ingredientGroups;
    const groupsJson = JSON.stringify(ingredientGroups);
    const assignmentsJson = JSON.stringify(productAssignments ?? {});
    try {
      this.db.prepare(`
        UPDATE recipes
        SET ingredient_groups = ?, product_assignments_json = ?, preferred_supermarket_id = ?
        WHERE id = ? AND is_draft = 0
      `).run(groupsJson, assignmentsJson, preferredSupermarketId ?? null, id);
    } catch {
      this.db.prepare(`
        UPDATE recipes SET ingredient_groups = ? WHERE id = ? AND is_draft = 0
      `).run(groupsJson, id);
    }
    return { ...existing, ingredientGroups, productAssignments, preferredSupermarketId };
  }

  /**
   * Deletes a recipe row by id. For a published original with variants, promotes the first variant
   * to root before deleting. Draft rows (`is_draft = 1`) are deleted without variant promotion.
   */
  deleteRecipe(id: string): { success: boolean; promotedOriginalRecipeId?: string } {
    const runDelete = this.db.transaction((recipeId: string) => {
      const recipeStmt = this.db.prepare(
        'SELECT id, parent_recipe_id, is_draft FROM recipes WHERE id = ?'
      );
      const recipe = recipeStmt.get(recipeId) as
        | { id: string; parent_recipe_id: string | null; is_draft: number }
        | undefined;
      if (!recipe) {
        return { success: false };
      }

      let promotedOriginalRecipeId: string | undefined;

      // Variant promotion only applies to published (non-draft) recipes.
      if (!recipe.is_draft) {
        // If the deleted recipe is an original, promote the next variant (if any) to new original.
        if (!recipe.parent_recipe_id) {
          const variantsStmt = this.db.prepare(`
            SELECT id
            FROM recipes
            WHERE parent_recipe_id = ? AND is_draft = 0
            ORDER BY created_at ASC
          `);
          const variants = variantsStmt.all(recipeId) as Array<{ id: string }>;

          if (variants.length > 0) {
            promotedOriginalRecipeId = variants[0].id;

            // Promoted variant becomes the new original.
            this.db
              .prepare('UPDATE recipes SET parent_recipe_id = NULL, variant_name = NULL WHERE id = ?')
              .run(promotedOriginalRecipeId);

            // Remaining variants are attached to the new original.
            if (variants.length > 1) {
              const reparentStmt = this.db.prepare('UPDATE recipes SET parent_recipe_id = ? WHERE id = ?');
              for (const variant of variants.slice(1)) {
                reparentStmt.run(promotedOriginalRecipeId, variant.id);
              }
            }
          }
        }
      }

      const deleteStmt = this.db.prepare('DELETE FROM recipes WHERE id = ?');
      const result = deleteStmt.run(recipeId);
      if (result.changes === 0) {
        return { success: false };
      }
      return { success: true, promotedOriginalRecipeId };
    });

    return runDelete(id);
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

  /** Ensure every shopping-list item has a stable UUID (fixes legacy rows saved without id). */
  private ensureShoppingListItemIds(items: ShoppingListItem[]): { items: ShoppingListItem[]; changed: boolean } {
    let changed = false;
    const normalized = items.map(item => {
      const id = item?.id;
      if (id && typeof id === 'string' && !id.startsWith('new-')) {
        return item;
      }
      changed = true;
      return { ...item, id: uuidv4() };
    });
    return { items: normalized, changed };
  }

  private shoppingListFromRow(row: any): ShoppingList {
    const rawItems: ShoppingListItem[] = row.items ? JSON.parse(row.items) : [];
    const { items, changed } = this.ensureShoppingListItemIds(rawItems);
    // Persist backfilled ids so toggles/sync keep matching across reloads
    if (changed) {
      this.db.prepare('UPDATE shopping_lists SET items = ? WHERE id = ?')
        .run(JSON.stringify(items), row.id);
    }
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
      preferredSupermarketId: row.preferred_supermarket_id || undefined,
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
    mergedItems = this.ensureShoppingListItemIds(mergedItems).items;
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
      SET title = ?, description = ?, items = ?, recipes = ?, is_permanent = ?, has_seen_global_template_prompt = ?, preferred_supermarket_id = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      updatedList.title,
      updatedList.description,
      JSON.stringify(updatedList.items),
      JSON.stringify(updatedList.recipes),
      updatedList.permanentType ?? (updatedList.isPermanent ? 1 : 0),
      mergedHasSeenGlobalTemplatePrompt ? 1 : 0,
      updatedList.preferredSupermarketId ?? null,
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

  removeItemFromShoppingList(listId: string, itemId: string): ShoppingList | null {
    const list = this.getShoppingList(listId);
    if (!list) {
      return null;
    }

    const filteredItems = list.items.filter(item => item.id !== itemId);
    if (filteredItems.length === list.items.length) {
      // Item nicht in der Liste vorhanden
      return null;
    }

    return this.updateShoppingList(listId, { items: filteredItems });
  }

  // Recipe management for shopping lists
  addRecipeToShoppingList(listId: string, recipeId: string, catalogueDefaults?: Record<string, string>): ShoppingList | null {
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

    // Determine the active alternative selection (resolved defaults) and the alternatives metadata.
    const selection = resolveSelection(recipe, getDefaultSelection(recipe));
    const alternativeSelections = buildShoppingAlternativeSelections(recipe, selection);

    // Add recipe to list
    const shoppingListRecipe: ShoppingListRecipe = {
      id: recipe.id,
      title: displayTitle,
      servings: recipe.metadata.servings,
      currentServings: recipe.metadata.servings,
      isCompleted: false,
      addedAt: new Date(),
      alternativeSelections: alternativeSelections.length > 0 ? alternativeSelections : undefined
    };

    shoppingList.recipes.push(shoppingListRecipe);

    // Only include ingredients of the active alternative + satisfied dependencies.
    const filteredRecipe = filterRecipeBySelection(recipe, selection);

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
                const cat = this.getCatalogueIngredientByName(item.name);
                const aliasPick = cat && catalogueDefaults && Object.prototype.hasOwnProperty.call(catalogueDefaults, cat.id)
                  ? catalogueDefaults[cat.id]
                  : undefined;
                const assignedProductId = aliasPick !== undefined
                  ? aliasPick
                  : (cat?.defaultProductId || recipe.productAssignments?.[item.id]);
                if (assignedProductId) shoppingItem.productId = assignedProductId;
                if (item.alternativeGroupId) {
                  shoppingItem.alternativeGroupId = item.alternativeGroupId;
                  shoppingItem.alternativeOptionId = item.id;
                }
                shoppingList.items.push(shoppingItem);
              });
            }
          });
        }
      });
    };

    extractIngredients(filteredRecipe.ingredientGroups);

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
        const added = this.getRecipe(recipeId)
          ? this.addRecipeToShoppingList(targetListId, recipeId)
          : null;
        if (added) {
          const desiredServings = permRecipe.currentServings ?? permRecipe.servings;
          if (desiredServings) {
            this.updateRecipeServingsInShoppingList(targetListId, recipeId, desiredServings);
          }
          transferredRecipeCount++;
          permanentRecipes = permanentRecipes.filter(r => r.id !== recipeId);
          permanentItems = permanentItems.filter(item => item.recipeId !== recipeId);
        } else {
          // Recipe missing – move stored recipe entry + items as-is
          target = this.getShoppingList(targetListId)!;
          target.recipes.push({
            ...permRecipe,
            isCompleted: false,
            addedAt: new Date()
          });
          for (const item of permanentItems.filter(i => i.recipeId === recipeId)) {
            const { id: _id, ...rest } = item;
            target.items.push({ ...rest, id: uuidv4(), isChecked: false });
            transferredItemCount++;
          }
          this.updateShoppingList(targetListId, { items: target.items, recipes: target.recipes });
          transferredRecipeCount++;
          permanentRecipes = permanentRecipes.filter(r => r.id !== recipeId);
          permanentItems = permanentItems.filter(item => item.recipeId !== recipeId);
        }
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
   * If a recipe was deleted from the DB, its stored items on the template are still copied.
   */
  applyGlobalTemplateToList(targetListId: string): { copiedItemCount: number; copiedRecipeCount: number } | null {
    const GLOBAL_TEMPLATE_LIST_ID = 'global-template-shopping-list';
    const template = this.getGlobalTemplateShoppingList();
    let target = this.getShoppingList(targetListId);
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
    target = this.getShoppingList(targetListId)!;
    const targetRecipeIds = new Set((target.recipes || []).map(r => r.id));
    for (const tplRecipe of template.recipes || []) {
      if (targetRecipeIds.has(tplRecipe.id)) {
        continue;
      }

      // Prefer live recipe (keeps ingredients/alternatives in sync with current recipe)
      if (this.getRecipe(tplRecipe.id) && this.addRecipeToShoppingList(targetListId, tplRecipe.id)) {
        const desiredServings = tplRecipe.currentServings ?? tplRecipe.servings;
        if (desiredServings) {
          this.updateRecipeServingsInShoppingList(targetListId, tplRecipe.id, desiredServings);
        }
        copiedRecipeCount++;
        targetRecipeIds.add(tplRecipe.id);
        continue;
      }

      // Fallback: recipe missing/unavailable – copy stored recipe entry + items from template
      target = this.getShoppingList(targetListId)!;
      target.recipes.push({
        ...tplRecipe,
        isCompleted: false,
        addedAt: new Date()
      });
      for (const item of template.items.filter(i => i.recipeId === tplRecipe.id)) {
        const { id: _id, ...rest } = item;
        target.items.push({ ...rest, id: uuidv4(), isChecked: false });
        copiedItemCount++;
      }
      this.updateShoppingList(targetListId, { items: target.items, recipes: target.recipes });
      copiedRecipeCount++;
      targetRecipeIds.add(tplRecipe.id);
    }

    // Orphan items: linked to a recipeId that is not listed in template.recipes
    const templateRecipeIds = new Set((template.recipes || []).map(r => r.id));
    for (const item of template.items.filter(i => i.recipeId && !templateRecipeIds.has(i.recipeId))) {
      const { id: _id, recipeId: _recipeId, ...rest } = item;
      this.addItemToShoppingList(targetListId, { ...rest, isChecked: false });
      copiedItemCount++;
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
    if (!Array.isArray(ingredientGroups)) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ingredients (id, name, description, usage_count) 
      VALUES (?, ?, ?, COALESCE((SELECT usage_count FROM ingredients WHERE name = ?) + 1, 1))
    `);

    const visit = (groups: any[]): void => {
      for (const group of groups) {
        if (!group || !Array.isArray(group.ingredients)) continue;
        for (const ingredient of group.ingredients) {
          if (!ingredient || typeof ingredient !== 'object') continue;
          if (Array.isArray(ingredient.ingredients)) {
            visit([ingredient]);
            continue;
          }
          const name = typeof ingredient.name === 'string' ? ingredient.name.trim() : '';
          if (!name) continue;
          const description =
            typeof ingredient.description === 'string' ? ingredient.description : null;
          stmt.run(uuidv4(), name, description, name);
        }
      }
    };

    visit(ingredientGroups);
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
    const resolved = resolveMainCategory(category);
    if (!resolved) return;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO categories (id, name, usage_count)
      VALUES (?, ?, COALESCE((SELECT usage_count FROM categories WHERE name = ?) + 1, 1))
    `);
    stmt.run(uuidv4(), resolved, resolved);
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
    if (!Array.isArray(tags)) return;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO recipe_tags (id, name, usage_count)
      VALUES (?, ?, COALESCE((SELECT usage_count FROM recipe_tags WHERE name = ?) + 1, 1))
    `);

    tags.forEach((tag) => {
      if (typeof tag !== 'string' || !tag.trim()) return;
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
   * Switch the selected alternative for a recipe already on a shopping list.
   * Removes the recipe's old items and re-extracts them for the new selection,
   * preserving the current portion scaling and (best-effort) the checked state.
   */
  updateRecipeAlternativeInShoppingList(
    listId: string,
    recipeId: string,
    groupId: string,
    optionId: string
  ): ShoppingList | null {
    const shoppingList = this.getShoppingList(listId);
    if (!shoppingList) return null;

    const slRecipe = shoppingList.recipes.find(r => r.id === recipeId);
    if (!slRecipe) return null;

    const recipe = this.getRecipe(recipeId);
    if (!recipe) return null;

    // Validate the requested group/option.
    const groups = getAlternativeGroups(recipe);
    const info = groups.get(groupId);
    if (!info || !info.options.some(o => o.id === optionId)) return null;

    // Build the new selection from the previously stored one + the requested change.
    const override: AlternativeSelection = {};
    (slRecipe.alternativeSelections || []).forEach(s => {
      override[s.groupId] = s.selectedOptionId;
    });
    override[groupId] = optionId;
    const selection = resolveSelection(recipe, mergeSelection(recipe, override));

    // Preserve checked state best-effort, keyed by the source ingredient id.
    const checkedByIngredient = new Map<string, boolean>();
    shoppingList.items.forEach(it => {
      if (it.recipeId === recipeId && it.recipeIngredientId && it.isChecked) {
        checkedByIngredient.set(it.recipeIngredientId, true);
      }
    });

    // Remove the recipe's existing items.
    shoppingList.items = shoppingList.items.filter(it => it.recipeId !== recipeId);

    // Re-extract with the new selection and the current portion scaling.
    const baseServings = slRecipe.servings || recipe.metadata.servings || 1;
    const currentServings = slRecipe.currentServings || baseServings;
    const scalingFactor = baseServings ? currentServings / baseServings : 1;
    const filteredRecipe = filterRecipeBySelection(recipe, selection);

    const extractIngredients = (groupsArr: any[]): void => {
      groupsArr.forEach(group => {
        if (group.ingredients) {
          group.ingredients.forEach((item: any) => {
            if (item.ingredients) {
              extractIngredients([item]);
            } else if (item.name && item.quantities && item.quantities.length > 0) {
              item.quantities.forEach((quantity: Quantity) => {
                const originalQuantity = { ...quantity };
                const shoppingItem: ShoppingListItem = {
                  id: uuidv4(),
                  name: item.name,
                  description: item.description,
                  quantity: {
                    amount: parseFloat((originalQuantity.amount * scalingFactor).toFixed(2)),
                    unit: originalQuantity.unit
                  },
                  originalQuantity,
                  isChecked: checkedByIngredient.get(item.id) || false,
                  recipeId: recipe.id,
                  recipeIngredientId: item.id
                };
                if (item.alternativeGroupId) {
                  shoppingItem.alternativeGroupId = item.alternativeGroupId;
                  shoppingItem.alternativeOptionId = item.id;
                }
                shoppingList.items.push(shoppingItem);
              });
            }
          });
        }
      });
    };

    extractIngredients(filteredRecipe.ingredientGroups);

    // Persist the new selection on the shopping-list recipe.
    slRecipe.alternativeSelections = buildShoppingAlternativeSelections(recipe, selection);

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

    eventBus.emit(EVENTS.SHOPPING_LIST_UPDATED, { listId });

    return shoppingList;
  }

  /**
   * Preview which already-checked items would be removed when switching a recipe's
   * alternative in a shopping list. Does not modify the list.
   * Returns the checked items whose source ingredient is no longer present after the switch.
   */
  previewRecipeAlternativeChange(
    listId: string,
    recipeId: string,
    groupId: string,
    optionId: string
  ): { removedChecked: { name: string; quantity?: Quantity }[] } | null {
    const shoppingList = this.getShoppingList(listId);
    if (!shoppingList) return null;

    const slRecipe = shoppingList.recipes.find(r => r.id === recipeId);
    if (!slRecipe) return null;

    const recipe = this.getRecipe(recipeId);
    if (!recipe) return null;

    const groups = getAlternativeGroups(recipe);
    const info = groups.get(groupId);
    if (!info || !info.options.some(o => o.id === optionId)) return null;

    // Compute the resulting selection.
    const override: AlternativeSelection = {};
    (slRecipe.alternativeSelections || []).forEach(s => {
      override[s.groupId] = s.selectedOptionId;
    });
    override[groupId] = optionId;
    const selection = mergeSelection(recipe, override);

    // Collect the ingredient ids that survive the switch.
    const filteredRecipe = filterRecipeBySelection(recipe, selection);
    const survivingIds = new Set<string>();
    const collectIds = (groupsArr: any[]): void => {
      groupsArr.forEach(group => {
        if (group.ingredients) {
          group.ingredients.forEach((item: any) => {
            if (item.ingredients) {
              collectIds([item]);
            } else if (item.name && item.quantities && item.quantities.length > 0) {
              survivingIds.add(item.id);
            }
          });
        }
      });
    };
    collectIds(filteredRecipe.ingredientGroups);

    // Find currently-checked items of this recipe that would be removed.
    const seen = new Set<string>();
    const removedChecked: { name: string; quantity?: Quantity }[] = [];
    shoppingList.items.forEach(it => {
      if (
        it.recipeId === recipeId &&
        it.isChecked &&
        it.recipeIngredientId &&
        !survivingIds.has(it.recipeIngredientId)
      ) {
        const key = it.recipeIngredientId;
        if (!seen.has(key)) {
          seen.add(key);
          removedChecked.push({ name: it.name, quantity: it.quantity });
        }
      }
    });

    return { removedChecked };
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
      ...rowToRecipe(row),
      imageUrl: currentImageUrl,
      images: currentImages,
      updatedAt: new Date(row.draft_last_updated || row.updated_at),
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

  // ===== Alias settings (cross-device sync) =====

  getAliasSettings(alias: string): Array<{ key: string; value: string | null; updatedAt: number }> {
    const stmt = this.db.prepare(
      'SELECT key, value, updated_at FROM alias_settings WHERE alias = ?'
    );
    const rows = stmt.all(alias) as Array<{ key: string; value: string | null; updated_at: number }>;
    return rows.map((row) => ({
      key: row.key,
      value: row.value,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Upsert a single alias setting using last-write-wins semantics.
   * The incoming change is only applied if its timestamp is newer than the
   * stored one. Returns whether the change was applied plus the resulting row.
   */
  upsertAliasSetting(
    alias: string,
    key: string,
    value: string | null,
    updatedAt: number
  ): { applied: boolean; value: string | null; updatedAt: number } {
    const existingStmt = this.db.prepare(
      'SELECT value, updated_at FROM alias_settings WHERE alias = ? AND key = ?'
    );
    const existing = existingStmt.get(alias, key) as
      | { value: string | null; updated_at: number }
      | undefined;

    if (existing && existing.updated_at >= updatedAt) {
      return { applied: false, value: existing.value, updatedAt: existing.updated_at };
    }

    const upsertStmt = this.db.prepare(`
      INSERT INTO alias_settings (alias, key, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(alias, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    upsertStmt.run(alias, key, value, updatedAt);

    eventBus.emit(EVENTS.ALIAS_SETTINGS_UPDATED, { alias, key, value, updatedAt });

    return { applied: true, value, updatedAt };
  }

  // ===== Catalogue: ingredients with nutrition / grams-by-unit =====

  /** Look up a catalogue ingredient by name (case-insensitive). */
  getCatalogueIngredientByName(name: string): CatalogueIngredient | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const row = this.db
      .prepare('SELECT * FROM ingredients WHERE LOWER(name) = LOWER(?) LIMIT 1')
      .get(trimmed) as any;
    return row ? rowToCatalogueIngredient(row) : null;
  }

  getCatalogueIngredientById(id: string): CatalogueIngredient | null {
    const row = this.db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id) as any;
    return row ? rowToCatalogueIngredient(row) : null;
  }

  getAllCatalogueIngredients(): CatalogueIngredient[] {
    const rows = this.db
      .prepare('SELECT * FROM ingredients ORDER BY LOWER(name) ASC')
      .all() as any[];
    return rows.map(rowToCatalogueIngredient);
  }

  /**
   * Upsert catalogue metadata (nutrition, density, gramsByUnit, defaultProductId)
   * for an ingredient identified by name. Creates the row if it doesn't exist.
   * Returns the resulting catalogue ingredient.
   */
  upsertCatalogueIngredient(input: {
    name: string;
    description?: string | null;
    nutritionPer100g?: NutritionData | null;
    densityGPerMl?: number | null;
    gramsByUnit?: Record<string, number> | null;
    defaultProductId?: string | null;
  }): CatalogueIngredient {
    const name = input.name.trim();
    if (!name) throw new Error('Ingredient name is required');
    const existing = this.getCatalogueIngredientByName(name);
    const nutritionJson = input.nutritionPer100g == null ? null : JSON.stringify(input.nutritionPer100g);
    const gramsByUnitJson = input.gramsByUnit == null ? null : JSON.stringify(input.gramsByUnit);

    if (existing) {
      if (input.defaultProductId === undefined) {
        this.db
          .prepare(
            `UPDATE ingredients SET
               description = COALESCE(?, description),
               nutrition_json = ?,
               density_g_per_ml = ?,
               grams_by_unit_json = ?
             WHERE id = ?`
          )
          .run(
            input.description ?? null,
            nutritionJson,
            input.densityGPerMl ?? null,
            gramsByUnitJson,
            existing.id
          );
      } else {
        this.db
          .prepare(
            `UPDATE ingredients SET
               description = COALESCE(?, description),
               nutrition_json = ?,
               density_g_per_ml = ?,
               grams_by_unit_json = ?,
               default_product_id = ?
             WHERE id = ?`
          )
          .run(
            input.description ?? null,
            nutritionJson,
            input.densityGPerMl ?? null,
            gramsByUnitJson,
            input.defaultProductId,
            existing.id
          );
      }
      eventBus.emit(EVENTS.INGREDIENT_UPDATED, { id: existing.id, name });
      return this.getCatalogueIngredientById(existing.id)!;
    }

    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO ingredients (id, name, description, usage_count, nutrition_json, density_g_per_ml, grams_by_unit_json, default_product_id)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?)`
      )
      .run(
        id,
        name,
        input.description ?? null,
        nutritionJson,
        input.densityGPerMl ?? null,
        gramsByUnitJson,
        input.defaultProductId ?? null
      );
    eventBus.emit(EVENTS.INGREDIENT_UPDATED, { id, name });
    return this.getCatalogueIngredientById(id)!;
  }

  // ===== Supermarkets =====

  getAllSupermarkets(): Supermarket[] {
    const rows = this.db
      .prepare('SELECT * FROM supermarkets ORDER BY LOWER(name) ASC')
      .all() as any[];
    return rows.map(rowToSupermarket);
  }

  getSupermarket(id: string): Supermarket | null {
    const row = this.db.prepare('SELECT * FROM supermarkets WHERE id = ?').get(id) as any;
    return row ? rowToSupermarket(row) : null;
  }

  upsertSupermarket(input: { id?: string; name: string }): Supermarket {
    const name = input.name.trim();
    if (!name) throw new Error('Supermarket name is required');

    if (input.id) {
      const existing = this.getSupermarket(input.id);
      if (existing) {
        this.db
          .prepare('UPDATE supermarkets SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(name, input.id);
        const updated = this.getSupermarket(input.id)!;
        eventBus.emit(EVENTS.SUPERMARKET_UPSERTED, { supermarket: updated });
        return updated;
      }
    }

    const byName = this.db
      .prepare('SELECT * FROM supermarkets WHERE LOWER(name) = LOWER(?) LIMIT 1')
      .get(name) as any;
    if (byName) return rowToSupermarket(byName);

    const id = input.id ?? uuidv4();
    this.db
      .prepare('INSERT INTO supermarkets (id, name) VALUES (?, ?)')
      .run(id, name);
    const created = this.getSupermarket(id)!;
    eventBus.emit(EVENTS.SUPERMARKET_UPSERTED, { supermarket: created });
    return created;
  }

  deleteSupermarket(id: string): boolean {
    // Explicit cleanup of price rows (defense-in-depth; the FK CASCADE also
    // covers this now that foreign_keys is ON).
    this.db.prepare('DELETE FROM product_supermarkets WHERE supermarket_id = ?').run(id);
    const result = this.db.prepare('DELETE FROM supermarkets WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ===== Products =====

  getProduct(id: string): Product | null {
    const row = this.db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.hydrateProduct(row);
  }

  getProductByEan(ean: string): Product | null {
    const trimmed = ean.trim();
    if (!trimmed) return null;
    const row = this.db.prepare('SELECT * FROM products WHERE ean = ?').get(trimmed) as any;
    if (!row) return null;
    return this.hydrateProduct(row);
  }

  getAllProducts(): Product[] {
    const rows = this.db
      .prepare('SELECT * FROM products ORDER BY LOWER(name) ASC')
      .all() as any[];
    return rows.map((row) => this.hydrateProduct(row));
  }

  searchProducts(query: string, limit = 20): Product[] {
    const trimmed = query.trim();
    if (!trimmed) return this.getAllProducts().slice(0, limit);
    const rows = this.db
      .prepare(
        `SELECT * FROM products
         WHERE LOWER(name) LIKE ? OR LOWER(COALESCE(brand,'')) LIKE ? OR ean = ?
         ORDER BY LOWER(name) ASC
         LIMIT ?`
      )
      .all(`%${trimmed.toLowerCase()}%`, `%${trimmed.toLowerCase()}%`, trimmed, limit) as any[];
    return rows.map((row) => this.hydrateProduct(row));
  }

  getProductsForIngredient(ingredientId: string): Product[] {
    const rows = this.db
      .prepare(
        `SELECT p.* FROM products p
         INNER JOIN ingredient_products ip ON ip.product_id = p.id
         WHERE ip.ingredient_id = ?
         ORDER BY ip.is_default DESC, LOWER(p.name) ASC`
      )
      .all(ingredientId) as any[];
    return rows.map((row) => this.hydrateProduct(row));
  }

  /**
   * Insert or update a product. If `ean` is set and an existing product has
   * that EAN, that row is updated in-place. Otherwise a new product is created.
   */
  upsertProduct(input: {
    id?: string;
    ean?: string | null;
    name: string;
    brand?: string | null;
    netGrams?: number | null;
    packageLabel?: string | null;
    nutritionPer100g?: NutritionData | null;
    defaultPrice?: number | null;
    imageUrl?: string | null;
    source?: 'manual' | 'openfoodfacts';
    offCode?: string | null;
    supermarkets?: ProductSupermarketPrice[];
    ingredientIds?: string[];
  }): Product {
    const name = input.name.trim();
    if (!name) throw new Error('Product name is required');
    const ean = input.ean ? input.ean.trim() : null;
    const nutritionJson = input.nutritionPer100g == null ? null : JSON.stringify(input.nutritionPer100g);
    const source = input.source ?? 'manual';

    let productId = input.id ?? null;
    if (!productId && ean) {
      const existing = this.getProductByEan(ean);
      if (existing) productId = existing.id;
    }
    if (productId) {
      const existing = this.getProduct(productId);
      if (existing) {
        this.db
          .prepare(
            `UPDATE products SET
               ean = ?, name = ?, brand = ?, net_grams = ?, package_label = ?,
               nutrition_json = ?, default_price = ?, image_url = ?, source = ?, off_code = ?,
               updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          )
          .run(
            ean,
            name,
            input.brand ?? null,
            input.netGrams ?? null,
            input.packageLabel ?? null,
            nutritionJson,
            input.defaultPrice ?? null,
            input.imageUrl ?? null,
            source,
            input.offCode ?? null,
            productId
          );
      } else {
        productId = null;
      }
    }
    if (!productId) {
      productId = uuidv4();
      this.db
        .prepare(
          `INSERT INTO products
             (id, ean, name, brand, net_grams, package_label, nutrition_json, default_price, image_url, source, off_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          productId,
          ean,
          name,
          input.brand ?? null,
          input.netGrams ?? null,
          input.packageLabel ?? null,
          nutritionJson,
          input.defaultPrice ?? null,
          input.imageUrl ?? null,
          source,
          input.offCode ?? null
        );
    }

    if (input.supermarkets) {
      this.setProductSupermarkets(productId, input.supermarkets);
    }
    if (input.ingredientIds) {
      this.setProductIngredients(productId, input.ingredientIds);
    }

    const product = this.getProduct(productId)!;
    eventBus.emit(EVENTS.PRODUCT_UPSERTED, { product });
    return product;
  }

  deleteProduct(id: string): boolean {
    const result = this.db.prepare('DELETE FROM products WHERE id = ?').run(id);
    if (result.changes > 0) {
      eventBus.emit(EVENTS.PRODUCT_DELETED, { productId: id });
      return true;
    }
    return false;
  }

  setProductSupermarkets(productId: string, prices: ProductSupermarketPrice[]): void {
    const del = this.db.prepare('DELETE FROM product_supermarkets WHERE product_id = ?');
    const insert = this.db.prepare(
      'INSERT INTO product_supermarkets (product_id, supermarket_id, price) VALUES (?, ?, ?)'
    );
    const tx = this.db.transaction((rows: ProductSupermarketPrice[]) => {
      del.run(productId);
      for (const row of rows) {
        if (!row.supermarketId || !Number.isFinite(row.price)) continue;
        insert.run(productId, row.supermarketId, row.price);
      }
    });
    tx(prices);
  }

  /**
   * Set (or clear) the ingredient's default product without touching other
   * catalogue metadata like nutrition, density, or gramsByUnit — the general
   * upsertCatalogueIngredient always overwrites those columns because they
   * are edited as one form.
   */
  setDefaultProductForIngredient(ingredientId: string, productId: string | null): void {
    this.db
      .prepare('UPDATE ingredients SET default_product_id = ? WHERE id = ?')
      .run(productId, ingredientId);
    eventBus.emit(EVENTS.INGREDIENT_UPDATED, { id: ingredientId });
  }

  setProductIngredients(productId: string, ingredientIds: string[]): void {
    const del = this.db.prepare('DELETE FROM ingredient_products WHERE product_id = ?');
    const insert = this.db.prepare(
      'INSERT INTO ingredient_products (ingredient_id, product_id, is_default) VALUES (?, ?, 0)'
    );
    const tx = this.db.transaction((ids: string[]) => {
      del.run(productId);
      const seen = new Set<string>();
      for (const id of ids) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        insert.run(id, productId);
      }
    });
    tx(ingredientIds);
  }

  private hydrateProduct(row: any): Product {
    const supermarkets = this.db
      .prepare('SELECT supermarket_id, price FROM product_supermarkets WHERE product_id = ?')
      .all(row.id) as Array<{ supermarket_id: string; price: number }>;
    const ingredientIds = this.db
      .prepare('SELECT ingredient_id FROM ingredient_products WHERE product_id = ?')
      .all(row.id) as Array<{ ingredient_id: string }>;
    return {
      id: row.id,
      ean: row.ean || undefined,
      name: row.name,
      brand: row.brand || undefined,
      netGrams: row.net_grams ?? undefined,
      packageLabel: row.package_label || undefined,
      nutritionPer100g: row.nutrition_json ? safeParseJson<NutritionData>(row.nutrition_json) : undefined,
      defaultPrice: row.default_price ?? undefined,
      imageUrl: row.image_url || undefined,
      source: row.source === 'openfoodfacts' ? 'openfoodfacts' : 'manual',
      offCode: row.off_code || undefined,
      supermarkets: supermarkets.map((s) => ({ supermarketId: s.supermarket_id, price: s.price })),
      ingredientIds: ingredientIds.map((i) => i.ingredient_id),
      createdAt: parseDate(row.created_at),
      updatedAt: parseDate(row.updated_at),
    };
  }

  // ===== Weight logs =====

  getWeightLogs(alias: string, limit = 2000): WeightLog[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM weight_logs WHERE alias = ? ORDER BY logged_at DESC LIMIT ?'
      )
      .all(alias, limit) as any[];
    return rows.map((row) => ({
      id: row.id,
      alias: row.alias,
      loggedAt: parseDate(row.logged_at),
      weightKg: row.weight_kg,
    }));
  }

  getLatestWeight(alias: string): WeightLog | null {
    const row = this.db
      .prepare('SELECT * FROM weight_logs WHERE alias = ? ORDER BY logged_at DESC LIMIT 1')
      .get(alias) as any;
    if (!row) return null;
    return {
      id: row.id,
      alias: row.alias,
      loggedAt: parseDate(row.logged_at),
      weightKg: row.weight_kg,
    };
  }

  addWeightLog(alias: string, weightKg: number, loggedAt = new Date()): WeightLog {
    const id = uuidv4();
    this.db
      .prepare('INSERT INTO weight_logs (id, alias, logged_at, weight_kg) VALUES (?, ?, ?, ?)')
      .run(id, alias, loggedAt.toISOString(), weightKg);
    const log = { id, alias, loggedAt, weightKg };
    eventBus.emit(EVENTS.WEIGHT_LOGGED, { alias, log });
    return log;
  }

  deleteWeightLog(id: string): boolean {
    const result = this.db.prepare('DELETE FROM weight_logs WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ===== Meal plans =====

  getMealPlan(id: string): MealPlan | null {
    const row = this.db.prepare(`
      SELECT mp.*, r.title AS recipe_title
      FROM meal_plans mp
      LEFT JOIN recipes r ON r.id = mp.recipe_id
      WHERE mp.id = ?
    `).get(id) as any;
    return row ? this.hydrateMealPlan(row) : null;
  }

  getConsumedServingsForPlan(planId: string): number {
    const row = this.db
      .prepare(`SELECT COALESCE(SUM(servings), 0) AS total FROM diary_entries WHERE plan_id = ?`)
      .get(planId) as { total: number } | undefined;
    const total = Number(row?.total ?? 0);
    return Number.isFinite(total) ? total : 0;
  }

  /**
   * Keep plan.status in sync with remaining portions. A prep stays `planned`
   * until every prepared portion has a diary entry; deleting a diary entry
   * reopens it. `skipped` is left untouched.
   */
  syncMealPlanStatusFromDiary(planId: string): MealPlan | null {
    const plan = this.getMealPlan(planId);
    if (!plan || plan.status === 'skipped') return plan;
    const nextStatus: MealPlanStatus = plan.servingsRemaining <= 0 ? 'eaten' : 'planned';
    if (plan.status === nextStatus) return plan;
    return this.updateMealPlan(planId, { status: nextStatus });
  }

  getMealPlansForAlias(alias: string, fromIso?: string, toIso?: string): MealPlan[] {
    const clauses = ['mp.alias = ?'];
    const params: any[] = [alias];
    if (fromIso) {
      clauses.push('mp.scheduled_at >= ?');
      params.push(fromIso);
    }
    if (toIso) {
      clauses.push('mp.scheduled_at <= ?');
      params.push(toIso);
    }
    const rows = this.db
      .prepare(
        `SELECT mp.*, r.title AS recipe_title
         FROM meal_plans mp
         LEFT JOIN recipes r ON r.id = mp.recipe_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY mp.scheduled_at ASC`
      )
      .all(...params) as any[];
    return rows.map((row) => this.hydrateMealPlan(row));
  }

  /**
   * Meal-prep batches available on a given day: started on or before that day,
   * not skipped, and still having leftover portions.
   */
  getActiveMealPlansForAlias(alias: string, asOfIso: string): MealPlan[] {
    const rows = this.db
      .prepare(
        `SELECT mp.*, r.title AS recipe_title
         FROM meal_plans mp
         LEFT JOIN recipes r ON r.id = mp.recipe_id
         WHERE mp.alias = ?
           AND mp.scheduled_at <= ?
           AND mp.status != 'skipped'
           AND mp.servings > COALESCE((
             SELECT SUM(d.servings) FROM diary_entries d WHERE d.plan_id = mp.id
           ), 0)
         ORDER BY mp.scheduled_at ASC`
      )
      .all(alias, asOfIso) as any[];
    return rows.map((row) => this.hydrateMealPlan(row));
  }

  private hydrateMealPlan(row: any): MealPlan {
    const plan = rowToMealPlan(row);
    const consumed = this.getConsumedServingsForPlan(plan.id);
    plan.servingsConsumed = consumed;
    plan.servingsRemaining = Math.max(0, Math.round((plan.servings - consumed) * 100) / 100);
    plan.recipeTitle = typeof row.recipe_title === 'string' && row.recipe_title.trim()
      ? row.recipe_title
      : undefined;
    return plan;
  }

  createMealPlan(input: Omit<MealPlan, 'id' | 'createdAt' | 'updatedAt' | 'servingsConsumed' | 'servingsRemaining' | 'recipeTitle'>): MealPlan {
    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO meal_plans (id, alias, recipe_id, scheduled_at, servings, supermarket_id,
             status, product_assignments_json, reminder_minutes, nutrition_snapshot_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.alias,
        input.recipeId,
        input.scheduledAt.toISOString(),
        input.servings,
        input.supermarketId ?? null,
        input.status,
        JSON.stringify(input.productAssignments ?? {}),
        input.reminderMinutes ?? null,
        input.nutritionSnapshot ? JSON.stringify(input.nutritionSnapshot) : null
      );
    const plan = this.getMealPlan(id)!;
    eventBus.emit(EVENTS.MEAL_PLAN_UPSERTED, { plan });
    return plan;
  }

  updateMealPlan(id: string, updates: Partial<Omit<MealPlan, 'id' | 'alias' | 'createdAt' | 'updatedAt'>>): MealPlan | null {
    const existing = this.getMealPlan(id);
    if (!existing) return null;

    const merged: MealPlan = {
      ...existing,
      ...updates,
      productAssignments: updates.productAssignments ?? existing.productAssignments,
      nutritionSnapshot: updates.nutritionSnapshot ?? existing.nutritionSnapshot,
    };

    this.db
      .prepare(
        `UPDATE meal_plans SET
             recipe_id = ?, scheduled_at = ?, servings = ?, supermarket_id = ?,
             status = ?, product_assignments_json = ?, reminder_minutes = ?, nutrition_snapshot_json = ?,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
      )
      .run(
        merged.recipeId,
        merged.scheduledAt.toISOString(),
        merged.servings,
        merged.supermarketId ?? null,
        merged.status,
        JSON.stringify(merged.productAssignments ?? {}),
        merged.reminderMinutes ?? null,
        merged.nutritionSnapshot ? JSON.stringify(merged.nutritionSnapshot) : null,
        id
      );
    const plan = this.getMealPlan(id)!;
    eventBus.emit(EVENTS.MEAL_PLAN_UPSERTED, { plan });
    return plan;
  }

  deleteMealPlan(id: string): boolean {
    const result = this.db.prepare('DELETE FROM meal_plans WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ===== Diary entries =====

  getDiaryEntry(id: string): DiaryEntry | null {
    const row = this.db
      .prepare(
        `SELECT d.*, r.title AS recipe_title, p.name AS product_name
         FROM diary_entries d
         LEFT JOIN recipes r ON r.id = d.recipe_id
         LEFT JOIN products p ON p.id = d.product_id
         WHERE d.id = ?`
      )
      .get(id) as any;
    return row ? rowToDiaryEntry(row) : null;
  }

  getDiaryEntriesForAlias(alias: string, fromIso?: string, toIso?: string): DiaryEntry[] {
    const clauses = ['d.alias = ?'];
    const params: any[] = [alias];
    if (fromIso) {
      clauses.push('d.eaten_at >= ?');
      params.push(fromIso);
    }
    if (toIso) {
      clauses.push('d.eaten_at <= ?');
      params.push(toIso);
    }
    const rows = this.db
      .prepare(
        `SELECT d.*, r.title AS recipe_title, p.name AS product_name
         FROM diary_entries d
         LEFT JOIN recipes r ON r.id = d.recipe_id
         LEFT JOIN products p ON p.id = d.product_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY d.eaten_at DESC`
      )
      .all(...params) as any[];
    return rows.map(rowToDiaryEntry);
  }

  addDiaryEntry(input: Omit<DiaryEntry, 'id' | 'createdAt'>): DiaryEntry {
    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO diary_entries (id, alias, eaten_at, source, plan_id, recipe_id, product_id, label, grams, servings, nutrition_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.alias,
        input.eatenAt.toISOString(),
        input.source,
        input.planId ?? null,
        input.recipeId ?? null,
        input.productId ?? null,
        input.label ?? null,
        input.grams ?? null,
        input.servings ?? null,
        JSON.stringify(input.nutrition ?? {})
      );
    const entry = this.getDiaryEntry(id)!;
    eventBus.emit(EVENTS.DIARY_UPSERTED, { entry });
    return entry;
  }

  deleteDiaryEntry(id: string): boolean {
    const existing = this.getDiaryEntry(id);
    const result = this.db.prepare('DELETE FROM diary_entries WHERE id = ?').run(id);
    if (result.changes > 0 && existing?.planId) {
      this.syncMealPlanStatusFromDiary(existing.planId);
    }
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

function safeParseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    return undefined;
  }
}

function rowToRecipe(row: any): Recipe {
  const assignments = row.product_assignments_json
    ? safeParseJson<Record<string, string>>(row.product_assignments_json)
    : undefined;
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle || undefined,
    description: row.description || undefined,
    metadata: JSON.parse(row.metadata),
    category: row.category || undefined,
    tags: row.tags ? JSON.parse(row.tags) : [],
    ingredientGroups: JSON.parse(row.ingredient_groups),
    preparationGroups: JSON.parse(row.preparation_groups),
    imageUrl: row.image_url,
    images: row.images ? JSON.parse(row.images) : [],
    sourceUrl: row.source_url || undefined,
    parentRecipeId: row.parent_recipe_id || undefined,
    variantName: row.variant_name || undefined,
    productAssignments: assignments && typeof assignments === 'object' ? assignments : undefined,
    preferredSupermarketId: row.preferred_supermarket_id || undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function parseDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function rowToCatalogueIngredient(row: any): CatalogueIngredient {
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    usageCount: typeof row.usage_count === 'number' ? row.usage_count : 0,
    nutritionPer100g: row.nutrition_json ? safeParseJson<NutritionData>(row.nutrition_json) : undefined,
    densityGPerMl: row.density_g_per_ml ?? undefined,
    gramsByUnit: row.grams_by_unit_json ? safeParseJson<Record<string, number>>(row.grams_by_unit_json) : undefined,
    defaultProductId: row.default_product_id || undefined,
  };
}

function rowToSupermarket(row: any): Supermarket {
  return {
    id: row.id,
    name: row.name,
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
  };
}

function rowToMealPlan(row: any): MealPlan {
  const status: MealPlanStatus =
    row.status === 'eaten' || row.status === 'skipped' ? row.status : 'planned';
  const servings = typeof row.servings === 'number' ? row.servings : Number(row.servings) || 1;
  return {
    id: row.id,
    alias: row.alias,
    recipeId: row.recipe_id,
    scheduledAt: parseDate(row.scheduled_at),
    servings,
    servingsConsumed: 0,
    servingsRemaining: servings,
    supermarketId: row.supermarket_id || undefined,
    status,
    productAssignments: row.product_assignments_json
      ? safeParseJson<Record<string, string>>(row.product_assignments_json) ?? {}
      : {},
    reminderMinutes: row.reminder_minutes ?? undefined,
    nutritionSnapshot: row.nutrition_snapshot_json
      ? safeParseJson<NutritionData>(row.nutrition_snapshot_json)
      : undefined,
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
  };
}

function rowToDiaryEntry(row: any): DiaryEntry {
  return {
    id: row.id,
    alias: row.alias,
    eatenAt: parseDate(row.eaten_at),
    source: row.source,
    planId: row.plan_id || undefined,
    recipeId: row.recipe_id || undefined,
    recipeTitle: typeof row.recipe_title === 'string' && row.recipe_title.trim()
      ? row.recipe_title
      : undefined,
    productId: row.product_id || undefined,
    productName: typeof row.product_name === 'string' && row.product_name.trim()
      ? row.product_name
      : undefined,
    label: row.label || undefined,
    grams: row.grams ?? undefined,
    servings: row.servings ?? undefined,
    nutrition: row.nutrition_json ? safeParseJson<NutritionData>(row.nutrition_json) ?? {} : {},
    createdAt: parseDate(row.created_at),
  };
}

// Create a singleton instance
export const db = new CookbookDatabase();
export default CookbookDatabase; 
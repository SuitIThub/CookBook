import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = './cookbook.db';

/** 1 EL ≈ 15 ml, 1 TL ≈ 5 ml – reverse of the broken unify migration. */
const ML_PER_EL = 15;
const ML_PER_TL = 5;
const ML_SPOON_THRESHOLD = 100;

/** Canonical Hauptkategorien. Keep in sync with src/lib/recipeCategories.ts */
const MAIN_CATEGORIES = [
  'Hauptgericht',
  'Vorspeise',
  'Dessert',
  'Getränk',
  'Snack',
  'Salat',
  'Suppe',
  'Beilage',
  'Frühstück',
  'Kuchen & Gebäck',
];

const MAIN_CATEGORY_ALIASES = {
  'brot & gebäck': 'Kuchen & Gebäck',
};

function resolveMainCategory(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (MAIN_CATEGORY_ALIASES[lower]) return MAIN_CATEGORY_ALIASES[lower];
  return MAIN_CATEGORIES.find((category) => category.toLowerCase() === lower) || null;
}

// Expected database schema - this is the source of truth
const EXPECTED_SCHEMA = {
  tables: {
    recipes: {
      columns: [
        { name: 'id', type: 'TEXT', nullable: false, primaryKey: true },
        { name: 'title', type: 'TEXT', nullable: false },
        { name: 'subtitle', type: 'TEXT', nullable: true },
        { name: 'description', type: 'TEXT', nullable: true },
        { name: 'metadata', type: 'TEXT', nullable: true },
        { name: 'category', type: 'TEXT', nullable: true },
        { name: 'tags', type: 'TEXT', nullable: true, defaultValue: "'[]'" },
        { name: 'ingredient_groups', type: 'TEXT', nullable: true },
        { name: 'preparation_groups', type: 'TEXT', nullable: true },
        { name: 'image_url', type: 'TEXT', nullable: true },
        { name: 'images', type: 'TEXT', nullable: true, defaultValue: "'[]'" },
        { name: 'source_url', type: 'TEXT', nullable: true },
        { name: 'parent_recipe_id', type: 'TEXT', nullable: true },
        { name: 'variant_name', type: 'TEXT', nullable: true },
        { name: 'product_assignments_json', type: 'TEXT', nullable: true },
        { name: 'preferred_supermarket_id', type: 'TEXT', nullable: true },
        { name: 'is_draft', type: 'INTEGER', nullable: false, defaultValue: '0' },
        { name: 'created_at', type: 'DATETIME', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'DATETIME', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' }
      ]
    },
    recipe_drafts: {
      columns: [
        { name: 'recipe_id', type: 'TEXT', nullable: false, primaryKey: true },
        { name: 'draft_recipe_id', type: 'TEXT', nullable: false, unique: true },
        { name: 'last_updated', type: 'DATETIME', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' }
      ]
    },
    shopping_lists: {
      columns: [
        { name: 'id', type: 'TEXT', nullable: false, primaryKey: true },
        { name: 'title', type: 'TEXT', nullable: false },
        { name: 'description', type: 'TEXT', nullable: true },
        { name: 'items', type: 'TEXT', nullable: true },
        { name: 'recipes', type: 'TEXT', nullable: true, defaultValue: "'[]'" },
        { name: 'is_permanent', type: 'INTEGER', nullable: false, defaultValue: '0' },
        { name: 'has_seen_global_template_prompt', type: 'INTEGER', nullable: false, defaultValue: '0' },
        { name: 'preferred_supermarket_id', type: 'TEXT', nullable: true },
        { name: 'created_at', type: 'DATETIME', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'DATETIME', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' }
      ]
    },
    ingredients: {
      columns: [
        { name: 'id', type: 'TEXT', nullable: false, primaryKey: true },
        { name: 'name', type: 'TEXT', nullable: false, unique: true },
        { name: 'description', type: 'TEXT', nullable: true },
        { name: 'usage_count', type: 'INTEGER', nullable: true, defaultValue: '1' },
        { name: 'nutrition_json', type: 'TEXT', nullable: true },
        { name: 'density_g_per_ml', type: 'REAL', nullable: true },
        { name: 'grams_by_unit_json', type: 'TEXT', nullable: true },
        { name: 'default_product_id', type: 'TEXT', nullable: true }
      ]
    },
    units: {
      columns: [
        { name: 'id', type: 'TEXT', nullable: false, primaryKey: true },
        { name: 'name', type: 'TEXT', nullable: false, unique: true },
        { name: 'category', type: 'TEXT', nullable: true },
        { name: 'base_unit', type: 'TEXT', nullable: true },
        { name: 'conversion_factor', type: 'REAL', nullable: true }
      ]
    },
    categories: {
      columns: [
        { name: 'id', type: 'TEXT', nullable: false, primaryKey: true },
        { name: 'name', type: 'TEXT', nullable: false, unique: true },
        { name: 'usage_count', type: 'INTEGER', nullable: true, defaultValue: '0' }
      ]
    },
    recipe_tags: {
      columns: [
        { name: 'id', type: 'TEXT', nullable: false, primaryKey: true },
        { name: 'name', type: 'TEXT', nullable: false, unique: true },
        { name: 'usage_count', type: 'INTEGER', nullable: true, defaultValue: '1' }
      ]
    },
    global_timers: {
      columns: [
        { name: 'id', type: 'TEXT', nullable: false, primaryKey: true },
        { name: 'label', type: 'TEXT', nullable: false },
        { name: 'duration', type: 'INTEGER', nullable: false },
        { name: 'remaining', type: 'INTEGER', nullable: false },
        { name: 'is_running', type: 'INTEGER', nullable: false, defaultValue: '0' },
        { name: 'is_completed', type: 'INTEGER', nullable: false, defaultValue: '0' },
        { name: 'recipe_name', type: 'TEXT', nullable: true },
        { name: 'step_description', type: 'TEXT', nullable: true },
        { name: 'recipe_id', type: 'TEXT', nullable: true },
        { name: 'step_id', type: 'TEXT', nullable: true },
        { name: 'start_time', type: 'INTEGER', nullable: true },
        { name: 'pause_time', type: 'INTEGER', nullable: true },
        { name: 'created_at', type: 'DATETIME', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'DATETIME', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' }
      ]
    },
    alias_settings: {
      // Composite primary key (alias, key). Per-alias/per-key client settings
      // synced across devices; updated_at is a client ms timestamp (LWW merge).
      primaryKey: ['alias', 'key'],
      columns: [
        { name: 'alias', type: 'TEXT', nullable: false },
        { name: 'key', type: 'TEXT', nullable: false },
        { name: 'value', type: 'TEXT', nullable: true },
        { name: 'updated_at', type: 'INTEGER', nullable: false }
      ]
    }
  },
  directories: [
    './public/uploads/recipes'
  ]
};

console.log('🚀 Starting comprehensive database migration...');

// Check if database exists
if (!fs.existsSync(dbPath)) {
  console.error('❌ Database file not found. Please run `npm run db:init` first.');
  process.exit(1);
}

const db = new Database(dbPath);

try {
  // Begin transaction
  db.exec('BEGIN TRANSACTION');

  console.log('📋 Analyzing current database schema...');

  // Get current tables
  const currentTables = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `).all();

  const currentTableNames = currentTables.map(t => t.name);
  console.log(`📊 Found ${currentTableNames.length} existing tables: ${currentTableNames.join(', ')}`);

  let changesCount = 0;

  // Process each expected table
  for (const [tableName, tableSchema] of Object.entries(EXPECTED_SCHEMA.tables)) {
    console.log(`\n🔍 Checking table: ${tableName}`);

    if (!currentTableNames.includes(tableName)) {
      // Table doesn't exist, create it
      console.log(`➕ Creating missing table: ${tableName}`);
      createTable(db, tableName, tableSchema);
      changesCount++;
    } else {
      // Table exists, check columns
      const currentColumns = db.prepare(`PRAGMA table_info(${tableName})`).all();
      const currentColumnNames = currentColumns.map(c => c.name);
      
      // Check for missing columns
      for (const expectedColumn of tableSchema.columns) {
        if (!currentColumnNames.includes(expectedColumn.name)) {
          console.log(`➕ Adding missing column: ${tableName}.${expectedColumn.name}`);
          addColumn(db, tableName, expectedColumn);
          changesCount++;
        }
      }

      // Check for column modifications (this is more complex, so we'll log warnings)
      for (const currentColumn of currentColumns) {
        const expectedColumn = tableSchema.columns.find(c => c.name === currentColumn.name);
        if (expectedColumn) {
          if (normalizeType(currentColumn.type) !== normalizeType(expectedColumn.type)) {
            console.log(`⚠️  Column type mismatch: ${tableName}.${currentColumn.name} (current: ${currentColumn.type}, expected: ${expectedColumn.type})`);
            console.log('   Note: Column type changes require manual intervention');
          }
        }
      }
    }
  }

  // Create required directories
  console.log('\n📁 Ensuring required directories exist...');
  for (const dir of EXPECTED_SCHEMA.directories) {
    const fullPath = path.resolve(dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      console.log(`✅ Created directory: ${fullPath}`);
      changesCount++;
    } else {
      console.log(`✅ Directory already exists: ${dir}`);
    }
  }

  // Perform data migrations if needed
  console.log('\n🔄 Checking for data migrations...');
  performDataMigrations(db);

  // Commit transaction
  db.exec('COMMIT');

  if (changesCount > 0) {
    console.log(`\n🎉 Database migration completed successfully! Made ${changesCount} changes.`);
  } else {
    console.log('\n✅ Database schema is already up to date!');
  }

  // Show final schema summary
  showSchemaSummary(db);

} catch (error) {
  // Rollback transaction on error
  db.exec('ROLLBACK');
  console.error('\n❌ Migration failed:', error.message);
  console.error(error.stack);
  process.exit(1);
} finally {
  db.close();
}

function createTable(db, tableName, tableSchema) {
  const definitions = tableSchema.columns.map(col => {
    let definition = `${col.name} ${col.type}`;
    
    if (col.primaryKey) definition += ' PRIMARY KEY';
    if (!col.nullable) definition += ' NOT NULL';
    if (col.unique) definition += ' UNIQUE';
    if (col.defaultValue) definition += ` DEFAULT ${col.defaultValue}`;
    
    return definition;
  });

  // Table-level composite primary key, e.g. PRIMARY KEY (alias, key)
  if (Array.isArray(tableSchema.primaryKey) && tableSchema.primaryKey.length > 0) {
    definitions.push(`PRIMARY KEY (${tableSchema.primaryKey.join(', ')})`);
  }

  const createSQL = `
    CREATE TABLE ${tableName} (
      ${definitions.join(',\n    ')}
    )
  `;

  db.exec(createSQL);
}

function addColumn(db, tableName, column) {
  let definition = `${column.name} ${column.type}`;
  
  if (column.defaultValue) {
    definition += ` DEFAULT ${column.defaultValue}`;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
}

function normalizeType(type) {
  return type.toUpperCase().split('(')[0].trim();
}

function roundSpoonAmount(n) {
  if (!Number.isFinite(n) || n <= 0) return n;
  const asInt = Math.round(n);
  if (Math.abs(n - asInt) < 0.05) return asInt;
  const half = Math.round(n * 2) / 2;
  if (Math.abs(n - half) < 0.05) return half;
  return Math.round(n * 10) / 10;
}

function isNearlyInteger(n, epsilon = 0.05) {
  return Number.isFinite(n) && Math.abs(n - Math.round(n)) < epsilon;
}

function isNearlyHalfStep(n, epsilon = 0.05) {
  if (!Number.isFinite(n)) return false;
  const half = Math.round(n * 2) / 2;
  return Math.abs(n - half) < epsilon;
}

/**
 * Convert a small ml amount back to EL or TL.
 * Prefer TL when "small enough" (< 1 EL) or when the amount fits TL cleanly but not EL.
 */
function convertMlToSpoon(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  if (amount >= ML_SPOON_THRESHOLD) return null;

  const asEl = amount / ML_PER_EL;
  const asTl = amount / ML_PER_TL;
  const elClean = isNearlyInteger(asEl) || isNearlyHalfStep(asEl);
  const tlClean = isNearlyInteger(asTl) || isNearlyHalfStep(asTl);

  // Below one tablespoon → teaspoon
  if (amount < ML_PER_EL) {
    return { amount: roundSpoonAmount(asTl), unit: 'TL' };
  }

  // Clean EL fit (15, 30, 45, 7.5→0.5, 22.5→1.5, …)
  if (elClean && asEl >= 0.5) {
    return { amount: roundSpoonAmount(asEl), unit: 'EL' };
  }

  // Clean TL fit that is not a clean EL (10, 20, 25, 35, 40, …)
  if (tlClean && asTl >= 1) {
    return { amount: roundSpoonAmount(asTl), unit: 'TL' };
  }

  // Fallback: EL for the rest under 100 ml
  return { amount: roundSpoonAmount(asEl), unit: 'EL' };
}

function isMlUnit(unit) {
  if (typeof unit !== 'string') return false;
  const u = unit.trim().toLowerCase();
  return u === 'ml' || u === 'milliliter' || u === 'millilitre';
}

function convertQuantitiesInIngredientGroups(groups) {
  let converted = 0;
  let toEl = 0;
  let toTl = 0;

  const visitIngredients = (items) => {
    if (!Array.isArray(items)) return items;
    return items.map((item) => {
      if (!item || typeof item !== 'object') return item;
      if (Array.isArray(item.ingredients)) {
        return { ...item, ingredients: visitIngredients(item.ingredients) };
      }
      if (!Array.isArray(item.quantities)) return item;
      const quantities = item.quantities.map((qty) => {
        if (!qty || typeof qty !== 'object') return qty;
        if (!isMlUnit(qty.unit)) return qty;
        const amount = typeof qty.amount === 'number' ? qty.amount : Number(qty.amount);
        const spoon = convertMlToSpoon(amount);
        if (!spoon) return qty;
        converted += 1;
        if (spoon.unit === 'EL') toEl += 1;
        else toTl += 1;
        return { ...qty, amount: spoon.amount, unit: spoon.unit };
      });
      return { ...item, quantities };
    });
  };

  const nextGroups = Array.isArray(groups) ? groups.map((g) => {
    if (!g || typeof g !== 'object') return g;
    return { ...g, ingredients: visitIngredients(g.ingredients) };
  }) : groups;

  return { groups: nextGroups, converted, toEl, toTl };
}

function fixSmallMlQuantitiesToSpoons(db) {
  const recipes = db.prepare('SELECT id, title, ingredient_groups FROM recipes').all();
  const updateStmt = db.prepare(`
    UPDATE recipes
    SET ingredient_groups = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  let recipesUpdated = 0;
  let quantitiesConverted = 0;
  let toEl = 0;
  let toTl = 0;

  for (const recipe of recipes) {
    let groups;
    try {
      groups = recipe.ingredient_groups ? JSON.parse(recipe.ingredient_groups) : [];
    } catch {
      console.log(`  ⚠️  Skipping recipe with invalid ingredient_groups JSON: ${recipe.id}`);
      continue;
    }

    const result = convertQuantitiesInIngredientGroups(groups);
    if (result.converted === 0) continue;

    updateStmt.run(JSON.stringify(result.groups), recipe.id);
    recipesUpdated += 1;
    quantitiesConverted += result.converted;
    toEl += result.toEl;
    toTl += result.toTl;
    console.log(
      `  ✅ ${recipe.title || recipe.id}: ${result.converted} quantity(ies) → EL/TL`
    );
  }

  return { recipesUpdated, quantitiesConverted, toEl, toTl };
}

function fixElTlUnitDefinitions(db) {
  try {
    const table = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='units'
    `).get();
    if (!table) return 0;

    const rows = db.prepare(`
      SELECT id, name, base_unit, conversion_factor
      FROM units
      WHERE UPPER(TRIM(name)) IN ('EL', 'TL')
    `).all();

    let fixed = 0;
    const update = db.prepare(`
      UPDATE units
      SET base_unit = NULL, conversion_factor = NULL
      WHERE id = ?
    `);

    for (const row of rows) {
      const base = typeof row.base_unit === 'string' ? row.base_unit.trim().toLowerCase() : '';
      if (base === 'ml' || row.conversion_factor != null) {
        update.run(row.id);
        fixed += 1;
      }
    }
    return fixed;
  } catch (err) {
    console.log(`  ⚠️  Could not fix EL/TL unit definitions: ${err.message}`);
    return 0;
  }
}

function performDataMigrations(db) {
  // Migrate shopping list items to include originalQuantity
  const shoppingListsWithItems = db.prepare('SELECT id, items FROM shopping_lists').all();
  for (const list of shoppingListsWithItems) {
    if (!list.items) continue;

    let items = JSON.parse(list.items);
    let needsUpdate = false;

    // Add originalQuantity to items if missing
    items = items.map(item => {
      if (item.recipeId && !item.originalQuantity) {
        needsUpdate = true;
        return {
          ...item,
          originalQuantity: { ...item.quantity }
        };
      }
      return item;
    });

    if (needsUpdate) {
      console.log(`📝 Adding originalQuantity to items in shopping list: ${list.id}`);
      db.prepare('UPDATE shopping_lists SET items = ? WHERE id = ?')
        .run(JSON.stringify(items), list.id);
    }
  }

  // Migrate shopping list recipes to include currentServings
  const listsWithRecipes = db.prepare('SELECT id, recipes FROM shopping_lists WHERE recipes IS NOT NULL').all();
  for (const list of listsWithRecipes) {
    if (!list.recipes) continue;

    let recipes = JSON.parse(list.recipes);
    let needsUpdate = false;

    // Add currentServings to recipes if missing
    recipes = recipes.map(recipe => {
      if (!recipe.currentServings && recipe.servings) {
        needsUpdate = true;
        return {
          ...recipe,
          currentServings: recipe.servings
        };
      }
      return recipe;
    });

    if (needsUpdate) {
      console.log(`📝 Adding currentServings to recipes in shopping list: ${list.id}`);
      db.prepare('UPDATE shopping_lists SET recipes = ? WHERE id = ?')
        .run(JSON.stringify(recipes), list.id);
    }
  }

  // Migration 1: Update existing recipes to have empty images array if they have null
  const updateResult = db.prepare(`
    UPDATE recipes 
    SET images = '[]' 
    WHERE images IS NULL OR images = ''
  `).run();

  if (updateResult.changes > 0) {
    console.log(`✅ Updated ${updateResult.changes} recipes with empty images array.`);
  }

  // Migration 2: Migrate old imageUrl field to new images array (if any recipes have imageUrl)
  const recipesWithOldImages = db.prepare(`
    SELECT id, title, image_url 
    FROM recipes 
    WHERE image_url IS NOT NULL AND image_url != ''
    AND (images IS NULL OR images = '' OR images = '[]')
  `).all();

  if (recipesWithOldImages.length > 0) {
    console.log(`📸 Found ${recipesWithOldImages.length} recipes with old image URLs. Migrating...`);
    
    const updateImageStmt = db.prepare(`
      UPDATE recipes 
      SET images = ? 
      WHERE id = ?
    `);

    for (const recipe of recipesWithOldImages) {
      // Create a new image object from the old imageUrl
      const imageObject = {
        id: generateId(),
        filename: path.basename(recipe.image_url),
        url: recipe.image_url,
        uploadedAt: new Date().toISOString()
      };

      updateImageStmt.run(JSON.stringify([imageObject]), recipe.id);
      console.log(`  ✅ Migrated image for recipe: ${recipe.title}`);
    }
  }

  // Migration 3: Initialize default categories
  console.log('🏷️  Checking for default categories...');
  const existingCategoriesCount = db.prepare('SELECT COUNT(*) as count FROM categories').get();
  
  if (existingCategoriesCount.count === 0) {
    console.log('➕ Adding default categories...');
    
    const insertCategory = db.prepare(`
      INSERT OR IGNORE INTO categories (id, name, usage_count) 
      VALUES (?, ?, ?)
    `);
    
    let categoriesAdded = 0;
    MAIN_CATEGORIES.forEach(category => {
      const result = insertCategory.run(generateId(), category, 0);
      if (result.changes > 0) categoriesAdded++;
    });
    
    console.log(`✅ Added ${categoriesAdded} default categories.`);
  } else {
    console.log(`✅ Categories table already has ${existingCategoriesCount.count} entries.`);
  }

  // Migration 4: Ensure recipes have tags field set to empty array if null
  const updateTagsResult = db.prepare(`
    UPDATE recipes 
    SET tags = '[]' 
    WHERE tags IS NULL OR tags = ''
  `).run();

  if (updateTagsResult.changes > 0) {
    console.log(`✅ Updated ${updateTagsResult.changes} recipes with empty tags array.`);
  }

  // Migration 5: Convert old time structure to new flexible time entries
  console.log('⏰ Migrating recipe time data to new flexible structure...');
  const recipesWithOldTimeFormat = db.prepare(`
    SELECT id, title, metadata 
    FROM recipes 
    WHERE metadata IS NOT NULL AND metadata != ''
  `).all();

  let timeUpdatesCount = 0;
  
  for (const recipe of recipesWithOldTimeFormat) {
    try {
      const metadata = JSON.parse(recipe.metadata);
      
      // Check if it's using old format (has preparationTime or cookingTime but no timeEntries)
      if ((metadata.preparationTime || metadata.cookingTime) && !metadata.timeEntries) {
        const timeEntries = [];
        
        if (metadata.preparationTime && metadata.preparationTime > 0) {
          timeEntries.push({
            id: generateId(),
            label: 'Vorbereitung',
            minutes: metadata.preparationTime
          });
        }
        
        if (metadata.cookingTime && metadata.cookingTime > 0) {
          timeEntries.push({
            id: generateId(),
            label: 'Kochzeit',
            minutes: metadata.cookingTime
          });
        }
        
        // Remove old fields and add new timeEntries
        delete metadata.preparationTime;
        delete metadata.cookingTime;
        metadata.timeEntries = timeEntries;
        
        // Update the recipe
        db.prepare('UPDATE recipes SET metadata = ? WHERE id = ?')
          .run(JSON.stringify(metadata), recipe.id);
        
        timeUpdatesCount++;
        console.log(`  ✅ Migrated time data for recipe: ${recipe.title}`);
      }
    } catch (error) {
      console.log(`  ⚠️  Failed to migrate time data for recipe ${recipe.title}: ${error.message}`);
    }
  }
  
  if (timeUpdatesCount > 0) {
    console.log(`✅ Migrated time data for ${timeUpdatesCount} recipes to new format.`);
  } else {
    console.log(`✅ No recipes needed time data migration.`);
  }

  // Migration 6: Update shopping list items structure (ingredientName → name)
  console.log('🛒 Migrating shopping list items to new structure...');
  const shoppingLists = db.prepare('SELECT * FROM shopping_lists').all();
  
  let shoppingListUpdatesCount = 0;
  
  for (const list of shoppingLists) {
    try {
      const items = JSON.parse(list.items || '[]');
      let needsUpdate = false;
      
      const updatedItems = items.map(item => {
        if (item.ingredientName && !item.name) {
          needsUpdate = true;
          return {
            id: item.id,
            name: item.ingredientName,
            description: item.description,
            quantity: item.quantity,
            isChecked: item.isChecked || false
          };
        }
        return item;
      });
      
      if (needsUpdate) {
        const updateStmt = db.prepare('UPDATE shopping_lists SET items = ? WHERE id = ?');
        updateStmt.run(JSON.stringify(updatedItems), list.id);
        shoppingListUpdatesCount++;
        console.log(`  ✅ Migrated items structure for shopping list: ${list.title}`);
      }
    } catch (error) {
      console.log(`  ⚠️  Failed to migrate items for shopping list ${list.title}: ${error.message}`);
    }
  }
  
  if (shoppingListUpdatesCount > 0) {
    console.log(`✅ Migrated item structure for ${shoppingListUpdatesCount} shopping lists.`);
  } else {
    console.log(`✅ No shopping lists needed item structure migration.`);
  }

  // Migration 7: Initialize recipes array for existing shopping lists
  console.log('🍽️  Initializing recipes array for existing shopping lists...');
  const updateRecipesResult = db.prepare(`
    UPDATE shopping_lists 
    SET recipes = '[]' 
    WHERE recipes IS NULL OR recipes = ''
  `).run();

  if (updateRecipesResult.changes > 0) {
    console.log(`✅ Initialized recipes array for ${updateRecipesResult.changes} shopping lists.`);
  } else {
    console.log(`✅ All shopping lists already have recipes array initialized.`);
  }

  // Migration 8: Migrate old draft structure to new structure
  console.log('📝 Migrating draft structure to new format...');
  
  // Check if old recipe_drafts table exists with old structure
  const oldDraftTableInfo = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name='recipe_drafts'
  `).get();
  
  if (oldDraftTableInfo) {
    // Check if it has the old structure (has title column)
    const draftColumns = db.prepare('PRAGMA table_info(recipe_drafts)').all();
    const hasTitleColumn = draftColumns.some(col => col.name === 'title');
    
    if (hasTitleColumn) {
      console.log('🔄 Found old draft structure. Migrating to new format...');
      
      // Get all old drafts
      const oldDrafts = db.prepare('SELECT * FROM recipe_drafts').all();
      
      if (oldDrafts.length > 0) {
        console.log(`📋 Found ${oldDrafts.length} drafts to migrate...`);
        
        // Drop old table
        db.exec('DROP TABLE recipe_drafts');
        console.log('  ✅ Dropped old recipe_drafts table');
        
        // Create new table structure
        db.exec(`
          CREATE TABLE recipe_drafts (
            recipe_id TEXT PRIMARY KEY,
            draft_recipe_id TEXT NOT NULL UNIQUE,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
            FOREIGN KEY (draft_recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
          )
        `);
        console.log('  ✅ Created new recipe_drafts table');
        
        // Migrate each draft
        const insertDraftRef = db.prepare(`
          INSERT INTO recipe_drafts (recipe_id, draft_recipe_id, last_updated)
          VALUES (?, ?, ?)
        `);
        
        let migratedCount = 0;
        for (const oldDraft of oldDrafts) {
          try {
            // Create a draft recipe from the old draft data
            const draftRecipeId = generateId();
            const insertDraftRecipe = db.prepare(`
              INSERT INTO recipes (
                id, title, subtitle, description, metadata, category, tags,
                ingredient_groups, preparation_groups, image_url, images, source_url,
                is_draft, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?)
            `);
            
            insertDraftRecipe.run(
              draftRecipeId,
              oldDraft.title,
              oldDraft.subtitle || null,
              oldDraft.description || null,
              oldDraft.metadata || '{}',
              oldDraft.category || null,
              oldDraft.tags || '[]',
              oldDraft.ingredient_groups || '[]',
              oldDraft.preparation_groups || '[]',
              oldDraft.image_url || null,
              oldDraft.images || '[]',
              oldDraft.source_url || null,
              oldDraft.last_updated || new Date().toISOString()
            );
            
            // Create reference
            insertDraftRef.run(
              oldDraft.recipe_id,
              draftRecipeId,
              oldDraft.last_updated || new Date().toISOString()
            );
            
            migratedCount++;
            console.log(`  ✅ Migrated draft for recipe: ${oldDraft.recipe_id}`);
          } catch (error) {
            console.log(`  ⚠️  Failed to migrate draft for recipe ${oldDraft.recipe_id}: ${error.message}`);
          }
        }
        
        console.log(`✅ Migrated ${migratedCount} drafts to new structure.`);
      } else {
        // No drafts to migrate, just recreate the table
        db.exec('DROP TABLE recipe_drafts');
        db.exec(`
          CREATE TABLE recipe_drafts (
            recipe_id TEXT PRIMARY KEY,
            draft_recipe_id TEXT NOT NULL UNIQUE,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
            FOREIGN KEY (draft_recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
          )
        `);
        console.log('✅ Recreated recipe_drafts table with new structure.');
      }
    } else {
      console.log('✅ Draft structure is already in new format.');
    }
  } else {
    // Table doesn't exist, create it
    db.exec(`
      CREATE TABLE IF NOT EXISTS recipe_drafts (
        recipe_id TEXT PRIMARY KEY,
        draft_recipe_id TEXT NOT NULL UNIQUE,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
        FOREIGN KEY (draft_recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
      )
    `);
    console.log('✅ Created recipe_drafts table.');
  }

  // Migration 9: Create permanent shopping lists if missing
  const PERMANENT_LIST_ID = 'permanent-shopping-list';
  const permanentListExists = db.prepare('SELECT id FROM shopping_lists WHERE id = ?').get(PERMANENT_LIST_ID);
  if (!permanentListExists) {
    console.log('🛒 Creating permanent shopping list...');
    db.prepare(`
      INSERT INTO shopping_lists (id, title, description, items, recipes, is_permanent, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      PERMANENT_LIST_ID,
      'Sammelliste',
      'Produkte und Rezepte hier sammeln – beim Öffnen einer Einkaufsliste können Sie sie dorthin übernehmen.',
      '[]',
      '[]'
    );
    console.log('✅ Permanent shopping list created.');
  }

  const GLOBAL_TEMPLATE_LIST_ID = 'global-template-shopping-list';
  const globalTemplateExists = db.prepare('SELECT id FROM shopping_lists WHERE id = ?').get(GLOBAL_TEMPLATE_LIST_ID);
  if (!globalTemplateExists) {
    console.log('🛒 Creating global template shopping list...');
    db.prepare(`
      INSERT INTO shopping_lists (id, title, description, items, recipes, is_permanent, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      GLOBAL_TEMPLATE_LIST_ID,
      'Vorlagen-Einkaufsliste',
      'Produkte und Rezepte, die Sie jeder Einkaufsliste hinzufügen können – die Vorlage bleibt unverändert.',
      '[]',
      '[]'
    );
    console.log('✅ Global template shopping list created.');
  } else {
    // Rename existing global template to new title/description
    const updated = db.prepare(`
      UPDATE shopping_lists SET title = ?, description = ?
      WHERE id = ? AND (title = ? OR title = ?)
    `).run(
      'Vorlagen-Einkaufsliste',
      'Produkte und Rezepte, die Sie jeder Einkaufsliste hinzufügen können – die Vorlage bleibt unverändert.',
      GLOBAL_TEMPLATE_LIST_ID,
      'Globale Sammelliste',
      'Vorlagen-Einkaufsliste'
    );
    if (updated.changes > 0) {
      console.log('✅ Global template shopping list renamed to "Vorlagen-Einkaufsliste".');
    }
  }

  // Migration 10: Reverse accidental TL/EL → ml conversion from a broken unit unify.
  // EL/TL were wrongly treated as child units of ml; small spoon amounts became ml.
  console.log('🥄 Correcting small ml amounts back to EL/TL in recipes...');
  const spoonFix = fixSmallMlQuantitiesToSpoons(db);
  if (spoonFix.recipesUpdated > 0) {
    console.log(
      `✅ Updated ${spoonFix.recipesUpdated} recipe(s), converted ${spoonFix.quantitiesConverted} quantity(ies) (EL: ${spoonFix.toEl}, TL: ${spoonFix.toTl}).`
    );
  } else {
    console.log('✅ No small ml spoon amounts needed correction.');
  }

  const unitsFix = fixElTlUnitDefinitions(db);
  if (unitsFix > 0) {
    console.log(`✅ Fixed ${unitsFix} unit definition(s) so EL/TL are base units again (not children of ml).`);
  }

  // Migration 12: Nutrition/tracker tables (Phase 1 of the calorie tracker).
  // Full CREATE TABLE IF NOT EXISTS with UNIQUE and index definitions.
  // The generic EXPECTED_SCHEMA migrator cannot express indexes or multi-column
  // UNIQUE constraints, so lookup-heavy junction tables need manual DDL both
  // here and in `initTables()` (src/lib/database.ts).
  console.log('🥕 Ensuring nutrition/tracker tables and indexes...');
  db.exec(`
    CREATE TABLE IF NOT EXISTS supermarkets (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
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
  db.exec('CREATE INDEX IF NOT EXISTS idx_products_name ON products(name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_products_ean ON products(ean)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS ingredient_products (
      ingredient_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ingredient_id, product_id),
      FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_ingredient_products_product ON ingredient_products(product_id)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS product_supermarkets (
      product_id TEXT NOT NULL,
      supermarket_id TEXT NOT NULL,
      price REAL NOT NULL,
      PRIMARY KEY (product_id, supermarket_id),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (supermarket_id) REFERENCES supermarkets(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_product_supermarkets_market ON product_supermarkets(supermarket_id)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS weight_logs (
      id TEXT PRIMARY KEY,
      alias TEXT NOT NULL,
      logged_at DATETIME NOT NULL,
      weight_kg REAL NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_weight_logs_alias_time ON weight_logs(alias, logged_at)');

  db.exec(`
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
  db.exec('CREATE INDEX IF NOT EXISTS idx_meal_plans_alias_time ON meal_plans(alias, scheduled_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_meal_plans_recipe ON meal_plans(recipe_id)');

  db.exec(`
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
  db.exec('CREATE INDEX IF NOT EXISTS idx_diary_alias_time ON diary_entries(alias, eaten_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_diary_plan ON diary_entries(plan_id)');
  console.log('✅ Nutrition/tracker tables ready.');

  // Migration 11: Remove Hauptkategorien that are not in the canonical list
  // (old import bugs injected source-site categories into the categories table).
  console.log('🏷️  Removing invalid main categories...');
  const allowedCategories = new Set(MAIN_CATEGORIES);

  const recipesWithCategory = db.prepare(`
    SELECT id, title, category FROM recipes
    WHERE category IS NOT NULL AND TRIM(category) != ''
  `).all();

  const updateRecipeCategory = db.prepare(`
    UPDATE recipes SET category = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `);

  let recipesRemapped = 0;
  let recipesCleared = 0;
  for (const recipe of recipesWithCategory) {
    const resolved = resolveMainCategory(recipe.category);
    if (resolved === recipe.category) continue;
    if (resolved) {
      updateRecipeCategory.run(resolved, recipe.id);
      recipesRemapped += 1;
      console.log(`  ✅ ${recipe.title}: "${recipe.category}" → "${resolved}"`);
    } else {
      updateRecipeCategory.run(null, recipe.id);
      recipesCleared += 1;
      console.log(`  🧹 ${recipe.title}: removed invalid category "${recipe.category}"`);
    }
  }

  const categoryRows = db.prepare('SELECT id, name FROM categories').all();
  const deleteCategory = db.prepare('DELETE FROM categories WHERE id = ?');
  let categoriesRemoved = 0;
  for (const row of categoryRows) {
    if (!allowedCategories.has(row.name)) {
      deleteCategory.run(row.id);
      categoriesRemoved += 1;
      console.log(`  🧹 Removed category "${row.name}"`);
    }
  }

  const existingCategory = db.prepare('SELECT id FROM categories WHERE name = ?');
  const insertCategoryIfMissing = db.prepare(`
    INSERT INTO categories (id, name, usage_count) VALUES (?, ?, 0)
  `);
  for (const category of MAIN_CATEGORIES) {
    if (!existingCategory.get(category)) {
      insertCategoryIfMissing.run(generateId(), category);
    }
  }

  if (recipesRemapped === 0 && recipesCleared === 0 && categoriesRemoved === 0) {
    console.log('✅ No invalid main categories found.');
  } else {
    console.log(
      `✅ Category cleanup: ${categoriesRemoved} list entries removed, ${recipesRemapped} recipe(s) remapped, ${recipesCleared} recipe(s) uncategorized.`
    );
  }
}

function showSchemaSummary(db) {
  console.log('\n📊 Final Database Schema Summary:');
  
  for (const tableName of Object.keys(EXPECTED_SCHEMA.tables)) {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    console.log(`\n  📋 Table: ${tableName} (${columns.length} columns)`);
    
    for (const col of columns) {
      const nullable = col.notnull ? '' : ' (nullable)';
      const pk = col.pk ? ' [PK]' : '';
      const defaultVal = col.dflt_value ? ` default: ${col.dflt_value}` : '';
      console.log(`    • ${col.name}: ${col.type}${nullable}${pk}${defaultVal}`);
    }
  }

  const totalRecords = db.prepare('SELECT COUNT(*) as count FROM recipes').get();
  console.log(`\n📈 Total recipes in database: ${totalRecords.count}`);
}

// Helper function to generate UUID
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
} 
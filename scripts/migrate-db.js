import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = './cookbook.db';

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
        { name: 'created_at', type: 'DATETIME', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'DATETIME', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' }
      ]
    },
    shopping_lists: {
      columns: [
        { name: 'id', type: 'TEXT', nullable: false, primaryKey: true },
        { name: 'title', type: 'TEXT', nullable: false },
        { name: 'description', type: 'TEXT', nullable: true },
        { name: 'items', type: 'TEXT', nullable: true },
        { name: 'recipes', type: 'TEXT', nullable: true, defaultValue: "'[]'" },
        { name: 'created_at', type: 'DATETIME', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'DATETIME', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' }
      ]
    },
    ingredients: {
      columns: [
        { name: 'id', type: 'TEXT', nullable: false, primaryKey: true },
        { name: 'name', type: 'TEXT', nullable: false, unique: true },
        { name: 'description', type: 'TEXT', nullable: true },
        { name: 'usage_count', type: 'INTEGER', nullable: true, defaultValue: '1' }
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
  const columns = tableSchema.columns.map(col => {
    let definition = `${col.name} ${col.type}`;
    
    if (col.primaryKey) definition += ' PRIMARY KEY';
    if (!col.nullable) definition += ' NOT NULL';
    if (col.unique) definition += ' UNIQUE';
    if (col.defaultValue) definition += ` DEFAULT ${col.defaultValue}`;
    
    return definition;
  }).join(',\n    ');

  const createSQL = `
    CREATE TABLE ${tableName} (
      ${columns}
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
    
    const defaultCategories = [
      'Hauptgericht',
      'Vorspeise',
      'Dessert',
      'Getränk',
      'Snack',
      'Salat',
      'Suppe',
      'Beilage',
      'Frühstück',
      'Kuchen & Gebäck'
    ];
    
    let categoriesAdded = 0;
    defaultCategories.forEach(category => {
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

  // Add more data migrations here as needed...
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
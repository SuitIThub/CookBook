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
        { name: 'ingredient_groups', type: 'TEXT', nullable: true },
        { name: 'preparation_groups', type: 'TEXT', nullable: true },
        { name: 'image_url', type: 'TEXT', nullable: true },
        { name: 'images', type: 'TEXT', nullable: true, defaultValue: "'[]'" },
        { name: 'created_at', type: 'DATETIME', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'DATETIME', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' }
      ]
    },
    shopping_lists: {
      columns: [
        { name: 'id', type: 'TEXT', nullable: false, primaryKey: true },
        { name: 'title', type: 'TEXT', nullable: false },
        { name: 'items', type: 'TEXT', nullable: true },
        { name: 'created_at', type: 'DATETIME', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'DATETIME', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' }
      ]
    },
    ingredients: {
      columns: [
        { name: 'id', type: 'TEXT', nullable: false, primaryKey: true },
        { name: 'name', type: 'TEXT', nullable: false, unique: true },
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
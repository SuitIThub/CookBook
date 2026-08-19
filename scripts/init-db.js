import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

const db = new Database('./cookbook.db');

// Initialize tables
db.exec(`
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

db.exec(`
  CREATE TABLE IF NOT EXISTS recipe_drafts (
    recipe_id TEXT PRIMARY KEY,
    draft_recipe_id TEXT NOT NULL UNIQUE,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
    FOREIGN KEY (draft_recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS shopping_lists (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    items TEXT,
    recipes TEXT DEFAULT '[]',
    is_permanent INTEGER NOT NULL DEFAULT 0,
    has_seen_global_template_prompt INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS ingredients (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    usage_count INTEGER DEFAULT 1,
    nutrition_json TEXT,
    density_g_per_ml REAL,
    grams_by_unit_json TEXT,
    default_product_id TEXT
  )
`);

// Ensure shopping_lists has preferred_supermarket_id column even for
// existing DBs created before Phase 1.
try {
  db.exec(`ALTER TABLE shopping_lists ADD COLUMN preferred_supermarket_id TEXT`);
} catch (error) {
  // column already exists
}

// Phase 1 nutrition/tracker tables (see plan and src/lib/database.ts).
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

db.close();
console.log('\n🎉 Database initialization completed successfully!');
console.log('📍 Database file: ./cookbook.db');
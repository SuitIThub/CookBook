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
    ingredient_groups TEXT,
    preparation_groups TEXT,
    image_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS shopping_lists (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    items TEXT,
    recipes TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS ingredients (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    usage_count INTEGER DEFAULT 1
  )
`);

db.close();
console.log('\n🎉 Database initialization completed successfully!');
console.log('📍 Database file: ./cookbook.db');
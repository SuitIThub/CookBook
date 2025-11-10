/**
 * Migration script to unify units in existing recipes
 * 
 * This script:
 * 1. Reads all recipes from the database
 * 2. Normalizes all units to base units (e.g., kg -> g, l -> ml)
 * 3. Updates the recipes in the database
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import unit conversion functions
// Since this is a Node.js script, we need to use a different approach
// We'll define the conversion logic here

const BASE_UNITS = {
  'g': { name: 'g', isBaseUnit: true, category: 'weight' },
  'ml': { name: 'ml', isBaseUnit: true, category: 'volume' },
  'Stück': { name: 'Stück', isBaseUnit: true, category: 'piece' },
  'Zehe': { name: 'Zehe', isBaseUnit: true, category: 'natural' },
  'Bund': { name: 'Bund', isBaseUnit: true, category: 'natural' },
  'Kopf': { name: 'Kopf', isBaseUnit: true, category: 'natural' },
  'Knolle': { name: 'Knolle', isBaseUnit: true, category: 'natural' },
  'Stange': { name: 'Stange', isBaseUnit: true, category: 'natural' },
  'Zweig': { name: 'Zweig', isBaseUnit: true, category: 'natural' },
  'Blatt': { name: 'Blatt', isBaseUnit: true, category: 'natural' },
  'Scheibe': { name: 'Scheibe', isBaseUnit: true, category: 'natural' },
  'Prise': { name: 'Prise', isBaseUnit: true, category: 'small' },
  'Msp.': { name: 'Msp.', isBaseUnit: true, category: 'small' },
  'Tropfen': { name: 'Tropfen', isBaseUnit: true, category: 'small' },
  'Spritzer': { name: 'Spritzer', isBaseUnit: true, category: 'small' },
  'Schuss': { name: 'Schuss', isBaseUnit: true, category: 'small' },
  'Hauch': { name: 'Hauch', isBaseUnit: true, category: 'small' },
  'Handvoll': { name: 'Handvoll', isBaseUnit: true, category: 'natural' }
};

const UNIT_CONVERSIONS = {
  // Weight units -> g
  'kg': { baseUnit: 'g', factor: 1000 },
  
  // Volume units -> ml
  'l': { baseUnit: 'ml', factor: 1000 },
  'L': { baseUnit: 'ml', factor: 1000 },
  'Liter': { baseUnit: 'ml', factor: 1000 },
  'TL': { baseUnit: 'ml', factor: 5 },
  'EL': { baseUnit: 'ml', factor: 15 },
  'Tasse': { baseUnit: 'ml', factor: 250 },
  'Becher': { baseUnit: 'ml', factor: 200 },
  'Glas': { baseUnit: 'ml', factor: 200 },
  
  // Piece units -> Stück
  'Pck.': { baseUnit: 'Stück', factor: 1 },
  'Pck': { baseUnit: 'Stück', factor: 1 },
  'Packung': { baseUnit: 'Stück', factor: 1 },
  'Pack': { baseUnit: 'Stück', factor: 1 },
  'Päckchen': { baseUnit: 'Stück', factor: 1 },
  'Dose': { baseUnit: 'Stück', factor: 1 },
  'Dosen': { baseUnit: 'Stück', factor: 1 },
  'Flasche': { baseUnit: 'Stück', factor: 1 },
  'Flaschen': { baseUnit: 'Stück', factor: 1 },
  'Tube': { baseUnit: 'Stück', factor: 1 },
  'Tuben': { baseUnit: 'Stück', factor: 1 },
  'Würfel': { baseUnit: 'Stück', factor: 1 },
  'Riegel': { baseUnit: 'Stück', factor: 1 },
  'Rolle': { baseUnit: 'Stück', factor: 1 },
  'Rollen': { baseUnit: 'Stück', factor: 1 },
  'Stk.': { baseUnit: 'Stück', factor: 1 },
  'Stk': { baseUnit: 'Stück', factor: 1 },
  'St.': { baseUnit: 'Stück', factor: 1 },
  'St': { baseUnit: 'Stück', factor: 1 }
};

function normalizeUnit(amount, unit) {
  if (!unit || unit.trim() === '') {
    return { amount, unit: '' };
  }
  
  const normalizedUnit = unit.trim();
  
  // Check if it's already a base unit
  if (BASE_UNITS[normalizedUnit]) {
    return { amount, unit: normalizedUnit };
  }
  
  // Check if it needs conversion
  const conversion = UNIT_CONVERSIONS[normalizedUnit];
  if (conversion) {
    return {
      amount: amount * conversion.factor,
      unit: conversion.baseUnit
    };
  }
  
  // Unit not found, return as-is (might be a base unit with different casing)
  // Try case-insensitive match
  const lowerUnit = normalizedUnit.toLowerCase();
  for (const [key, value] of Object.entries(BASE_UNITS)) {
    if (key.toLowerCase() === lowerUnit) {
      return { amount, unit: key };
    }
  }
  
  // Still not found, return as-is
  return { amount, unit: normalizedUnit };
}

function normalizeIngredientGroups(ingredientGroups) {
  if (!Array.isArray(ingredientGroups)) {
    return ingredientGroups;
  }
  
  return ingredientGroups.map(group => {
    if (!group) return group;
    
    const normalizedGroup = {
      ...group,
      ingredients: (group.ingredients || []).map(ingredient => {
        if (!ingredient || typeof ingredient !== 'object') return ingredient;
        
        // Check if it's an ingredient group (nested)
        if (ingredient.ingredients) {
          return normalizeIngredientGroups([ingredient])[0];
        }
        
        // It's an ingredient
        if (!ingredient.quantities || !Array.isArray(ingredient.quantities)) {
          return ingredient;
        }
        
        const normalizedQuantities = ingredient.quantities.map(qty => {
          if (!qty || typeof qty !== 'object') return qty;
          return normalizeUnit(qty.amount || 0, qty.unit || '');
        });
        
        return {
          ...ingredient,
          quantities: normalizedQuantities
        };
      })
    };
    
    return normalizedGroup;
  });
}

const dbPath = path.join(__dirname, '..', 'cookbook.db');

if (!fs.existsSync(dbPath)) {
  console.error('❌ Database file not found:', dbPath);
  process.exit(1);
}

console.log('🚀 Starting unit unification migration...');
console.log('📁 Database:', dbPath);

const db = new Database(dbPath);

try {
  // Get all recipes
  const recipes = db.prepare('SELECT id, ingredient_groups FROM recipes').all();
  
  console.log(`📋 Found ${recipes.length} recipes to process`);
  
  let updatedCount = 0;
  let errorCount = 0;
  
  const updateStmt = db.prepare('UPDATE recipes SET ingredient_groups = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  
  const updateTransaction = db.transaction((recipes) => {
    for (const recipe of recipes) {
      try {
        if (!recipe.ingredient_groups) {
          continue;
        }
        
        const ingredientGroups = JSON.parse(recipe.ingredient_groups);
        const normalizedGroups = normalizeIngredientGroups(ingredientGroups);
        
        // Check if anything changed
        const originalJson = JSON.stringify(ingredientGroups);
        const normalizedJson = JSON.stringify(normalizedGroups);
        
        if (originalJson !== normalizedJson) {
          updateStmt.run(JSON.stringify(normalizedGroups), recipe.id);
          updatedCount++;
          console.log(`✅ Updated recipe: ${recipe.id}`);
        }
      } catch (error) {
        console.error(`❌ Error processing recipe ${recipe.id}:`, error.message);
        errorCount++;
      }
    }
  });
  
  updateTransaction(recipes);
  
  console.log('\n✨ Migration completed!');
  console.log(`✅ Updated: ${updatedCount} recipes`);
  if (errorCount > 0) {
    console.log(`❌ Errors: ${errorCount} recipes`);
  }
  
} catch (error) {
  console.error('❌ Migration failed:', error);
  process.exit(1);
} finally {
  db.close();
}


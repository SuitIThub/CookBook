import type { APIRoute } from 'astro';
import { db } from '../../../../lib/database';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const text = body.text;
    
    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'No text provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Parse JSON from text
    let importedRecipes: any[] = [];
    
    try {
      const data = JSON.parse(text);
      
      // Handle both single recipe and array of recipes
      importedRecipes = Array.isArray(data) ? data : [data];
      
      console.log(`Processing text import with ${importedRecipes.length} recipe(s)`);
      
      // Process images if they contain base64 data (similar to .rcb file handling)
      const uploadsDir = path.join(process.cwd(), 'public/uploads/recipes');
      
      // Ensure uploads directory exists
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
        console.log(`Created uploads directory: ${uploadsDir}`);
      }
      
      for (const recipe of importedRecipes) {
        if (recipe.images && recipe.images.length > 0) {
          // Process images and filter out those without data
          const processedImages = [];
          
          for (const image of recipe.images) {
            // Handle external URLs
            if (image.isExternal && image.url) {
              processedImages.push({
                id: image.id || uuidv4(),
                filename: image.filename,
                url: image.url,
                uploadedAt: image.uploadedAt || new Date()
              });
              console.log(`Preserved external image URL: ${image.url}`);
              continue;
            }

            // Handle local images with base64 data
            if (image.data && image.data.trim()) {
              try {
                // Generate new filename to avoid conflicts
                const fileExtension = path.extname(image.filename) || '.jpg';
                const newFilename = `${uuidv4()}${fileExtension}`;
                const imagePath = path.join(uploadsDir, newFilename);
                
                // Save image from base64 data
                const imageBuffer = Buffer.from(image.data, 'base64');
                fs.writeFileSync(imagePath, imageBuffer);
                
                // Create new image object with updated properties
                const processedImage = {
                  id: image.id || uuidv4(),
                  filename: newFilename,
                  url: `/uploads/recipes/${newFilename}`,
                  uploadedAt: image.uploadedAt || new Date()
                };
                
                processedImages.push(processedImage);
                console.log(`Successfully imported local image: ${newFilename}`);
              } catch (error) {
                console.error(`Failed to import local image ${image.filename}:`, error);
                // Skip this image but continue with others
              }
            } else {
              console.warn(`Skipping image ${image.filename} - no base64 data found`);
            }
          }
          
          // Replace the images array with successfully processed images
          recipe.images = processedImages;
        }
      }
    } catch (parseError) {
      return new Response(JSON.stringify({ error: 'Invalid JSON format: ' + (parseError instanceof Error ? parseError.message : 'Unknown error') }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Process and save imported recipes
    const createdRecipes = [];
    
    for (const recipeData of importedRecipes) {
      // Create mapping of old IDs to new IDs for both regular and intermediate ingredients
      const ingredientIdMap = new Map<string, string>();
      const intermediateIdMap = new Map<string, string>();
      
      // Validate input structure
      if (!Array.isArray(recipeData.ingredientGroups)) {
        console.error(`Invalid ingredientGroups for recipe "${recipeData.title}":`, recipeData.ingredientGroups);
        throw new Error(`Invalid ingredientGroups structure for recipe "${recipeData.title}"`);
      }
      
      if (!Array.isArray(recipeData.preparationGroups)) {
        console.error(`Invalid preparationGroups for recipe "${recipeData.title}":`, recipeData.preparationGroups);
        throw new Error(`Invalid preparationGroups structure for recipe "${recipeData.title}"`);
      }
      
      // Process ingredient groups and create ID mapping
      const newIngredientGroups = mapIngredientsWithNewIds(recipeData.ingredientGroups || [], ingredientIdMap);
      
      // Process preparation groups and update linkedIngredients references
      const newPreparationGroups = mapPreparationWithUpdatedLinks(recipeData.preparationGroups || [], ingredientIdMap, intermediateIdMap);
      
      // Count total ingredients (including nested ones) - for validation
      const countIngredients = (groups: any[]): number => {
        let count = 0;
        groups.forEach(group => {
          if (group && typeof group === 'object') {
            if (group.ingredients && Array.isArray(group.ingredients)) {
              group.ingredients.forEach((item: any) => {
                if (item && typeof item === 'object') {
                  if (item.ingredients && Array.isArray(item.ingredients)) {
                    // It's a nested group
                    count += countIngredients([item]);
                  } else if (item.name) {
                    // It's an ingredient
                    count++;
                  }
                }
              });
            }
          }
        });
        return count;
      };
      
      // Count groups recursively
      const countGroups = (groups: any[]): number => {
        let count = 0;
        groups.forEach(group => {
          if (group && typeof group === 'object') {
            count++; // Count this group
            if (group.ingredients && Array.isArray(group.ingredients)) {
              group.ingredients.forEach((item: any) => {
                if (item && typeof item === 'object' && item.ingredients && Array.isArray(item.ingredients)) {
                  // It's a nested group
                  count += countGroups([item]);
                }
              });
            }
          }
        });
        return count;
      };
      
      const totalIngredients = countIngredients(newIngredientGroups);
      const totalGroups = countGroups(newIngredientGroups);
      
      // Validate the processed structure
      if (newIngredientGroups.length === 0 && totalIngredients > 0) {
        console.error(`Warning: Recipe "${recipeData.title}" has ${totalIngredients} ingredients but no groups after processing!`);
      }
      
      // The ID map includes both ingredients and groups, so the count should match
      const expectedTotalIds = totalIngredients + totalGroups;
      if (expectedTotalIds !== ingredientIdMap.size) {
        console.warn(`Warning: Total ID count mismatch for recipe "${recipeData.title}": expected ${expectedTotalIds} (${totalIngredients} ingredients + ${totalGroups} groups), but mapped ${ingredientIdMap.size} IDs`);
        console.log(`Ingredient groups structure (first 1000 chars):`, JSON.stringify(newIngredientGroups, null, 2).substring(0, 1000));
      }
      
      // Generate new ID to avoid conflicts
      const newRecipeData = {
        ...recipeData,
        id: undefined, // Let the database generate a new ID
        createdAt: undefined,
        updatedAt: undefined,
        ingredientGroups: newIngredientGroups,
        preparationGroups: newPreparationGroups
      };
      
      // Create the recipe
      const createdRecipe = db.createRecipe(newRecipeData);
      createdRecipes.push(createdRecipe);
    }

    // Count total images processed
    const totalImages = createdRecipes.reduce((sum, recipe) => sum + (recipe.images?.length || 0), 0);
    
    return new Response(JSON.stringify({ 
      success: true, 
      imported: createdRecipes.length,
      totalImages: totalImages,
      recipes: createdRecipes,
      recipeId: createdRecipes.length === 1 ? createdRecipes[0].id : null
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error: unknown) {
    console.error('Error importing recipes from text:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Import failed: ' + errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

function mapIngredientsWithNewIds(items: any[], idMap: Map<string, string>): any[] {
  if (!Array.isArray(items)) {
    console.warn('mapIngredientsWithNewIds: items is not an array', items);
    return [];
  }
  
  return items.map(item => {
    if (!item || typeof item !== 'object') {
      console.warn('mapIngredientsWithNewIds: invalid item', item);
      return item;
    }
    
    const oldId = item.id;
    const newId = uuidv4(); // Always generate new ID
    
    // Store the mapping only if there was an old ID (for linking purposes)
    // Note: We map IDs for both groups and ingredients, but only ingredients need to be in the map
    // for linkedIngredients references. Groups are mapped for consistency.
    if (oldId) {
      idMap.set(oldId, newId);
    }
    
    // Create new item with new ID
    const newItem: any = { ...item, id: newId };
    
    // Recursively handle nested structures (for ingredient groups)
    // Both ingredient groups and nested groups have an 'ingredients' property
    if (item.ingredients && Array.isArray(item.ingredients)) {
      newItem.ingredients = mapIngredientsWithNewIds(item.ingredients, idMap);
    }
    
    // Ensure the structure is preserved - if it's an ingredient, it should have 'name' and 'quantities'
    // If it's a group, it should have 'ingredients'
    if (!newItem.ingredients && !newItem.name) {
      console.warn('mapIngredientsWithNewIds: item has neither ingredients nor name', newItem);
    }
    
    return newItem;
  });
}

function mapPreparationWithUpdatedLinks(items: any[], ingredientIdMap: Map<string, string>, intermediateIdMap: Map<string, string>): any[] {
  return items.map(item => {
    const newItem = { ...item, id: uuidv4() };
    
    // Handle preparation steps
    if (item.steps) {
      newItem.steps = mapPreparationWithUpdatedLinks(item.steps, ingredientIdMap, intermediateIdMap);
    }
    
    // Update intermediate ingredients and build mapping
    if (item.intermediateIngredients) {
      newItem.intermediateIngredients = item.intermediateIngredients.map((ing: any) => {
        const oldId = ing.id;
        const newId = uuidv4();
        
        // Store the mapping for intermediate ingredients
        if (oldId) {
          intermediateIdMap.set(oldId, newId);
        }
        
        return {
          ...ing,
          id: newId
        };
      });
    }
    
    // Update linkedIngredients to use new IDs (both regular and intermediate)
    if (item.linkedIngredients && Array.isArray(item.linkedIngredients)) {
      newItem.linkedIngredients = item.linkedIngredients.map((link: any) => {
        let newIngredientId;
        
        if (link.isIntermediate) {
          // Look in intermediate ingredients map
          newIngredientId = intermediateIdMap.get(link.ingredientId);
        } else {
          // Look in regular ingredients map
          newIngredientId = ingredientIdMap.get(link.ingredientId);
        }
        
        return {
          ...link,
          ingredientId: newIngredientId || link.ingredientId // fallback to original if not found
        };
      });
    }
    
    return newItem;
  });
}

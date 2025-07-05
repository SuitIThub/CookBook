import type { APIRoute } from 'astro';
import { db } from '../../lib/database';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export const POST: APIRoute = async ({ request }) => {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return new Response(JSON.stringify({ error: 'No file provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const fileContent = await file.arrayBuffer();
    const buffer = Buffer.from(fileContent);
    
    let importedRecipes: any[] = [];

    if (file.name.endsWith('.json') || file.name.endsWith('.rcb')) {
      // Handle both JSON and custom format import
      const jsonContent = buffer.toString('utf-8');
      const data = JSON.parse(jsonContent);
      
      // Handle both single recipe and array of recipes
      importedRecipes = Array.isArray(data) ? data : [data];
      
      if (file.name.endsWith('.json')) {
        console.log(`Processing JSON file with ${importedRecipes.length} recipe(s) - images will not be imported`);
      }
      
      // If it's a .rcb file, extract and save images from base64 data
      if (file.name.endsWith('.rcb')) {
        const uploadsDir = path.join(process.cwd(), 'public/uploads/recipes');
        
        // Ensure uploads directory exists
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
          console.log(`Created uploads directory: ${uploadsDir}`);
        }
        
        console.log(`Processing RCB file with ${importedRecipes.length} recipe(s)`);
        console.log(`Uploads directory: ${uploadsDir}`);
        
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
      }
    } else {
      return new Response(JSON.stringify({ error: 'Unsupported file format. Please use .json or .rcb files.' }), {
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
      
      // Process ingredient groups and create ID mapping
      const newIngredientGroups = mapIngredientsWithNewIds(recipeData.ingredientGroups || [], ingredientIdMap);
      
      // Process preparation groups and update linkedIngredients references
      const newPreparationGroups = mapPreparationWithUpdatedLinks(recipeData.preparationGroups || [], ingredientIdMap, intermediateIdMap);
      
      console.log(`Mapped ${ingredientIdMap.size} ingredient IDs and ${intermediateIdMap.size} intermediate ingredient IDs for recipe: ${recipeData.title}`);
      
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
    console.error('Error importing recipes:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Import failed: ' + errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

function mapIngredientsWithNewIds(items: any[], idMap: Map<string, string>): any[] {
  return items.map(item => {
    const oldId = item.id;
    const newId = uuidv4();
    
    // Store the mapping
    if (oldId) {
      idMap.set(oldId, newId);
    }
    
    const newItem = { ...item, id: newId };
    
    // Recursively handle nested structures
    if (item.ingredients) {
      newItem.ingredients = mapIngredientsWithNewIds(item.ingredients, idMap);
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
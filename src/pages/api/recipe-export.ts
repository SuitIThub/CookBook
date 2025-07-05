import type { APIRoute } from 'astro';
import { db } from '../../lib/database';
import type { Recipe } from '../../types/recipe';
import * as fs from 'fs';
import * as path from 'path';

export const GET: APIRoute = async ({ url }) => {
  try {
    const searchParams = new URL(url).searchParams;
    const recipeId = searchParams.get('id');
    const format = searchParams.get('format') || 'json';
    const ids = searchParams.get('ids')?.split(',');

    if (ids && ids.length > 0) {
      // Export selected recipes
      const recipes = ids.map(id => db.getRecipe(id)).filter((recipe): recipe is Recipe => recipe !== null);
      
      if (recipes.length === 0) {
        return new Response(JSON.stringify({ error: 'No recipes found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (format === 'json') {
        // Export as JSON, keeping image URLs but removing local image data
        const exportData = recipes.map(recipe => {
          const cleanRecipe = { ...recipe };
          if (cleanRecipe.images) {
            cleanRecipe.images = cleanRecipe.images.map(img => {
              // Keep only URL and basic image info for external images
              if (img.url && !img.url.startsWith('/uploads/')) {
                return {
                  id: img.id,
                  filename: img.filename,
                  url: img.url,
                  uploadedAt: img.uploadedAt
                };
              }
              // Remove local images
              return null;
            }).filter(Boolean);
          }
          return cleanRecipe;
        });
        
        return new Response(JSON.stringify(exportData, null, 2), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="selected_recipes.json"`
          }
        });
      } else {
        // Export as custom format with images
        return await exportRecipeWithImages(recipes);
      }
    } else if (recipeId) {
      // Export single recipe
      const recipe = db.getRecipe(recipeId);
      if (!recipe) {
        return new Response(JSON.stringify({ error: 'Recipe not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (format === 'json') {
        // Export as JSON without any image data
        const { images, imageUrl, ...exportData } = recipe;
        // Completely remove images and imageUrl to prevent UI issues
        
        return new Response(JSON.stringify(exportData, null, 2), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="${recipe.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json"`
          }
        });
      } else {
        // Export as custom format with images embedded as base64
        return await exportRecipeWithImages([recipe]);
      }
    } else {
      // Export all recipes
      const recipes = db.getAllRecipes();
      
      if (format === 'json') {
        // Export all as JSON without any image data
        const exportData = recipes.map(recipe => {
          const { images, imageUrl, ...cleanRecipe } = recipe;
          return cleanRecipe;
          // Completely remove images and imageUrl to prevent UI issues
        });
        
        return new Response(JSON.stringify(exportData, null, 2), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': 'attachment; filename="recipes.json"'
          }
        });
      } else {
        // Export all as custom format with images
        return await exportRecipeWithImages(recipes);
      }
    }
  } catch (error) {
    console.error('Error exporting recipes:', error);
    return new Response(JSON.stringify({ error: 'Export failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

async function exportRecipeWithImages(recipes: any[]): Promise<Response> {
  console.log(`Exporting ${recipes.length} recipe(s) with images`);
  
  // Create export data with base64 encoded local images and preserved URLs for external images
  const exportData = await Promise.all(recipes.map(async (recipe, recipeIndex) => {
    console.log(`Processing recipe ${recipeIndex + 1}: ${recipe.title}`);
    console.log(`Recipe has ${recipe.images?.length || 0} image(s)`);
    
    const processedImages = [];
    
    for (const image of (recipe.images || [])) {
      console.log(`Processing image:`, image);
      
      // If it's an external URL, keep it as is
      if (image.url && !image.url.startsWith('/uploads/')) {
        processedImages.push({
          ...image,
          data: null, // No base64 data for external URLs
          isExternal: true // Mark as external URL
        });
        console.log(`Preserved external URL: ${image.url}`);
        continue;
      }
      
      // Handle local images
      let relativePath = '';
      if (image.url && image.url.startsWith('/uploads/')) {
        relativePath = image.url.substring(1);
      } else {
        relativePath = `uploads/${image.filename}`;
      }
      
      // Try multiple possible paths for local images
      const possiblePaths = [
        path.join(process.cwd(), 'public', relativePath),
        path.join(process.cwd(), 'public/uploads', image.filename),
        path.join('public', relativePath),
        path.join('public/uploads', image.filename)
      ];
      
      let imagePath = null;
      let imageFound = false;
      
      for (const testPath of possiblePaths) {
        if (fs.existsSync(testPath)) {
          imagePath = testPath;
          imageFound = true;
          console.log(`Found local image at: ${testPath}`);
          break;
        }
      }
      
      if (!imageFound) {
        console.warn(`Local image file not found at any of these paths:`, possiblePaths);
        continue;
      }
      
      try {
        const buffer = fs.readFileSync(imagePath!);
        const imageData = buffer.toString('base64');
        
        processedImages.push({
          ...image,
          url: undefined,
          data: imageData,
          isExternal: false
        });
        console.log(`Successfully exported local image: ${image.filename}`);
      } catch (error) {
        console.warn(`Failed to read local image ${image.filename}:`, error);
      }
    }
    
    console.log(`Recipe ${recipe.title} processed with ${processedImages.length} image(s)`);
    
    return {
      ...recipe,
      images: processedImages
    };
  }));

  const filename = recipes.length === 1 
    ? `${recipes[0].title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.rcb`
    : 'recipes.rcb';

  return new Response(JSON.stringify(exportData, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  });
} 
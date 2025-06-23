import type { APIRoute } from 'astro';
import { db } from '../../lib/database';
import * as fs from 'fs';
import * as path from 'path';

export const GET: APIRoute = async ({ url }) => {
  try {
    const searchParams = new URL(url).searchParams;
    const recipeId = searchParams.get('id');
    const format = searchParams.get('format') || 'json';

    if (recipeId) {
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
  console.log(`Working directory: ${process.cwd()}`);
  
  // Create export data with base64 encoded images
  const exportData = await Promise.all(recipes.map(async (recipe, recipeIndex) => {
    console.log(`Processing recipe ${recipeIndex + 1}: ${recipe.title}`);
    console.log(`Recipe has ${recipe.images?.length || 0} image(s)`);
    
    const validImages = [];
    
    for (const image of (recipe.images || [])) {
      console.log(`Processing image:`, image);
      
      // Construct path from URL if available, otherwise use filename
      let relativePath = '';
      if (image.url && image.url.startsWith('/uploads/')) {
        // Remove leading slash and use the URL path directly
        relativePath = image.url.substring(1); // removes the leading '/'
      } else {
        // Fallback to filename in uploads directory
        relativePath = `uploads/${image.filename}`;
      }
      
      // Try multiple possible paths
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
          console.log(`Found image at: ${testPath}`);
          break;
        }
      }
      
      if (!imageFound) {
        console.warn(`Image file not found at any of these paths:`, possiblePaths);
        // Include the image anyway but without data
        validImages.push({
          ...image,
          url: undefined,
          data: null
        });
        continue;
      }
      
      try {
        const buffer = fs.readFileSync(imagePath!);
        const imageData = buffer.toString('base64');
        
        // Always include the image, even if data is empty (for debugging)
        validImages.push({
          ...image,
          url: undefined,
          data: imageData
        });
        console.log(`Successfully exported image: ${image.filename} (${imageData.length} chars)`);
      } catch (error) {
        console.warn(`Failed to read image ${image.filename}:`, error);
        // Include the image anyway but without data
        validImages.push({
          ...image,
          url: undefined,
          data: null
        });
      }
    }
    
    console.log(`Recipe ${recipe.title} processed with ${validImages.length} image(s)`);
    
    return {
      ...recipe,
      images: validImages
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
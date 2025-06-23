import type { APIRoute } from 'astro';
import { db } from '../../lib/database';

export const GET: APIRoute = async ({ url }) => {
  try {
    const searchParams = new URL(url).searchParams;
    const id = searchParams.get('id');

    if (id) {
      // Get single recipe
      const recipe = db.getRecipe(id);
      if (!recipe) {
        return new Response(JSON.stringify({ error: 'Recipe not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify(recipe), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      // Get all recipes
      const recipes = db.getAllRecipes();
      return new Response(JSON.stringify(recipes), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    console.error('Error fetching recipes:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const POST: APIRoute = async ({ request, url }) => {
  try {
    const searchParams = new URL(url).searchParams;
    const action = searchParams.get('action');
    
    if (action === 'create-empty') {
      // Create a new empty recipe with minimal default values
      const emptyRecipeData = {
        title: 'Neues Rezept',
        subtitle: '',
        description: '',
        metadata: {
          servings: 4,
          preparationTime: 0,
          cookingTime: 0,
          difficulty: 'leicht' as const
        },
        ingredientGroups: [
          {
            id: crypto.randomUUID(),
            title: '',
            ingredients: []
          }
        ],
        preparationGroups: [
          {
            id: crypto.randomUUID(),
            title: '',
            steps: []
          }
        ]
      };
      
      const newRecipe = db.createRecipe(emptyRecipeData);
      
      return new Response(JSON.stringify(newRecipe), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      // Regular recipe creation with full data
      const recipeData = await request.json();
      const newRecipe = db.createRecipe(recipeData);
      
      return new Response(JSON.stringify(newRecipe), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    console.error('Error creating recipe:', error);
    return new Response(JSON.stringify({ error: 'Failed to create recipe' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const PUT: APIRoute = async ({ request, url }) => {
  try {
    const searchParams = new URL(url).searchParams;
    const id = searchParams.get('id');
    
    if (!id) {
      return new Response(JSON.stringify({ error: 'Recipe ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const updateData = await request.json();
    const updatedRecipe = db.updateRecipe(id, updateData);
    
    if (!updatedRecipe) {
      return new Response(JSON.stringify({ error: 'Recipe not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(updatedRecipe), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating recipe:', error);
    return new Response(JSON.stringify({ error: 'Failed to update recipe' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const DELETE: APIRoute = async ({ url }) => {
  try {
    const searchParams = new URL(url).searchParams;
    const id = searchParams.get('id');
    
    if (!id) {
      return new Response(JSON.stringify({ error: 'Recipe ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get recipe data before deletion to access images for cleanup
    const recipe = db.getRecipe(id);
    if (!recipe) {
      return new Response(JSON.stringify({ error: 'Recipe not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Delete associated image files from filesystem
    await cleanupRecipeImages(recipe.images || []);

    // Delete recipe from database
    const deleted = db.deleteRecipe(id);
    
    if (!deleted) {
      return new Response(JSON.stringify({ error: 'Failed to delete recipe from database' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`Successfully deleted recipe "${recipe.title}" and cleaned up ${recipe.images?.length || 0} associated image files`);

    return new Response(JSON.stringify({ 
      success: true,
      deletedImages: recipe.images?.length || 0 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error deleting recipe:', error);
    return new Response(JSON.stringify({ error: 'Failed to delete recipe' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

/**
 * Clean up image files from the filesystem
 */
async function cleanupRecipeImages(images: any[]) {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads', 'recipes');
  let deletedCount = 0;
  let skippedCount = 0;

  for (const image of images) {
    try {
      // Only delete files that are actually stored locally (have a filename and start with /uploads/)
      if (image.filename && image.url && image.url.startsWith('/uploads/')) {
        const filePath = path.join(UPLOADS_DIR, image.filename);
        
        // Check if file exists before trying to delete
        try {
          await fs.access(filePath);
          await fs.unlink(filePath);
          deletedCount++;
          console.log(`Deleted image file: ${image.filename}`);
        } catch (accessError) {
          // File doesn't exist, that's fine
          console.log(`Image file already deleted or not found: ${image.filename}`);
          skippedCount++;
        }
      } else {
        // Skip external URLs (like imported images from websites)
        console.log(`Skipped external image: ${image.url}`);
        skippedCount++;
      }
    } catch (error) {
      console.error(`Failed to delete image file ${image.filename}:`, error);
      skippedCount++;
    }
  }

  console.log(`Image cleanup completed: ${deletedCount} deleted, ${skippedCount} skipped`);
} 
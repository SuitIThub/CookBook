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

    const deleted = db.deleteRecipe(id);
    
    if (!deleted) {
      return new Response(JSON.stringify({ error: 'Recipe not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: true }), {
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
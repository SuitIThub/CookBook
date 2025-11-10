import type { APIRoute } from 'astro';
import { db } from '../../lib/database';

export const GET: APIRoute = async ({ url }) => {
  try {
    const searchParams = new URL(url).searchParams;
    const query = searchParams.get('q') || '';
    const all = searchParams.get('all') === 'true';
    const ingredientName = searchParams.get('ingredient');

    if (ingredientName) {
      // Get all recipes that contain this ingredient
      const recipes = db.getRecipesByIngredient(ingredientName);
      return new Response(JSON.stringify(recipes), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (all) {
      // Get all ingredients from recipes with usage counts
      const ingredients = db.getAllIngredientsFromRecipes();
      return new Response(JSON.stringify(ingredients), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Search ingredients for autocomplete
    const ingredients = db.searchIngredients(query);
    
    return new Response(JSON.stringify(ingredients), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching ingredients:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { action, oldName, newName } = body;

    if ((action === 'unify' || action === 'rename') && oldName && newName) {
      if (oldName === newName) {
        return new Response(JSON.stringify({ error: 'Der neue Name muss sich vom alten Namen unterscheiden' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const result = db.unifyIngredients(oldName, newName);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error processing ingredient action:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}; 
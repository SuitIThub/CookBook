import type { APIRoute } from 'astro';
import { db } from '../../lib/database';

export const GET: APIRoute = async ({ url }) => {
  try {
    const searchParams = new URL(url).searchParams;
    const query = searchParams.get('q') || '';
    const all = searchParams.get('all') === 'true';

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

    if (action === 'unify' && oldName && newName) {
      if (oldName === newName) {
        return new Response(JSON.stringify({ error: 'Cannot unify ingredient with itself' }), {
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
    console.error('Error unifying ingredients:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}; 
import type { APIRoute } from 'astro';
import { db } from '../../../../../../lib/database';

export const PUT: APIRoute = async ({ request, params }) => {
  try {
    const { id, recipeId } = params;
    if (!id || !recipeId) {
      return new Response(JSON.stringify({ error: 'Shopping list ID and recipe ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { servings } = await request.json();
    if (!servings || servings < 1) {
      return new Response(JSON.stringify({ error: 'Valid servings number required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get shopping list
    const shoppingList = db.getShoppingList(id);
    if (!shoppingList) {
      return new Response(JSON.stringify({ error: 'Shopping list not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Update recipe servings and scale ingredients
    const updatedList = db.updateRecipeServingsInShoppingList(id, recipeId, servings);
    if (!updatedList) {
      return new Response(JSON.stringify({ error: 'Failed to update shopping list' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(updatedList), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating recipe servings:', error);
    return new Response(JSON.stringify({ error: 'Failed to update recipe servings' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}; 
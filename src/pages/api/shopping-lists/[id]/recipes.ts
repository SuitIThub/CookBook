import type { APIRoute } from 'astro';
import { db } from '../../../../lib/database';

export const POST: APIRoute = async ({ request, params }) => {
  try {
    const { id } = params;
    if (!id) {
      return new Response(JSON.stringify({ error: 'Shopping list ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { recipeIds } = await request.json();
    if (!Array.isArray(recipeIds) || recipeIds.length === 0) {
      return new Response(JSON.stringify({ error: 'Recipe IDs required' }), {
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

    // Add each recipe
    for (const recipeId of recipeIds) {
      db.addRecipeToShoppingList(id, recipeId);
    }

    // Get updated shopping list
    const updatedList = db.getShoppingList(id);
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
    console.error('Error adding recipes to shopping list:', error);
    return new Response(JSON.stringify({ error: 'Failed to add recipes to shopping list' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}; 
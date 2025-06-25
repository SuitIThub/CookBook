import type { APIRoute } from 'astro';
import { db } from '../../lib/database';

export const GET: APIRoute = async ({ url }) => {
  try {
    const searchParams = new URL(url).searchParams;
    const id = searchParams.get('id');
    const action = searchParams.get('action');

    if (id && action === 'recipes') {
      // Get available recipes for adding to shopping list
      const recipes = db.getAllRecipes();
      const recipeSummaries = recipes.map(recipe => ({
        id: recipe.id,
        title: recipe.title,
        subtitle: recipe.subtitle,
        servings: recipe.metadata.servings,
        category: recipe.category,
        tags: recipe.tags || [],
        imageUrl: recipe.imageUrl
      }));
      
      return new Response(JSON.stringify(recipeSummaries), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } else if (id) {
      // Get single shopping list
      const shoppingList = db.getShoppingList(id);
      if (!shoppingList) {
        return new Response(JSON.stringify({ error: 'Shopping list not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify(shoppingList), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      // Get all shopping lists
      const shoppingLists = db.getAllShoppingLists();
      return new Response(JSON.stringify(shoppingLists), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    console.error('Error fetching shopping lists:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const data = await request.json();
    const { title, description } = data;
    
    if (!title) {
      return new Response(JSON.stringify({ error: 'Title is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const newShoppingList = db.createShoppingList(title, description);
    
    return new Response(JSON.stringify(newShoppingList), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error creating shopping list:', error);
    return new Response(JSON.stringify({ error: 'Failed to create shopping list' }), {
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
      return new Response(JSON.stringify({ error: 'Shopping list ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const requestData = await request.json();
    
    // Handle add-item action
    if (requestData.action === 'add-item' && requestData.item) {
      const updatedShoppingList = db.addItemToShoppingList(id, requestData.item);
      
      if (!updatedShoppingList) {
        return new Response(JSON.stringify({ error: 'Shopping list not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify(updatedShoppingList), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Handle add-recipe action
    if (requestData.action === 'add-recipe' && requestData.recipeId) {
      const updatedShoppingList = db.addRecipeToShoppingList(id, requestData.recipeId);
      
      if (!updatedShoppingList) {
        return new Response(JSON.stringify({ error: 'Shopping list or recipe not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify(updatedShoppingList), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Handle remove-recipe action
    if (requestData.action === 'remove-recipe' && requestData.recipeId) {
      const updatedShoppingList = db.removeRecipeFromShoppingList(id, requestData.recipeId);
      
      if (!updatedShoppingList) {
        return new Response(JSON.stringify({ error: 'Shopping list not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify(updatedShoppingList), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Handle toggle-recipe action
    if (requestData.action === 'toggle-recipe' && requestData.recipeId && typeof requestData.isCompleted === 'boolean') {
      const updatedShoppingList = db.toggleRecipeCompletion(id, requestData.recipeId, requestData.isCompleted);
      
      if (!updatedShoppingList) {
        return new Response(JSON.stringify({ error: 'Shopping list not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify(updatedShoppingList), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Handle regular update
    const updatedShoppingList = db.updateShoppingList(id, requestData);
    
    if (!updatedShoppingList) {
      return new Response(JSON.stringify({ error: 'Shopping list not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(updatedShoppingList), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating shopping list:', error);
    return new Response(JSON.stringify({ error: 'Failed to update shopping list' }), {
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
      return new Response(JSON.stringify({ error: 'Shopping list ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const success = db.deleteShoppingList(id);
    
    if (!success) {
      return new Response(JSON.stringify({ error: 'Shopping list not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error deleting shopping list:', error);
    return new Response(JSON.stringify({ error: 'Failed to delete shopping list' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}; 
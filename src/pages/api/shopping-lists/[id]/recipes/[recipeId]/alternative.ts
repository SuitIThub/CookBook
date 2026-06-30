import type { APIRoute } from 'astro';
import { db } from '../../../../../../lib/database';

export const GET: APIRoute = async ({ url, params }) => {
  try {
    const { id, recipeId } = params;
    if (!id || !recipeId) {
      return new Response(JSON.stringify({ error: 'Shopping list ID and recipe ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const searchParams = new URL(url).searchParams;
    const groupId = searchParams.get('groupId');
    const optionId = searchParams.get('optionId');
    if (!groupId || !optionId) {
      return new Response(JSON.stringify({ error: 'groupId and optionId are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const preview = db.previewRecipeAlternativeChange(id, recipeId, groupId, optionId);
    if (!preview) {
      return new Response(JSON.stringify({ error: 'Preview not available' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(preview), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error previewing recipe alternative change:', error);
    return new Response(JSON.stringify({ error: 'Failed to preview recipe alternative change' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const PUT: APIRoute = async ({ request, params }) => {
  try {
    const { id, recipeId } = params;
    if (!id || !recipeId) {
      return new Response(JSON.stringify({ error: 'Shopping list ID and recipe ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { groupId, optionId } = await request.json();
    if (!groupId || !optionId) {
      return new Response(JSON.stringify({ error: 'groupId and optionId are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const shoppingList = db.getShoppingList(id);
    if (!shoppingList) {
      return new Response(JSON.stringify({ error: 'Shopping list not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const updatedList = db.updateRecipeAlternativeInShoppingList(id, recipeId, groupId, optionId);
    if (!updatedList) {
      return new Response(JSON.stringify({ error: 'Failed to update alternative' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(updatedList), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating recipe alternative:', error);
    return new Response(JSON.stringify({ error: 'Failed to update recipe alternative' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

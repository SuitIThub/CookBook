import type { APIRoute } from 'astro';
import { db } from '../../lib/database';

export const GET: APIRoute = async ({ url }) => {
  try {
    const searchParams = new URL(url).searchParams;
    const recipeId = searchParams.get('recipeId');

    if (recipeId) {
      // Check if draft exists first (more efficient)
      const hasDraft = db.hasDraft(recipeId);
      if (!hasDraft) {
        // Return 200 with null instead of 404 to avoid console errors
        // when checking for drafts that don't exist
        return new Response(JSON.stringify(null), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Get single draft
      const draft = db.getDraft(recipeId);
      if (!draft) {
        // Return 200 with null instead of 404
        return new Response(JSON.stringify(null), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify(draft), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      // Get all drafts
      const drafts = db.getAllDrafts();
      return new Response(JSON.stringify(drafts), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    console.error('Error fetching drafts:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};


export const PUT: APIRoute = async ({ request, url }) => {
  try {
    const searchParams = new URL(url).searchParams;
    const recipeId = searchParams.get('recipeId');

    if (!recipeId) {
      return new Response(JSON.stringify({ error: 'Recipe ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const recipeData = await request.json();
    db.saveDraft(recipeId, recipeData);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating draft:', error);
    return new Response(JSON.stringify({ error: 'Failed to update draft' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const DELETE: APIRoute = async ({ url, request }) => {
  try {
    const searchParams = new URL(url).searchParams;
    const recipeId = searchParams.get('recipeId');
    const action = searchParams.get('action');
    const deleteRecipe = searchParams.get('deleteRecipe') === 'true'; // Flag to delete entire recipe

    if (!recipeId) {
      return new Response(JSON.stringify({ error: 'Recipe ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // If deleteRecipe flag is set, delete the entire recipe (for new recipes that haven't been saved)
    if (deleteRecipe) {
      // First, get the draft recipe ID before we delete anything
      const draft = db.getDraft(recipeId);
      const draftRecipeId = draft?.id;
      
      // Delete the draft reference explicitly first (this prevents the draft from showing up)
      try {
        db.deleteDraftReference(recipeId);
      } catch (error) {
        // Draft reference might not exist, which is fine
        console.log('Draft reference deletion note (might not exist):', error);
      }
      
      // Delete the draft recipe (if it exists)
      if (draftRecipeId) {
        try {
          db.deleteRecipe(draftRecipeId);
        } catch (error) {
          // Draft recipe might already be deleted, which is fine
          console.log('Draft recipe deletion note (might already be deleted):', error);
        }
      }
      
      // Finally, delete the original recipe (the one with recipeId)
      // This is the recipe that was created but never saved
      try {
        const deleted = db.deleteRecipe(recipeId);
        if (!deleted) {
          console.log('Recipe not found for deletion:', recipeId);
        }
      } catch (error) {
        console.error('Error deleting recipe:', error);
      }
    } else {
      // Normal draft deletion
      db.deleteDraft(recipeId);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error deleting draft:', error);
    return new Response(JSON.stringify({ error: 'Failed to delete draft' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// Handle POST requests for delete action (for sendBeacon compatibility)
export const POST: APIRoute = async ({ request, url }) => {
  try {
    const searchParams = new URL(url).searchParams;
    const recipeId = searchParams.get('recipeId');
    const action = searchParams.get('action');

    if (action === 'delete' || action === 'remove') {
      // Handle delete via POST (for sendBeacon compatibility)
      if (!recipeId) {
        return new Response(JSON.stringify({ error: 'Recipe ID required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      db.deleteDraft(recipeId);

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Regular POST for saving drafts
    if (!recipeId) {
      return new Response(JSON.stringify({ error: 'Recipe ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const recipeData = await request.json();
    db.saveDraft(recipeId, recipeData);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error in POST draft operation:', error);
    return new Response(JSON.stringify({ error: 'Failed to process draft operation' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};


import type { APIRoute } from 'astro';
import { db } from '../../../../lib/database';

export const POST: APIRoute = async ({ params }) => {
  try {
    const targetListId = params.id;
    if (!targetListId) {
      return new Response(JSON.stringify({ error: 'Shopping list ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const result = db.applyGlobalTemplateToList(targetListId);
    if (!result) {
      return new Response(JSON.stringify({ error: 'Target list not found or cannot apply template' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error applying global template shopping list:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};


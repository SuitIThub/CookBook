import type { APIRoute } from 'astro';
import { db } from '../../../lib/database';
import { recipeToMarkdown } from '../../../lib/recipeMarkdown';

/**
 * GET /api/recipes/markdown?id=<recipeId>
 * Returns the recipe as Markdown (text/markdown).
 * Used by the AI chat and variant flows so recipe context format is centralized.
 */
export const GET: APIRoute = async ({ url }) => {
  const id = url.searchParams.get('id');
  if (!id) {
    return new Response(JSON.stringify({ error: 'id required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const recipe = db.getRecipe(id);
  if (!recipe) {
    return new Response(JSON.stringify({ error: 'Recipe not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const markdown = recipeToMarkdown(recipe);
  return new Response(markdown, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'private, max-age=0',
    },
  });
};

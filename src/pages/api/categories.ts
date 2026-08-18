import type { APIRoute } from 'astro';
import { MAIN_CATEGORIES } from '../../lib/recipeCategories';

export const GET: APIRoute = async () => {
  try {
    return new Response(JSON.stringify([...MAIN_CATEGORIES]), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch categories' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}; 
import type { APIRoute } from 'astro';
import { db } from '../../../lib/database';

/**
 * GET /api/images/gallery
 * Returns image URLs from recipes and from shopping list item notes for use in the note editor gallery.
 */
export const GET: APIRoute = async () => {
  try {
    const recipeImages: { url: string; recipeId: string; recipeTitle: string }[] = [];
    const noteImages: { url: string }[] = [];
    const seenUrls = new Set<string>();

    // Collect recipe images (imageUrl + images[])
    const recipes = db.getAllRecipes();
    for (const recipe of recipes) {
      if (recipe.imageUrl && recipe.imageUrl.trim()) {
        const url = recipe.imageUrl.startsWith('http') || recipe.imageUrl.startsWith('/')
          ? recipe.imageUrl
          : `/${recipe.imageUrl}`;
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          recipeImages.push({ url, recipeId: recipe.id, recipeTitle: recipe.title });
        }
      }
      if (recipe.images && Array.isArray(recipe.images)) {
        for (const img of recipe.images) {
          if (img.url && img.url.trim()) {
            const url = img.url.startsWith('http') || img.url.startsWith('/')
              ? img.url
              : `/${img.url}`;
            if (!seenUrls.has(url)) {
              seenUrls.add(url);
              recipeImages.push({ url, recipeId: recipe.id, recipeTitle: recipe.title });
            }
          }
        }
      }
    }

    // Collect images from shopping list item notes (img src in HTML)
    const lists = db.getAllShoppingLists();
    const imgSrcRegex = /<img[^>]+src=["']([^"']+)["']/gi;
    for (const list of lists) {
      for (const item of list.items || []) {
        if (!item.note || typeof item.note !== 'string') continue;
        let m: RegExpExecArray | null;
        imgSrcRegex.lastIndex = 0;
        while ((m = imgSrcRegex.exec(item.note)) !== null) {
          const url = m[1].trim();
          if (!url) continue;
          if (!seenUrls.has(url)) {
            seenUrls.add(url);
            noteImages.push({ url });
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ recipeImages, noteImages }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error fetching image gallery:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to load gallery' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

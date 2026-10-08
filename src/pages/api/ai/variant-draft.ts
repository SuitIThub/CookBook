import type { APIRoute } from 'astro';
import { getDraftVariant } from '../../../lib/draftVariantStore';

/**
 * AI variant draft by token (from POST /api/ai/propose-variant with
 * preview:true). The website renders it server-side on /rezept/[parentId]/
 * variante-neu; the app loads it through this endpoint into its editor.
 *   GET /api/ai/variant-draft?token=<token> → { parentRecipeId, variantName, recipeData }
 */
export const GET: APIRoute = async ({ url }) => {
  const token = new URL(url).searchParams.get('token') || '';
  const draft = token ? getDraftVariant(token) : null;
  if (!draft) {
    return new Response(JSON.stringify({ error: 'Entwurf nicht gefunden oder abgelaufen' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return new Response(
    JSON.stringify({ parentRecipeId: draft.parentRecipeId, variantName: draft.variantName, recipeData: draft.recipeData }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};

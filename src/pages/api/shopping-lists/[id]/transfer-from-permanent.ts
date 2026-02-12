import type { APIRoute } from 'astro';
import { db } from '../../../../lib/database';

export const POST: APIRoute = async ({ params, request }) => {
  try {
    const { id: targetListId } = params;
    if (!targetListId) {
      return new Response(JSON.stringify({ error: 'Shopping list ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let addPortionsForRecipeIds: string[] = [];
    try {
      const body = await request.json();
      if (body && Array.isArray(body.addPortionsForRecipeIds)) {
        addPortionsForRecipeIds = body.addPortionsForRecipeIds;
      }
    } catch {
      // Optional body
    }

    const result = db.transferFromPermanentList(targetListId, addPortionsForRecipeIds);

    if (!result) {
      return new Response(
        JSON.stringify({ error: 'Target list not found or cannot transfer from permanent list' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        duplicateRecipeIds: result.duplicateRecipeIds,
        transferredItemCount: result.transferredItemCount,
        transferredRecipeCount: result.transferredRecipeCount
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error transferring from permanent list:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

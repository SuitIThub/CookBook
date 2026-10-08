import type { APIRoute } from 'astro';
import { matchProducts, type BatchProductInput } from '../../../../lib/productMatching.server';
import { taskRequestConfig, type AiSettingsLike } from '../../../../lib/aiTasks';

/**
 * Batch product import, step 1: proposed catalogue ingredient per product.
 *   POST { items: [{ ean?, name, brand?, genericName?, categories? }], ai?: <AI settings> }
 *   → { matches: [{ ingredient, existing, confidence, reason, existingProductId? }] }
 * Uses the "Zuordnen" task model for products the rules can't place.
 */
export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const items: BatchProductInput[] = Array.isArray(body?.items)
    ? body.items
        .filter((i: any) => i && typeof i.name === 'string' && i.name.trim())
        .slice(0, 200)
        .map((i: any) => ({
          ean: typeof i.ean === 'string' ? i.ean.trim() : null,
          name: i.name.trim(),
          brand: typeof i.brand === 'string' ? i.brand : null,
          genericName: typeof i.genericName === 'string' ? i.genericName : null,
          categories: typeof i.categories === 'string' ? i.categories : null
        }))
    : [];
  if (!items.length) return json({ error: 'items required' }, 400);
  const ai = body?.ai ? taskRequestConfig(body.ai as AiSettingsLike, 'matching') : null;
  try {
    return json({ matches: await matchProducts(items, ai) });
  } catch (error) {
    console.error('products/batch/match error:', error);
    return json({ error: (error as Error).message }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

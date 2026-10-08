import type { APIRoute } from 'astro';
import { db } from '../../../../lib/database.server';
import type { NutritionData } from '../../../../types/recipe';

/**
 * Batch product import, step 2: save the reviewed rows in one go.
 *   POST { items: [{ product: { ean?, name, brand?, netGrams?, packageLabel?, nutritionPer100g?,
 *                               imageUrl?, offCode?, source? }, ingredient: string, makeDefault?: boolean }] }
 * Products are matched by EAN (existing ones keep their data and links);
 * missing ingredients are created (seeded with the product's nutrition);
 * "makeDefault" sets the product as the ingredient's default product.
 */
interface CommitItem {
  product: {
    ean?: string | null;
    name: string;
    brand?: string | null;
    netGrams?: number | null;
    packageLabel?: string | null;
    nutritionPer100g?: NutritionData | null;
    imageUrl?: string | null;
    offCode?: string | null;
    source?: string;
  };
  ingredient?: string;
  makeDefault?: boolean;
}

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const items: CommitItem[] = Array.isArray(body?.items) ? body.items.filter((i: any) => i?.product && typeof i.product.name === 'string' && i.product.name.trim()) : [];
  if (!items.length) return json({ error: 'items required' }, 400);

  let created = 0;
  let updated = 0;
  let ingredientsCreated = 0;
  const results: { productId: string; ingredientId: string | null }[] = [];
  try {
    for (const item of items) {
      const p = item.product;
      const ean = typeof p.ean === 'string' && p.ean.trim() ? p.ean.trim() : null;
      const existing = ean ? db.getProductByEan(ean) : null;
      const product = existing
        ? existing
        : db.upsertProduct({
            ean,
            name: p.name.trim(),
            brand: p.brand ?? null,
            netGrams: typeof p.netGrams === 'number' ? p.netGrams : null,
            packageLabel: p.packageLabel ?? null,
            nutritionPer100g: p.nutritionPer100g ?? null,
            imageUrl: p.imageUrl ?? null,
            source: p.source === 'openfoodfacts' ? 'openfoodfacts' : 'manual',
            offCode: p.offCode ?? null
          });
      if (existing) updated++;
      else created++;

      let ingredientId: string | null = null;
      const name = typeof item.ingredient === 'string' ? item.ingredient.trim() : '';
      if (name) {
        let ingredient = db.getCatalogueIngredientByName(name);
        if (!ingredient) {
          ingredient = db.upsertCatalogueIngredient({ name, nutritionPer100g: product.nutritionPer100g ?? null });
          ingredientsCreated++;
        }
        ingredientId = ingredient.id;
        const ids = new Set(db.getProduct(product.id)?.ingredientIds ?? []);
        if (!ids.has(ingredient.id)) db.setProductIngredients(product.id, [...ids, ingredient.id]);
        if (item.makeDefault) db.setDefaultProductForIngredient(ingredient.id, product.id);
      }
      results.push({ productId: product.id, ingredientId });
    }
    return json({ created, updated, ingredientsCreated, results });
  } catch (error) {
    console.error('products/batch/commit error:', error);
    return json({ error: (error as Error).message }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

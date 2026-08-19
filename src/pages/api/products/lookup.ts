import type { APIRoute } from 'astro';
import { db } from '../../../lib/database';
import { lookupOpenFoodFactsProduct, searchOpenFoodFactsProducts } from '../../../lib/openFoodFacts';

/**
 * Barcode/EAN lookup and text search.
 * - `?ean=…`: first checks the local product register, then (unless
 *   `?remote=false`) falls back to Open Food Facts v3.
 * - `?q=…`: text search against Open Food Facts (returns up to `pageSize`
 *   normalized products). Local matches are prepended and marked.
 */
export const GET: APIRoute = async ({ url }) => {
  const params = new URL(url).searchParams;
  const ean = (params.get('ean') || '').trim();
  const query = (params.get('q') || '').trim();

  if (ean) {
    const skipRemote = params.get('remote') === 'false';
    const local = db.getProductByEan(ean);
    if (local) return json({ source: 'local', product: local });
    if (skipRemote) return json({ source: 'local', product: null });
    const result = await lookupOpenFoodFactsProduct(ean);
    if (result.status === 'error') return json({ error: result.message ?? 'lookup failed' }, 502);
    if (result.status === 'not-found') return json({ source: 'openfoodfacts', product: null });
    return json({ source: 'openfoodfacts', product: result.product });
  }

  if (query) {
    const pageSize = Math.min(50, Math.max(1, Number.parseInt(params.get('pageSize') || '20', 10) || 20));
    const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1);
    const local = db.searchProducts(query, Math.min(10, pageSize));
    const result = await searchOpenFoodFactsProducts(query, { pageSize, page });
    if (result.status === 'error') {
      return json({ source: 'openfoodfacts', local: page === 1 ? local : [], results: [], page, hasMore: false, error: result.message ?? 'search failed' }, 200);
    }
    const localEans = new Set(local.map((p) => p.ean).filter(Boolean) as string[]);
    const remoteFiltered = result.products.filter((p) => !localEans.has(p.ean));
    return json({
      source: 'openfoodfacts',
      local: page === 1 ? local : [],
      results: remoteFiltered,
      count: result.count,
      page: result.page ?? page,
      pageCount: result.pageCount,
      hasMore: Boolean(result.hasMore),
    });
  }

  return json({ error: 'ean or q parameter required' }, 400);
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

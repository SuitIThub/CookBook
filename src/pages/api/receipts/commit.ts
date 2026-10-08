import type { APIRoute } from 'astro';
import { db, receiptStore } from '../../../lib/database.server';

/**
 * Save a reviewed receipt:
 *   POST { supermarketId? | newSupermarket?, date: 'YYYY-MM-DD',
 *          lines: [{ text, action: 'price'|'ignore'|'skip', productId?, newProductName?,
 *                    unit: 'stk'|'kg', unitPrice, paidUnitPrice?, learn? }] }
 * 'price': the REGULAR price becomes the product's price at that supermarket
 * (per pack; €/kg goods are converted via the pack size, loose goods get
 * "1 kg (lose)"), the paid price goes to the history. 'ignore' remembers the
 * line as "always ignore". Line texts are learned per supermarket.
 */
interface CommitLine {
  text: string;
  action: 'price' | 'ignore' | 'skip';
  productId?: string;
  newProductName?: string;
  unit?: 'stk' | 'kg';
  unitPrice?: number;
  paidUnitPrice?: number;
  learn?: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const lines: CommitLine[] = Array.isArray(body?.lines) ? body.lines.filter((l: any) => l && typeof l.text === 'string') : [];
  if (!lines.length) return json({ error: 'lines required' }, 400);
  const date = typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : new Date().toISOString().slice(0, 10);

  try {
    let supermarketId = typeof body?.supermarketId === 'string' && body.supermarketId ? body.supermarketId : '';
    let supermarketCreated = false;
    if (!supermarketId) {
      const name = typeof body?.newSupermarket === 'string' ? body.newSupermarket.trim() : '';
      if (!name) return json({ error: 'Bitte einen Supermarkt wählen oder anlegen.' }, 400);
      const existing = db.getAllSupermarkets().find((m) => m.name.toLowerCase() === name.toLowerCase());
      supermarketId = existing?.id ?? db.upsertSupermarket({ name }).id;
      supermarketCreated = !existing;
    } else if (!db.getSupermarket(supermarketId)) {
      return json({ error: 'Supermarkt nicht gefunden.' }, 404);
    }

    let prices = 0;
    let productsCreated = 0;
    let ignored = 0;
    let learned = 0;
    const changes: { product: string; before: number | null; after: number }[] = [];
    for (const line of lines) {
      if (line.action === 'skip') continue;
      if (line.action === 'ignore') {
        receiptStore.learn(supermarketId, line.text, null, true);
        ignored++;
        learned++;
        continue;
      }
      let productId = line.productId && db.getProduct(line.productId) ? line.productId : '';
      if (!productId) {
        const name = (line.newProductName ?? '').trim();
        if (!name) continue;
        productId = db.upsertProduct({ name, source: 'manual' }).id;
        productsCreated++;
      }
      const unitPrice = Number(line.unitPrice);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue;
      const paid = Number.isFinite(Number(line.paidUnitPrice)) ? Number(line.paidUnitPrice) : null;
      // Product prices are per pack; €/kg lines are converted via the pack size.
      let packPrice = unitPrice;
      let packPaid = paid;
      if (line.unit === 'kg') {
        const grams = receiptStore.ensureKiloPack(productId) ?? 1000;
        packPrice = round2((unitPrice * grams) / 1000);
        packPaid = paid == null ? null : round2((paid * grams) / 1000);
      }
      const before = db.getProduct(productId)?.supermarkets?.find((s) => s.supermarketId === supermarketId)?.price ?? null;
      receiptStore.setProductPrice(productId, supermarketId, packPrice);
      receiptStore.recordPrice(productId, supermarketId, packPrice, packPaid, date);
      if (before == null || Math.abs(before - packPrice) >= 0.005) changes.push({ product: db.getProduct(productId)?.name ?? '', before, after: packPrice });
      prices++;
      if (line.learn !== false) {
        receiptStore.learn(supermarketId, line.text, productId, false);
        learned++;
      }
    }
    return json({ supermarketId, supermarketCreated, prices, productsCreated, ignored, learned, changes });
  } catch (error) {
    console.error('receipts/commit error:', error);
    return json({ error: (error as Error).message }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

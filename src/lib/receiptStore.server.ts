/**
 * Server-only storage for the receipt import:
 *  - receipt_aliases: learned receipt line texts per supermarket → product
 *    (or "ignore", e.g. PFAND, TRAGETASCHE), so known lines match instantly
 *  - price_history: every confirmed price (regular + paid) with the receipt
 *    date — basis for price-change hints
 *  - setProductPrice: one supermarket price, touching the product row so the
 *    change syncs to the app (prices travel with the product)
 */
import { randomUUID } from 'node:crypto';
import type { SqlDriver } from './db/driver';

export function ensureReceiptSchema(driver: SqlDriver): void {
  driver.exec(`
    CREATE TABLE IF NOT EXISTS receipt_aliases (
      supermarket_id TEXT NOT NULL,
      line_key       TEXT NOT NULL,
      product_id     TEXT,
      ignore         INTEGER NOT NULL DEFAULT 0,
      updated_at     INTEGER NOT NULL,
      PRIMARY KEY (supermarket_id, line_key)
    )
  `);
  driver.exec(`
    CREATE TABLE IF NOT EXISTS price_history (
      id             TEXT PRIMARY KEY,
      product_id     TEXT NOT NULL,
      supermarket_id TEXT NOT NULL,
      price          REAL NOT NULL,
      paid_price     REAL,
      observed_at    TEXT NOT NULL,
      source         TEXT NOT NULL DEFAULT 'receipt',
      created_at     INTEGER NOT NULL
    )
  `);
  driver.exec(`CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(product_id, supermarket_id, observed_at)`);
}

/** Normalised receipt line text (case, spacing, trailing prices/quantities removed). */
export function receiptLineKey(text: string): string {
  return text
    .toUpperCase()
    .replace(/\s+\d+[.,]\d{2}\s*[A-Z]?\s*$/, '') // trailing price + tax class
    .replace(/\s+/g, ' ')
    .trim();
}

export function createReceiptStore(driver: SqlDriver) {
  return {
    alias(supermarketId: string, text: string): { productId: string | null; ignore: boolean } | null {
      const r = driver
        .prepare('SELECT product_id, ignore FROM receipt_aliases WHERE supermarket_id = ? AND line_key = ?')
        .get(supermarketId, receiptLineKey(text)) as { product_id: string | null; ignore: number } | undefined;
      return r ? { productId: r.product_id, ignore: !!r.ignore } : null;
    },
    learn(supermarketId: string, text: string, productId: string | null, ignore: boolean): void {
      driver
        .prepare(
          `INSERT INTO receipt_aliases (supermarket_id, line_key, product_id, ignore, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(supermarket_id, line_key) DO UPDATE SET product_id = excluded.product_id, ignore = excluded.ignore, updated_at = excluded.updated_at`
        )
        .run(supermarketId, receiptLineKey(text), productId, ignore ? 1 : 0, Date.now());
    },
    recordPrice(productId: string, supermarketId: string, price: number, paidPrice: number | null, observedAt: string): void {
      // Re-importing the same receipt must not duplicate history entries.
      const dup = driver
        .prepare('SELECT 1 FROM price_history WHERE product_id = ? AND supermarket_id = ? AND observed_at = ? AND price = ? LIMIT 1')
        .get(productId, supermarketId, observedAt, price);
      if (dup) return;
      driver
        .prepare('INSERT INTO price_history (id, product_id, supermarket_id, price, paid_price, observed_at, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), productId, supermarketId, price, paidPrice, observedAt, 'receipt', Date.now());
    },
    /** Latest recorded price per supermarket for a product. */
    lastPrices(productId: string): Record<string, { price: number; observedAt: string }> {
      const rows = driver
        .prepare(
          `SELECT supermarket_id, price, observed_at FROM price_history h
           WHERE product_id = ? AND observed_at = (SELECT MAX(observed_at) FROM price_history WHERE product_id = h.product_id AND supermarket_id = h.supermarket_id)`
        )
        .all(productId) as { supermarket_id: string; price: number; observed_at: string }[];
      return Object.fromEntries(rows.map((r) => [r.supermarket_id, { price: r.price, observedAt: r.observed_at }]));
    },
    /** Loose goods sold by weight: give a product without pack size "1 kg (lose)" so €/kg prices fit. */
    ensureKiloPack(productId: string): number | null {
      driver.prepare("UPDATE products SET net_grams = 1000, package_label = '1 kg (lose)' WHERE id = ? AND (net_grams IS NULL OR net_grams = 0)").run(productId);
      const r = driver.prepare('SELECT net_grams FROM products WHERE id = ?').get(productId) as { net_grams: number | null } | undefined;
      return r?.net_grams ?? null;
    },
    setProductPrice(productId: string, supermarketId: string, price: number): void {
      driver
        .prepare(
          `INSERT INTO product_supermarkets (product_id, supermarket_id, price) VALUES (?, ?, ?)
           ON CONFLICT(product_id, supermarket_id) DO UPDATE SET price = excluded.price`
        )
        .run(productId, supermarketId, price);
      driver.prepare('UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(productId);
    }
  };
}
export type ReceiptStore = ReturnType<typeof createReceiptStore>;

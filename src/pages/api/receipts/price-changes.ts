import type { APIRoute } from 'astro';
import { receiptStore } from '../../../lib/database.server';

/** Dashboard "Preisänderungen": newest price vs. the previous one per product + supermarket (from receipts). */
export const GET: APIRoute = async ({ url }) => {
  const limit = Math.min(50, Math.max(1, Number(new URL(url).searchParams.get('limit')) || 8));
  return new Response(JSON.stringify({ changes: receiptStore.recentChanges(limit) }), {
    headers: { 'Content-Type': 'application/json' }
  });
};

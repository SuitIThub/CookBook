import type { APIRoute } from 'astro';
import { db, pushStore } from '../../../lib/database.server';
import { normalizeAlias } from '../../../lib/auth.server';
import { sendPush } from '../../../lib/push.server';

/**
 * Ping other aliases about a shopping list: every device they registered in
 * the app gets a push notification that opens the list. Body:
 * { listId, aliases: string[], message?: string }. The sender is X-Alias
 * (authenticated by the middleware, as for every write).
 */
export const POST: APIRoute = async ({ request }) => {
  const from = normalizeAlias(request.headers.get('x-alias'));
  const body = await request.json().catch(() => null);
  const listId = typeof body?.listId === 'string' ? body.listId : '';
  const targets: string[] = Array.isArray(body?.aliases)
    ? Array.from(new Set(body.aliases.map(normalizeAlias).filter(Boolean)))
    : [];
  const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 300) : '';
  if (!listId || targets.length === 0) return json({ error: 'listId and aliases required' }, 400);

  const list = db.getShoppingList(listId);
  if (!list) return json({ error: 'Einkaufsliste nicht gefunden' }, 404);

  const noDevice: string[] = [];
  const tokens: string[] = [];
  for (const alias of targets) {
    const t = pushStore.tokensFor(alias);
    if (t.length === 0) noDevice.push(alias);
    tokens.push(...t);
  }
  if (tokens.length === 0) return json({ sent: 0, noDevice });

  try {
    const result = await sendPush(tokens, {
      title: `🛒 ${list.title}`,
      body: `${from} bittet dich, die Einkaufsliste anzusehen${message ? `: „${message}“` : '.'}`,
      data: { route: `/einkaufsliste/${list.id}`, listId: list.id, from },
      channelId: 'shopping_pings'
    });
    for (const dead of result.deadTokens) pushStore.unregister(dead);
    return json({ sent: result.sent, noDevice });
  } catch (error) {
    console.error('shopping-lists/ping error:', error);
    return json({ error: (error as Error).message }, 502);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

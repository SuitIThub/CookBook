import type { APIRoute } from 'astro';
import { pushStore } from '../../../lib/database.server';
import { normalizeAlias } from '../../../lib/auth.server';

/**
 * App devices register their FCM token for the alias in X-Alias (the
 * middleware already checked that alias' token — writes need auth), so pings
 * to that alias reach this device. DELETE removes a token (alias switch/logout).
 */
export const POST: APIRoute = async ({ request }) => {
  const alias = normalizeAlias(request.headers.get('x-alias'));
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!alias || !token) return json({ error: 'alias and token required' }, 400);
  pushStore.register(alias, token, typeof body?.platform === 'string' ? body.platform : 'android');
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ url }) => {
  const token = new URL(url).searchParams.get('token');
  if (!token) return json({ error: 'token required' }, 400);
  pushStore.unregister(token);
  return json({ ok: true });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

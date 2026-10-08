import type { APIRoute } from 'astro';
import { pushStore, validateAuth } from '../../../lib/database.server';
import { normalizeAlias } from '../../../lib/auth.server';
import { pushConfigured } from '../../../lib/push.server';

/**
 * Aliases that can be pinged (known profiles = aliases with a token), with
 * whether they have the app registered. Aliases are semi-private (they unlock
 * read access to tracker data), so — unlike other GETs — this needs a valid
 * alias token.
 */
export const GET: APIRoute = async ({ request }) => {
  const alias = normalizeAlias(request.headers.get('x-alias'));
  if (!validateAuth(alias, request.headers.get('x-auth-token') || '')) {
    return json({ error: 'A valid token is required' }, 403);
  }
  return json({
    configured: pushConfigured(),
    self: alias,
    aliases: pushStore.aliases().filter((a) => a.alias !== alias)
  });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

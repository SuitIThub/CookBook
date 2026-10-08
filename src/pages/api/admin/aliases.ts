import type { APIRoute } from 'astro';
import { adminStore } from '../../../lib/database.server';
import { adminConfigured, isAdmin } from '../../../lib/admin.server';

/**
 * Alias administration (X-Admin-Token = ADMIN_TOKEN from the server env):
 *   GET                         list aliases with token/devices/data counts
 *   POST { alias }              create alias or generate a new token (old one stops working)
 *   DELETE ?alias=&purge=1      delete alias (token + devices; purge also settings + tracker data)
 */
function guard(request: Request): Response | null {
  if (!adminConfigured()) return json({ error: 'Admin-Bereich ist auf dem Server nicht eingerichtet (ADMIN_TOKEN fehlt).' }, 503);
  if (!isAdmin(request)) return json({ error: 'Admin-Token ungültig.' }, 403);
  return null;
}

export const GET: APIRoute = async ({ request }) => guard(request) ?? json({ aliases: adminStore.list() });

export const POST: APIRoute = async ({ request }) => {
  const denied = guard(request);
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  try {
    return json(adminStore.issueToken(typeof body?.alias === 'string' ? body.alias : ''));
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const denied = guard(request);
  if (denied) return denied;
  const params = new URL(url).searchParams;
  try {
    adminStore.remove(params.get('alias') || '', params.get('purge') === '1');
    return json({ ok: true });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

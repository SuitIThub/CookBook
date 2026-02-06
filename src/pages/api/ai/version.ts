import type { APIRoute } from 'astro';
import { getOllamaChatUrl } from '../../../lib/ai';

/**
 * GET /api/ai/version
 * Probes the Ollama server's /api/version endpoint to verify it is online.
 * Used on page load to decide whether to show the AI chat FAB.
 * Returns 200 with { ok: true, version?: string } when the AI server is reachable,
 * otherwise 503 so the client can keep the FAB hidden.
 */
export const GET: APIRoute = async () => {
  try {
    const base = getOllamaChatUrl().replace(/\/api\/chat$/, '');
    const res = await fetch(`${base}/api/version`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: 'AI server returned an error' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const data = (await res.json()) as { version?: string };
    return new Response(
      JSON.stringify({ ok: true, version: data.version }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (_err) {
    return new Response(
      JSON.stringify({ ok: false, error: 'AI server unreachable' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

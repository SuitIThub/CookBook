import type { APIRoute } from 'astro';
import { listOllamaModels, validateOpenRouterApiKey } from '../../../lib/ai';
import { ollamaCatalog, openRouterCatalog, TASK_RULES } from '../../../lib/aiModelCatalog';

/**
 * Models for the AI-settings model pickers, with capabilities, prices and
 * per-task recommendations (lib/aiModelCatalog.ts).
 *   GET ?provider=openrouter|ollama   (X-OpenRouter-Api-Key: user key, optional)
 * Without a valid user key only free OpenRouter models are usable (the server
 * key is restricted to them), same rule as /api/ai/models.
 */
export const GET: APIRoute = async ({ url, request }) => {
  const provider = url.searchParams.get('provider') === 'ollama' ? 'ollama' : 'openrouter';
  try {
    if (provider === 'ollama') {
      const names = await listOllamaModels().catch((e: Error) => {
        throw new Error(`Ollama ist nicht erreichbar (${e.message}). Läuft der Ollama-Server?`);
      });
      return json({ provider, models: ollamaCatalog(names), tasks: TASK_RULES });
    }
    const userKey = (request.headers.get('x-openrouter-api-key') || '').trim();
    const userKeyValid = userKey ? await validateOpenRouterApiKey(userKey) : false;
    const all = await openRouterCatalog();
    return json({
      provider,
      freeOnly: !userKeyValid,
      models: userKeyValid ? all : all.filter((m) => m.free),
      tasks: TASK_RULES
    });
  } catch (error) {
    return json({ error: (error as Error).message }, 502);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

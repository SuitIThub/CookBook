import type { APIRoute } from 'astro';
import { listOllamaModels, listOpenRouterModels, type AIProvider } from '../../../lib/ai';

export const GET: APIRoute = async ({ url, request }) => {
  try {
    const providerParam = (url.searchParams.get('provider') ?? 'ollama').toLowerCase();
    const provider: AIProvider = providerParam === 'openrouter' ? 'openrouter' : 'ollama';
    const apiKey =
      request.headers.get('x-openrouter-api-key') ??
      url.searchParams.get('apiKey') ??
      undefined;

    const models =
      provider === 'openrouter'
        ? await listOpenRouterModels(apiKey)
        : await listOllamaModels();

    return new Response(
      JSON.stringify({
        provider,
        models,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Model list failed' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

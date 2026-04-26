import type { APIRoute } from 'astro';
import {
  listOllamaModels,
  listOpenRouterModelsWithOptions,
  validateOpenRouterApiKey,
  getOpenRouterKeyInfo,
  getModelCacheCapability,
  type AIProvider,
} from '../../../lib/ai';

export const GET: APIRoute = async ({ url, request }) => {
  try {
    const providerParam = (url.searchParams.get('provider') ?? 'ollama').toLowerCase();
    const provider: AIProvider = providerParam === 'openrouter' ? 'openrouter' : 'ollama';
    const apiKey =
      request.headers.get('x-openrouter-api-key') ??
      url.searchParams.get('apiKey') ??
      undefined;

    let models: string[] = [];
    let modelDetails: Array<{
      id: string;
      cacheSupported: boolean;
      cacheMode: 'automatic' | 'explicit' | 'unknown' | 'none';
      cacheNote: string;
    }> = [];
    let openRouterUsage: {
      keyLabel: string | null;
      isFreeTier: boolean | null;
      freeRequestsRemaining: number | null;
      freeRequestsResetAt: string | null;
      freeRequestsResetInSeconds: number | null;
      creditsUsed: number | null;
      creditsRemaining: number | null;
      creditsLimit: number | null;
      creditsReset: string | null;
    } | null = null;
    let openRouterUsageError: string | null = null;
    let openRouterAccess: {
      userKeyProvided: boolean;
      userKeyValid: boolean;
      freeOnly: boolean;
      usingEnvKey: boolean;
    } | null = null;

    if (provider === 'openrouter') {
      const userKey = typeof apiKey === 'string' ? apiKey.trim() : '';
      const userKeyProvided = Boolean(userKey);
      const userKeyValid = userKeyProvided ? await validateOpenRouterApiKey(userKey) : false;
      const freeOnly = !userKeyValid;
      models = await listOpenRouterModelsWithOptions(userKeyValid ? userKey : undefined, { freeOnly });
      openRouterAccess = {
        userKeyProvided,
        userKeyValid,
        freeOnly,
        usingEnvKey: freeOnly,
      };
      try {
        const usage = await getOpenRouterKeyInfo(userKeyValid ? userKey : undefined);
        openRouterUsage = {
          keyLabel: usage.label,
          isFreeTier: usage.isFreeTier,
          freeRequestsRemaining: usage.rateLimitRemaining,
          freeRequestsResetAt: usage.rateLimitResetAt,
          freeRequestsResetInSeconds: usage.rateLimitResetSeconds,
          creditsUsed: userKeyValid ? usage.usage : null,
          creditsRemaining: userKeyValid ? usage.limitRemaining : null,
          creditsLimit: userKeyValid ? usage.limit : null,
          creditsReset: userKeyValid ? usage.limitReset : null,
        };
      } catch (err) {
        openRouterUsageError = err instanceof Error ? err.message : 'OpenRouter usage lookup failed';
      }
    } else {
      models = await listOllamaModels();
    }
    modelDetails = models.map((id) => {
      const capability = getModelCacheCapability(provider, id);
      return {
        id,
        cacheSupported: capability.supported,
        cacheMode: capability.mode,
        cacheNote: capability.note,
      };
    });

    return new Response(
      JSON.stringify({
        provider,
        models,
        modelDetails,
        openRouterAccess,
        openRouterUsage,
        openRouterUsageError,
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

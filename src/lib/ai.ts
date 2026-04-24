/**
 * Helpers for AI integration: Ollama client and variant proposal.
 * Recipe context is provided via GET /api/recipes/markdown (see recipeMarkdown.ts).
 */

function getOllamaBase(): string {
  const base = import.meta.env.OLLAMA_BASE_URL;
  if (!base || typeof base !== 'string' || base.trim() === '') {
    throw new Error('OLLAMA_BASE_URL is not set or empty');
  }
  return base.replace(/\/$/, '');
}

function getOllamaModel(): string {
  const model = import.meta.env.OLLAMA_MODEL;
  if (!model || typeof model !== 'string' || model.trim() === '') {
    throw new Error('OLLAMA_MODEL is not set or empty');
  }
  return model.trim();
}

function getOpenRouterModel(): string {
  const model = import.meta.env.OPENROUTER_MODEL;
  if (!model || typeof model !== 'string' || model.trim() === '') {
    throw new Error('OPENROUTER_MODEL is not set or empty');
  }
  return model.trim();
}

function getOpenRouterEnvApiKey(): string {
  const apiKey = import.meta.env.OPENROUTER_API_KEY;
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new Error('OPENROUTER_API_KEY is not set or empty');
  }
  return apiKey.trim();
}

export type AIProvider = 'ollama' | 'openrouter';

export interface AIRequestConfig {
  provider?: AIProvider;
  model?: string;
  openRouterApiKey?: string;
}

function getProvider(config?: AIRequestConfig): AIProvider {
  return config?.provider === 'openrouter' ? 'openrouter' : 'ollama';
}

function getModelForProvider(config?: AIRequestConfig): string {
  const customModel = typeof config?.model === 'string' ? config.model.trim() : '';
  if (customModel) return customModel;
  return getProvider(config) === 'openrouter' ? getOpenRouterModel() : getOllamaModel();
}

export function getOllamaChatUrl(): string {
  return `${getOllamaBase()}/api/chat`;
}

export function getModel(): string {
  return getOllamaModel();
}

export async function listOllamaModels(): Promise<string[]> {
  const res = await fetch(`${getOllamaBase()}/api/tags`, {
    method: 'GET',
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama models failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { models?: { name?: string }[] };
  return (data.models ?? [])
    .map((m) => m.name?.trim() ?? '')
    .filter(Boolean);
}

export async function listOpenRouterModels(apiKey?: string): Promise<string[]> {
  return listOpenRouterModelsWithOptions(apiKey);
}

function parseOpenRouterPrice(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NaN;
}

export function isOpenRouterFreeModel(modelId: string): boolean {
  return modelId.trim().toLowerCase().endsWith(':free');
}

export async function validateOpenRouterApiKey(apiKey?: string): Promise<boolean> {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key) return false;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface OpenRouterKeyInfo {
  label: string | null;
  limit: number | null;
  limitReset: string | null;
  limitRemaining: number | null;
  usage: number | null;
  usageDaily: number | null;
  usageWeekly: number | null;
  usageMonthly: number | null;
  isFreeTier: boolean | null;
  rateLimitRemaining: number | null;
  rateLimitResetSeconds: number | null;
  rateLimitResetAt: string | null;
}

export async function getOpenRouterKeyInfo(apiKey?: string): Promise<OpenRouterKeyInfo> {
  const key = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : getOpenRouterEnvApiKey();
  const res = await fetch('https://openrouter.ai/api/v1/key', {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter key info failed: ${res.status} ${text}`);
  }
  const payload = (await res.json()) as {
    data?: {
      label?: string;
      limit?: number | null;
      limit_reset?: string | null;
      limit_remaining?: number | null;
      usage?: number;
      usage_daily?: number;
      usage_weekly?: number;
      usage_monthly?: number;
      is_free_tier?: boolean;
      rate_limit?: {
        remaining?: number;
        reset?: number | string;
      };
    };
  };
  const headerReset = res.headers.get('x-ratelimit-reset');
  const resetSeconds = headerReset ? Number.parseInt(headerReset, 10) : Number.NaN;
  const fallbackRemaining =
    typeof payload.data?.rate_limit?.remaining === 'number' ? payload.data.rate_limit.remaining : Number.NaN;
  const fallbackResetRaw = payload.data?.rate_limit?.reset;
  const fallbackResetSeconds =
    typeof fallbackResetRaw === 'number'
      ? fallbackResetRaw
      : typeof fallbackResetRaw === 'string'
        ? Number.parseInt(fallbackResetRaw, 10)
        : Number.NaN;
  const effectiveResetSeconds = Number.isFinite(resetSeconds) ? resetSeconds : fallbackResetSeconds;
  const rateLimitResetAt =
    Number.isFinite(effectiveResetSeconds) && effectiveResetSeconds >= 0
      ? new Date(Date.now() + effectiveResetSeconds * 1000).toISOString()
      : null;
  return {
    label: payload.data?.label ?? null,
    limit: typeof payload.data?.limit === 'number' ? payload.data.limit : null,
    limitReset: typeof payload.data?.limit_reset === 'string' ? payload.data.limit_reset : null,
    limitRemaining: typeof payload.data?.limit_remaining === 'number' ? payload.data.limit_remaining : null,
    usage: typeof payload.data?.usage === 'number' ? payload.data.usage : null,
    usageDaily: typeof payload.data?.usage_daily === 'number' ? payload.data.usage_daily : null,
    usageWeekly: typeof payload.data?.usage_weekly === 'number' ? payload.data.usage_weekly : null,
    usageMonthly: typeof payload.data?.usage_monthly === 'number' ? payload.data.usage_monthly : null,
    isFreeTier: typeof payload.data?.is_free_tier === 'boolean' ? payload.data.is_free_tier : null,
    rateLimitRemaining: (() => {
      const value = res.headers.get('x-ratelimit-remaining');
      const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
      if (Number.isFinite(parsed)) return parsed;
      if (Number.isFinite(fallbackRemaining)) return fallbackRemaining;
      return null;
    })(),
    rateLimitResetSeconds: Number.isFinite(effectiveResetSeconds) ? effectiveResetSeconds : null,
    rateLimitResetAt,
  };
}

export async function listOpenRouterModelsWithOptions(
  apiKey?: string,
  options?: { freeOnly?: boolean }
): Promise<string[]> {
  const key = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : getOpenRouterEnvApiKey();
  const headers: Record<string, string> = {};
  headers.Authorization = `Bearer ${key}`;
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter models failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as {
    data?: Array<{
      id?: string;
      pricing?: { prompt?: string | number; completion?: string | number };
    }>;
  };
  const models = (data.data ?? [])
    .map((m) => ({
      id: m.id?.trim() ?? '',
      promptPrice: parseOpenRouterPrice(m.pricing?.prompt),
      completionPrice: parseOpenRouterPrice(m.pricing?.completion),
    }))
    .filter((m) => Boolean(m.id));
  if (options?.freeOnly) {
    return models
      .filter(
        (m) =>
          isOpenRouterFreeModel(m.id) ||
          ((Number.isNaN(m.promptPrice) || m.promptPrice === 0) &&
            (Number.isNaN(m.completionPrice) || m.completionPrice === 0))
      )
      .map((m) => m.id);
  }
  return models.map((m) => m.id);
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Call Ollama chat API (non-streaming).
 */
export async function ollamaChat(messages: { role: string; content: string }[]): Promise<string> {
  const url = getOllamaChatUrl();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: getModel(),
      messages,
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama chat failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { message?: { content?: string }; done?: boolean };
  const content = data.message?.content ?? '';
  return content;
}

export async function openRouterChat(
  messages: { role: string; content: string }[],
  config?: AIRequestConfig,
  extraBody?: Record<string, unknown>
): Promise<string> {
  const apiKey = config?.openRouterApiKey?.trim() || getOpenRouterEnvApiKey();
  if (!apiKey) {
    throw new Error('OpenRouter API key missing (user key or OPENROUTER_API_KEY)');
  }
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getModelForProvider({ ...config, provider: 'openrouter' }),
      messages,
      stream: false,
      ...extraBody,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter chat failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string; type?: string }> } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const combined = content
      .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim();
    return combined;
  }
  return '';
}

function extractJsonObject(raw: string): string {
  const text = raw.trim();
  if (!text) return text;
  const codeFenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeFenceMatch?.[1]) return codeFenceMatch[1].trim();

  const start = text.indexOf('{');
  if (start === -1) return text;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1).trim();
      }
    }
  }
  return text;
}

function parseProposedVariant(rawMessage: string, source: string): ProposedVariant {
  let raw = extractJsonObject(rawMessage);

  function tryRepairJson(s: string): string {
    return s
      .replace(/,(\s*[}\]])/g, '$1')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
  }

  let parsed: ProposedVariant | null = null;
  for (const attempt of [raw, tryRepairJson(raw)]) {
    try {
      parsed = JSON.parse(attempt) as ProposedVariant;
      if (parsed?.variantName && parsed?.recipeData) break;
      parsed = null;
    } catch {
      // try repaired next
    }
  }
  if (!parsed?.variantName || !parsed?.recipeData) {
    throw new Error(`Invalid JSON from ${source}: ${raw.substring(0, 300)}`);
  }
  return parsed;
}

/**
 * Call Ollama chat API (streaming). Yields content deltas; caller can accumulate for full message.
 */
export async function* ollamaChatStream(
  messages: { role: string; content: string }[]
): AsyncGenerator<string, void, unknown> {
  const url = getOllamaChatUrl();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: getModel(),
      messages,
      stream: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama chat failed: ${res.status} ${text}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const data = JSON.parse(trimmed) as { message?: { content?: string }; done?: boolean };
          const content = data.message?.content ?? '';
          if (content) yield content;
        } catch {
          // ignore malformed lines
        }
      }
    }
    if (buffer.trim()) {
      try {
        const data = JSON.parse(buffer.trim()) as { message?: { content?: string } };
        const content = data.message?.content ?? '';
        if (content) yield content;
      } catch {
        // ignore
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* openRouterChatStream(
  messages: { role: string; content: string }[],
  config?: AIRequestConfig
): AsyncGenerator<string, void, unknown> {
  const apiKey = config?.openRouterApiKey?.trim() || getOpenRouterEnvApiKey();
  if (!apiKey) {
    throw new Error('OpenRouter API key missing (user key or OPENROUTER_API_KEY)');
  }
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getModelForProvider({ ...config, provider: 'openrouter' }),
      messages,
      stream: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter chat failed: ${res.status} ${text}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.replace(/^data:\s*/, '');
        if (payload === '[DONE]') continue;
        try {
          const data = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const content = data.choices?.[0]?.delta?.content ?? '';
          if (content) yield content;
        } catch {
          // ignore malformed lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* aiChatStream(
  messages: { role: string; content: string }[],
  config?: AIRequestConfig
): AsyncGenerator<string, void, unknown> {
  if (getProvider(config) === 'openrouter') {
    yield* openRouterChatStream(messages, config);
    return;
  }
  yield* ollamaChatStream(messages);
}

/** Schema for AI-generated recipe variant (Ollama structured output). */
export const RECIPE_VARIANT_FORMAT = {
  type: 'object',
  properties: {
    variantName: { type: 'string', description: 'Max 3 words; short label for how the variant differs, e.g. "Ohne Zucker", "Halbe Portionen"' },
    recipeData: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        subtitle: { type: 'string' },
        description: { type: 'string' },
        metadata: {
          type: 'object',
          properties: {
            servings: { type: 'number' },
            timeEntries: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  label: { type: 'string' },
                  minutes: { type: 'number' }
                },
                required: ['id', 'label', 'minutes']
              }
            },
            difficulty: { type: 'string', enum: ['leicht', 'mittel', 'schwer'] },
            nutrition: {
              type: 'object',
              properties: {
                calories: { type: 'number' },
                carbohydrates: { type: 'number' },
                protein: { type: 'number' },
                fat: { type: 'number' }
              }
            }
          },
          required: ['servings', 'timeEntries']
        },
        category: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        ingredientGroups: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              ingredients: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    description: { type: 'string' },
                    quantities: {
                      type: 'array',
                      description: 'Exactly one element: the single amount for this ingredient in the variant',
                      items: {
                        type: 'object',
                        properties: { amount: { type: 'number' }, unit: { type: 'string' } },
                        required: ['amount', 'unit']
                      }
                    }
                  },
                  required: ['id', 'name', 'quantities']
                }
              }
            },
            required: ['id', 'ingredients']
          }
        },
        preparationGroups: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              steps: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    text: { type: 'string' },
                    linkedIngredients: { type: 'array' },
                    intermediateIngredients: { type: 'array' }
                  },
                  required: ['id', 'text']
                }
              }
            },
            required: ['id', 'steps']
          }
        },
        sourceUrl: { type: 'string' }
      },
      required: ['title', 'metadata', 'ingredientGroups', 'preparationGroups']
    }
  },
  required: ['variantName', 'recipeData']
} as const;

export interface ProposedVariant {
  variantName: string;
  recipeData: Record<string, unknown>;
}

/**
 * Call Ollama with structured output to propose a recipe variant based on conversation and recipe.
 */
export async function ollamaProposeVariant(
  recipeContext: string,
  conversationSummary: string,
  messages: ChatMessage[],
  config?: AIRequestConfig
): Promise<ProposedVariant> {
  const conversationSnippet = messages
    .slice(-10)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const userContent = `Erstelle basierend auf dem folgenden Rezept-Kontext und dem Chat-Verlauf eine Rezeptvariante.
Antworte NUR mit dem JSON-Objekt (variantName + recipeData), kein anderer Text.

Dein Output wird 1:1 ins Kochbuch übernommen, ohne weitere Bearbeitung. Gib daher das KOMPLETTE neue Rezept (alle Felder, alle Zutaten, alle Schritte) – nicht nur Änderungen. Fehlende Inhalte werden nicht ergänzt.

Wenn mehrere Rezepte im Kontext enthalten sind, ist das ERSTE Rezept immer das Original und MUSS die Basis für alle Anpassungen bleiben. Alle weiteren Rezepte sind nur zusätzliche Referenzen/Inspiration (z.B. für Mengen, Zutaten oder Formulierungen) und dürfen die Grundstruktur des Originals nicht vollständig ersetzen.

variantName (PFLICHT):
- Maximal 3 Wörter. Kurz beschreiben, worin sich die Variante vom Original unterscheidet.
- Beispiele: "Ohne Zucker", "Halbe Portionen", "Vegetarisch", "Schnelle Version", "Für 2 Personen"
- Keine langen Sätze, nur eine kurze Kennzeichnung.

WICHTIG – bitte vollständig übernehmen (nur gezielt ändern, ausgehend vom Original):
- description: Immer die vollständige Beschreibung übernehmen (oder gezielt anpassen). Nie weglassen.
- tags: Alle Tags aus dem Original übernehmen (Array von Strings), sofern du sie nicht änderst.
- category: Kategorie aus dem Original übernehmen.
- preparationGroups: Gleiche Anzahl und Reihenfolge wie im Original. Jeder Schritt muss "id", "text", "linkedIngredients" (Array), "intermediateIngredients" (Array) haben. Alle Schritte vollständig übernehmen, sofern du sie nicht gezielt änderst.
- ingredientGroups: Pro Zutat genau EINE Menge. "quantities" muss ein Array mit genau einem Element sein: { "amount": Zahl, "unit": "g" oder "ml" oder "EL" etc. }. Keine doppelten Mengen (z.B. nicht Original und Variante); nur die eine Menge für die Variante angeben.
- metadata.timeEntries: Alle Zeiten (id, label, minutes) übernehmen.
- subtitle: Übernehmen, falls vorhanden.

 Bilder (images) werden vom System übernommen; du musst sie nicht im JSON angeben.

Rezept-Kontext (zuerst Original, danach ggf. weitere referenzierte Rezepte):
${recipeContext}

${conversationSummary}

Letzter Chat-Verlauf:
${conversationSnippet}

Gib das JSON mit variantName (max. 3 Wörter) und recipeData zurück. Pro Zutat nur ein Eintrag in "quantities". Verwende für alle id-Felder UUID-ähnliche Werte (z.B. "a1b2c3", "d4e5f6").`;

  const rawMessage =
    getProvider(config) === 'openrouter'
      ? await openRouterChat([{ role: 'user', content: userContent }], config)
      : await (async () => {
          const url = getOllamaChatUrl();
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: getModelForProvider(config),
              messages: [{ role: 'user', content: userContent }],
              stream: false,
              format: RECIPE_VARIANT_FORMAT,
              options: { temperature: 0.3 },
            }),
          });

          if (!res.ok) {
            const text = await res.text();
            throw new Error(`Ollama propose-variant failed: ${res.status} ${text}`);
          }
          const data = (await res.json()) as { message?: { content?: string } };
          return data.message?.content ?? '';
        })();
  if (getProvider(config) === 'openrouter') {
    const responseWithSchema = await openRouterChat(
      [{ role: 'user', content: userContent }],
      config,
      {
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'recipe_variant',
            strict: true,
            schema: RECIPE_VARIANT_FORMAT,
          },
        },
      }
    );
    return parseProposedVariant(responseWithSchema, 'OpenRouter');
  }
  return parseProposedVariant(rawMessage, 'Ollama');
}

/**
 * Propose a recipe variant from a single assistant message (e.g. from chat) and the original recipe.
 * Context: das Original-Rezept (und ggf. weitere manuell referenzierte Rezepte) plus der Varianten-Text.
 * Kein vollständiger Chat-Verlauf.
 */
export async function ollamaProposeVariantFromMessage(
  originalRecipeMarkdown: string,
  variantMessage: string,
  config?: AIRequestConfig
): Promise<ProposedVariant> {
  const userContent = `Erstelle aus dem folgenden Rezept-Kontext (erst Original-Rezept, danach ggf. weitere referenzierte Rezepte) und der beschriebenen Variante ein JSON (variantName + recipeData). Antworte NUR mit dem JSON-Objekt, kein anderer Text.

WICHTIG: Gib das KOMPLETTE neue Rezept aus – nicht nur die Änderungen oder Unterschiede. Jedes Feld (title, description, alle Zutaten, alle Zubereitungsschritte, tags, category, metadata usw.) muss vollständig im JSON stehen. Dein Output wird 1:1 ins Kochbuch übernommen, ohne weitere Bearbeitung. Fehlende Inhalte werden nicht ergänzt – alles, was das Rezept braucht, muss in deiner Ausgabe enthalten sein. Orientiere dich am Original für Struktur und fehlende Angaben.

variantName (PFLICHT): Maximal 3 Wörter (z.B. "Ohne Zucker", "Halbe Portionen", "Für 2 Personen").

recipeData: Das gesamte Rezept als vollständige Rezeptdaten (description, tags, category, ingredientGroups, preparationGroups, metadata, title, subtitle usw.). Pro Zutat genau EINE Menge in "quantities". Verwende für id-Felder UUID-ähnliche Werte (z.B. "a1b2c3"). Bilder werden vom System übernommen.

--- REZEPT-KONTEXT (Markdown) ---
${originalRecipeMarkdown}

--- PROPOSED VARIANT (from assistant message – convert this into the full JSON recipeData) ---
${variantMessage}

Gib nur das JSON mit variantName (max. 3 Wörter) und dem vollständigen recipeData zurück. Pro Zutat nur ein Eintrag in "quantities".`;

  const rawMessage =
    getProvider(config) === 'openrouter'
      ? await openRouterChat([{ role: 'user', content: userContent }], config)
      : await (async () => {
          const url = getOllamaChatUrl();
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: getModelForProvider(config),
              messages: [{ role: 'user', content: userContent }],
              stream: false,
              format: RECIPE_VARIANT_FORMAT,
              options: { temperature: 0.3 },
            }),
          });

          if (!res.ok) {
            const text = await res.text();
            throw new Error(`Ollama propose-variant failed: ${res.status} ${text}`);
          }
          const data = (await res.json()) as { message?: { content?: string } };
          return data.message?.content ?? '';
        })();
  if (getProvider(config) === 'openrouter') {
    const responseWithSchema = await openRouterChat(
      [{ role: 'user', content: userContent }],
      config,
      {
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'recipe_variant',
            strict: true,
            schema: RECIPE_VARIANT_FORMAT,
          },
        },
      }
    );
    return parseProposedVariant(responseWithSchema, 'OpenRouter');
  }
  return parseProposedVariant(rawMessage, 'Ollama');
}

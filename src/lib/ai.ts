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

export function getOllamaChatUrl(): string {
  return `${getOllamaBase()}/api/chat`;
}

export function getModel(): string {
  return getOllamaModel();
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
  messages: ChatMessage[]
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

  const url = getOllamaChatUrl();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: getModel(),
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
  let raw = data.message?.content?.trim() ?? '';
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

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
    throw new Error(`Invalid JSON from Ollama: ${raw.substring(0, 200)}`);
  }
  return parsed;
}

/**
 * Propose a recipe variant from a single assistant message (e.g. from chat) and the original recipe.
 * Context: das Original-Rezept (und ggf. weitere manuell referenzierte Rezepte) plus der Varianten-Text.
 * Kein vollständiger Chat-Verlauf.
 */
export async function ollamaProposeVariantFromMessage(
  originalRecipeMarkdown: string,
  variantMessage: string
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

  const url = getOllamaChatUrl();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: getModel(),
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
  let raw = data.message?.content?.trim() ?? '';
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

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
    throw new Error(`Invalid JSON from Ollama: ${raw.substring(0, 200)}`);
  }
  return parsed;
}

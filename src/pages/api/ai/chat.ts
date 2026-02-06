import type { APIRoute } from 'astro';
import { db } from '../../../lib/database';
import { ollamaChatStream, type ChatMessage } from '../../../lib/ai';

// In-memory cache: recipeId -> messages (user/assistant only; recipe context is injected on send)
const chatCache = new Map<string, ChatMessage[]>();

function getCachedMessages(recipeId: string): ChatMessage[] {
  return chatCache.get(recipeId) ?? [];
}

function setCachedMessages(recipeId: string, messages: ChatMessage[]): void {
  chatCache.set(recipeId, messages);
}

function deleteCachedMessages(recipeId: string): void {
  chatCache.delete(recipeId);
}

export const GET: APIRoute = async ({ url }) => {
  const recipeId = url.searchParams.get('recipeId');
  if (!recipeId) {
    return new Response(JSON.stringify({ error: 'recipeId required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const messages = getCachedMessages(recipeId);
  return new Response(JSON.stringify({ messages }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { recipeId, recipeIds, message } = body as {
      recipeId?: string;
      recipeIds?: string[];
      message?: string;
    };

    if (!recipeId || typeof message !== 'string' || !message.trim()) {
      return new Response(
        JSON.stringify({ error: 'recipeId and message (non-empty string) are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const recipe = db.getRecipe(recipeId);
    if (!recipe) {
      return new Response(JSON.stringify({ error: 'Recipe not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const origin = new URL(request.url).origin;
    const idsToLoad =
      Array.isArray(recipeIds) && recipeIds.length > 0
        ? [...new Set(recipeIds)]
        : [recipeId];

    const recipeMarkdownParts: string[] = [];
    for (let i = 0; i < idsToLoad.length; i++) {
      const id = idsToLoad[i];
      const r = db.getRecipe(id);
      const title = r?.title ?? 'Rezept';
      const markdownRes = await fetch(
        `${origin}/api/recipes/markdown?id=${encodeURIComponent(id)}`
      );
      const md = markdownRes.ok ? await markdownRes.text() : '';
      const label =
        idsToLoad.length === 1
          ? 'Rezept (als Markdown)'
          : `Rezept ${i + 1}: ${title} (als Markdown)`;
      recipeMarkdownParts.push(`--- ${label} ---\n${md}`);
    }
    const recipeMarkdown = recipeMarkdownParts.join('\n\n');

    const cached = getCachedMessages(recipeId);
    const userMessage: ChatMessage = { role: 'user', content: message.trim() };
    const intro =
      idsToLoad.length === 1
        ? 'Der Nutzer chattet über das folgende Rezept.'
        : 'Der Nutzer chattet über die folgenden Rezepte (mehrere sind referenziert). Das ERSTE Rezept im Kontext ist immer das Original und dient als Basis für alle Änderungen. Alle weiteren Rezepte sind nur zusätzliche Referenzen/Inspiration und sollen NICHT die Grundstruktur des Originals überschreiben.';
    const messagesForOllama: { role: string; content: string }[] = [
      {
        role: 'user',
        content: `Du bist ein hilfreicher Assistent für ein Kochbuch. ${intro} Antworte auf Deutsch.

WICHTIG – Rezeptvariante: Wenn du eine konkrete neue Rezeptvariante vorschlägst (mit Zutaten, Mengen und Zubereitungsschritten), beginne deine Nachricht mit der exakten Zeile [RECIPE_VARIANT] (allein stehend, in eckigen Klammern). Dann kann die App einen Button „Variante erstellen“ anzeigen. Bei normalen Antworten oder Erklärungen ohne vollständigen Varianten-Vorschlag diese Zeile nicht verwenden.

${recipeMarkdown}`,
      },
      ...cached,
      userMessage,
    ];

    const encoder = new TextEncoder();
    let fullContent = '';

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of ollamaChatStream(messagesForOllama)) {
            fullContent += chunk;
            controller.enqueue(encoder.encode(JSON.stringify({ delta: chunk }) + '\n'));
          }
          const assistantMessage: ChatMessage = { role: 'assistant', content: fullContent };
          const newCache = [...cached, userMessage, assistantMessage];
          setCachedMessages(recipeId, newCache);
          controller.enqueue(encoder.encode(JSON.stringify({ done: true, fullMessage: fullContent }) + '\n'));
        } catch (err) {
          console.error('AI chat stream error:', err);
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                error: err instanceof Error ? err.message : 'Chat request failed',
              }) + '\n'
            )
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('AI chat error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Chat request failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const DELETE: APIRoute = async ({ url }) => {
  const recipeId = url.searchParams.get('recipeId');
  if (!recipeId) {
    return new Response(JSON.stringify({ error: 'recipeId required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  deleteCachedMessages(recipeId);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

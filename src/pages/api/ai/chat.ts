import type { APIRoute } from 'astro';
import { db } from '../../../lib/database';
import { aiChatStream, type AIRequestConfig, type ChatMessage } from '../../../lib/ai';

// In-memory cache: cacheKey -> messages (user/assistant only; recipe context is injected on send)
const chatCache = new Map<string, ChatMessage[]>();
const ALL_RECIPES_CONTEXT_ID = '__all_recipes__';

function getCacheKey(recipeId: string, chatId?: string): string {
  const trimmedChatId = typeof chatId === 'string' ? chatId.trim() : '';
  return `${recipeId}::${trimmedChatId || 'default'}`;
}

function sanitizeHistory(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input)) return null;
  const out = input
    .filter((m) => m && typeof m === 'object')
    .map((m) => {
      const mm = m as Record<string, unknown>;
      const role = mm.role === 'user' || mm.role === 'assistant' ? mm.role : null;
      const content = typeof mm.content === 'string' ? mm.content : null;
      if (!role || content == null) return null;
      return { role, content };
    })
    .filter(Boolean) as ChatMessage[];
  return out;
}

function getCachedMessages(cacheKey: string): ChatMessage[] {
  return chatCache.get(cacheKey) ?? [];
}

function setCachedMessages(cacheKey: string, messages: ChatMessage[]): void {
  chatCache.set(cacheKey, messages);
}

function deleteCachedMessages(cacheKey: string): void {
  chatCache.delete(cacheKey);
}

export const GET: APIRoute = async ({ url }) => {
  const recipeId = url.searchParams.get('recipeId');
  const chatId = url.searchParams.get('chatId') || undefined;
  if (!recipeId) {
    return new Response(JSON.stringify({ error: 'recipeId required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const messages = getCachedMessages(getCacheKey(recipeId, chatId));
  return new Response(JSON.stringify({ messages }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { recipeId, recipeIds, message, chatId, history, provider, model, openRouterApiKey } = body as {
      recipeId?: string;
      recipeIds?: string[];
      message?: string;
      chatId?: string;
      history?: ChatMessage[];
      provider?: AIRequestConfig['provider'];
      model?: string;
      openRouterApiKey?: string;
    };

    if (!recipeId || typeof message !== 'string' || !message.trim()) {
      return new Response(
        JSON.stringify({ error: 'recipeId and message (non-empty string) are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const isAllRecipesContext = recipeId === ALL_RECIPES_CONTEXT_ID;
    const recipe = isAllRecipesContext ? null : db.getRecipe(recipeId);
    if (!isAllRecipesContext && !recipe) {
      return new Response(JSON.stringify({ error: 'Recipe not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const origin = new URL(request.url).origin;
    const idsToLoad = (() => {
      if (isAllRecipesContext) {
        return db.getAllRecipes().map((r) => r.id);
      }
      return Array.isArray(recipeIds) && recipeIds.length > 0
        ? [...new Set(recipeIds.filter((id) => id && id !== ALL_RECIPES_CONTEXT_ID))]
        : [recipeId];
    })();

    const recipeMarkdownParts: string[] = [];
    const recipeIdList: string[] = [];
    for (let i = 0; i < idsToLoad.length; i++) {
      const id = idsToLoad[i];
      const r = db.getRecipe(id);
      const title = r?.title ?? 'Rezept';
      recipeIdList.push(`- ${title} => ${id}`);
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
    const allowedRecipeIdsSection =
      recipeIdList.length > 0
        ? `Verfügbare Rezept-IDs (nur diese für Marker verwenden):\n${recipeIdList.join('\n')}`
        : 'Keine Rezept-IDs verfügbar.';

    const cacheKey = getCacheKey(recipeId, chatId);
    const providedHistory = sanitizeHistory(history);
    const cached = providedHistory ?? getCachedMessages(cacheKey);
    const userMessage: ChatMessage = { role: 'user', content: message.trim() };
    const intro = isAllRecipesContext
      ? 'Der Nutzer chattet über den gesamten Rezeptbestand.'
      : idsToLoad.length === 1
        ? 'Der Nutzer chattet über das folgende Rezept.'
        : 'Der Nutzer chattet über die folgenden Rezepte (mehrere sind referenziert). Das ERSTE Rezept im Kontext ist immer das Original und dient als Basis für alle Änderungen. Alle weiteren Rezepte sind nur zusätzliche Referenzen/Inspiration und sollen NICHT die Grundstruktur des Originals überschreiben.';
    const allRecipesBehavior = isAllRecipesContext
      ? `WICHTIG fuer den Modus "Alle Rezepte":
- Beantworte Anfragen IMMER zuerst auf Basis der im Kontext enthaltenen Rezepte.
- Wenn der Nutzer nach Ideen/Empfehlungen/Suche fragt, priorisiere bestehende Rezepte aus dem Bestand und nenne diese mit RECIPE_REF-Markern.
- Erfinde kein neues Rezept, solange passende oder teilweise passende Rezepte im Bestand vorhanden sind.
- Ein neues Rezept darfst du nur vorschlagen, wenn der Nutzer das explizit verlangt (z.B. "erstelle ein neues Rezept") ODER wenn im Bestand wirklich nichts Passendes vorhanden ist.
- Falls nichts Passendes vorhanden ist, sage das transparent und frage zuerst nach, ob du ein neues Rezept erstellen sollst.`
      : '';
    const messagesForOllama: { role: string; content: string }[] = [
      {
        role: 'user',
        content: `Du bist ein hilfreicher Assistent für ein Kochbuch. ${intro} Antworte auf Deutsch.

WICHTIG – Rezeptvariante: Wenn du eine konkrete Variante zu einem bestehenden Rezept vorschlägst (mit Zutaten, Mengen und Zubereitungsschritten), beginne deine Nachricht mit der exakten Zeile [RECIPE_VARIANT:<id>] (allein stehend, in eckigen Klammern). Wenn es stattdessen ein komplett neues Rezept sein soll, beginne mit [RECIPE_VARIANT] ohne ID. Dann kann die App den passenden Button anzeigen. Bei normalen Antworten oder Erklärungen ohne vollständigen Varianten-Vorschlag diese Zeile nicht verwenden.
WICHTIG – Entscheidung neues Rezept vs. Variante:
- Prüfe vor einem neuen Rezept immer, ob im Bestand bereits ein sehr ähnliches Rezept existiert.
- Wenn der Nutzer Unterschiede/Anpassungen zu einem bestehenden Rezept beschreibt, schlage bevorzugt eine Variante vor ([RECIPE_VARIANT:<id>]) statt ein komplett neues Rezept.
- Ein komplett neues Rezept ([RECIPE_VARIANT] ohne ID) nur dann, wenn kein passendes Basisrezept vorhanden ist ODER der Nutzer explizit ein neues, unabhängiges Rezept verlangt.

WICHTIG – Tool-Marker für die UI:
1) Wenn du in deiner Antwort ein oder mehrere konkrete Rezepte referenzierst, füge am Ende deiner Nachricht für JEDES referenzierte Rezept den Marker [RECIPE_REF:<id>] hinzu (z.B. [RECIPE_REF:abc123]). Die Marker dürfen zusätzlich zur normalen textlichen Antwort erscheinen.
2) Wenn du einen Rezeptsatz für eine Einkaufsliste vorschlagen willst, füge GENAU EINEN Marker [SHOPPING_LIST_RECIPES:id1@portionen,id2@portionen,id3] hinzu. Portionen pro Rezept sind optional; ohne @zahl wird die gespeicherte Standard-Portion genutzt.
3) Wenn der Nutzer konkrete Änderungen am Rezept wünscht (z.B. Nährwerte ergänzen, Zeiten ändern, Zutaten/Schritte anpassen), füge zusätzlich den Marker [RECIPE_EDIT:<id>|regions=<liste>] für das zu bearbeitende Rezept hinzu.
4) Diese Marker sind nur Vorschläge für die UI. Du darfst niemals behaupten, dass du bereits etwas zur Einkaufsliste oder zum Rezept gespeichert/geändert hast. Änderungen passieren erst nach expliziter Bestätigung durch den Nutzer.
5) Nutze nur IDs, die im Rezeptkontext existieren.
6) Nutze bei RECIPE_REF/RECIPE_EDIT exakt die ID aus der untenstehenden Liste "Verfügbare Rezept-IDs". Keine erfundenen oder verkürzten IDs.
7) Wenn du ein bestehendes Rezept empfiehlst/erwähnst, MUSST du zwingend den passenden RECIPE_REF-Marker setzen. Eine Empfehlung ohne RECIPE_REF ist ungültig.
8) Bei JEDEM Änderungswunsch am Rezept (Nährwerte, Zeiten, Zutaten, Zubereitung, Titel, Beschreibung, Tags, Kategorie, Portionen etc.) MUSST du genau EINEN [RECIPE_EDIT:<id>|regions=<liste>]-Marker setzen. Antworten mit Änderungsvorschlägen ohne RECIPE_EDIT sind ungültig.
8a) Auch wenn der Nutzer "alle Rezepte" oder mehrere Rezepte erwähnt, darfst du pro Antwort nur EIN Zielrezept für Bearbeitung/Variante auswählen. Der Marker muss diese konkrete Ziel-ID enthalten.
9) Setze alle Marker gesammelt am ENDE der Nachricht in eigenen Zeilen.
10) Wenn du Markdown-Tabellen nutzt: Header, Trenner und ALLE Datenzeilen müssen exakt dieselbe Spaltenanzahl haben. Keine fehlenden oder zusätzlichen Spalten in einzelnen Zeilen.
11) Wenn saisonale Zutaten in vorgeschlagenen/erwähnten Rezepten vorkommen, weise kurz auf den Saisonstatus hin (in Saison/außer Saison). Bei voraussichtlich nicht saisonalen Zutaten gib einen klaren Warnhinweis und biete nach Möglichkeit saisonale Alternativen an.

Beispiel (Änderungswunsch an einem einzelnen Rezept):
...
[RECIPE_EDIT:<id>|regions=metadata.nutrition]

Gültige Regions:
- title
- subtitle
- description
- metadata.servings
- metadata.timeEntries
- metadata.nutrition
- category
- tags
- ingredientGroups
- preparationGroups

Beispiel (Empfehlung aus Bestand):
...
[RECIPE_REF:<id1>]
[RECIPE_REF:<id2>]

WICHTIG - Fehlerbehandlung:
- Wenn eine angefragte Rezept-ID nicht in der Liste steht: "Dieses Rezept existiert nicht im Bestand."
- Wenn Änderung an mehreren Rezepten gewünscht: "Ich kann nur ein Rezept gleichzeitig bearbeiten. Welches soll ich zuerst anpassen?"
- Wenn keine passenden Rezepte im Bestand: "Ich habe kein passendes Rezept gefunden. Soll ich ein neues erstellen?"

${allRecipesBehavior}

${allowedRecipeIdsSection}

${recipeMarkdown}`,
      },
      ...cached,
      userMessage,
    ];

    const encoder = new TextEncoder();
    let fullContent = '';
    const aiConfig: AIRequestConfig = {
      provider,
      model,
      openRouterApiKey,
    };

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of aiChatStream(messagesForOllama, aiConfig)) {
            fullContent += chunk;
            controller.enqueue(encoder.encode(JSON.stringify({ delta: chunk }) + '\n'));
          }
          const assistantMessage: ChatMessage = { role: 'assistant', content: fullContent };
          const newCache = [...cached, userMessage, assistantMessage];
          setCachedMessages(cacheKey, newCache);
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
  const chatId = url.searchParams.get('chatId') || undefined;
  if (!recipeId) {
    return new Response(JSON.stringify({ error: 'recipeId required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  deleteCachedMessages(getCacheKey(recipeId, chatId));
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

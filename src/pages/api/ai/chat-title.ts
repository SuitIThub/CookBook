import type { APIRoute } from 'astro';
import { aiChatStream, type AIRequestConfig } from '../../../lib/ai';

function sanitizeMessages(input: unknown): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(input)) return [];
  return input
    .filter((m) => m && typeof m === 'object')
    .map((m) => {
      const mm = m as Record<string, unknown>;
      const role = mm.role === 'user' || mm.role === 'assistant' ? mm.role : null;
      const content = typeof mm.content === 'string' ? mm.content.trim() : '';
      if (!role || !content) return null;
      return { role, content };
    })
    .filter(Boolean) as Array<{ role: 'user' | 'assistant'; content: string }>;
}

function cleanTitle(raw: string): string {
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  const unquoted = oneLine.replace(/^["'`]+|["'`]+$/g, '').trim();
  return (unquoted.slice(0, 48) || 'Neuer Chat').trim();
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { messages, provider, model, openRouterApiKey } = body as {
      messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
      provider?: AIRequestConfig['provider'];
      model?: string;
      openRouterApiKey?: string;
    };

    const history = sanitizeMessages(messages).slice(-8);
    if (history.length === 0) {
      return new Response(JSON.stringify({ title: 'Neuer Chat' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const prompt = `Erzeuge aus dem folgenden Chat-Verlauf einen sehr kurzen deutschen Chat-Titel.
Regeln:
- maximal 4 Wörter
- keine Anführungszeichen
- keine Emojis
- kein Satzzeichen am Ende
- nur den Titel ausgeben, sonst nichts

Verlauf:
${history.map((m) => `${m.role}: ${m.content}`).join('\n')}`;

    const config: AIRequestConfig = { provider, model, openRouterApiKey };
    let raw = '';
    for await (const chunk of aiChatStream([{ role: 'user', content: prompt }], config)) {
      raw += chunk;
    }

    return new Response(JSON.stringify({ title: cleanTitle(raw) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Chat title generation failed:', err);
    return new Response(JSON.stringify({ error: 'Failed to generate chat title' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};


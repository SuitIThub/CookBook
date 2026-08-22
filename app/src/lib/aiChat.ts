/**
 * AI chat client. The server (/api/ai/chat) loads the recipe context, talks to
 * the configured provider (Ollama or OpenRouter) and streams the answer back as
 * newline-delimited JSON: {status}|{ping}|{delta}|{done}|{error}. This is
 * online-only and token-gated (POST), and the provider/model/key come from the
 * app's AI settings. Recipe markers (e.g. [RECIPE_VARIANT]) are left in the text
 * for the caller to interpret.
 */
import { getServerUrl, getAlias, getToken, getAiProvider, getAiModel, getOpenRouterApiKey } from './settings';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function apiBase(): string {
  const configured = getServerUrl();
  if (configured) return configured;
  return (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const alias = getAlias();
  const token = getToken();
  if (alias) headers['X-Alias'] = alias;
  if (token) headers['X-Auth-Token'] = token;
  return headers;
}

export interface StreamHandlers {
  onDelta?: (chunk: string) => void;
  onDone?: (fullMessage: string) => void;
  onError?: (message: string) => void;
}

/**
 * Send a chat message and stream the assistant reply. Resolves with the full
 * assistant message once the stream completes. Pass `signal` to abort.
 */
export async function streamChat(
  params: { recipeId: string; message: string; history?: ChatMessage[]; chatId?: string },
  handlers: StreamHandlers = {},
  signal?: AbortSignal
): Promise<string> {
  const provider = getAiProvider();
  const model = getAiModel();
  const body: Record<string, unknown> = {
    recipeId: params.recipeId,
    message: params.message,
    history: params.history ?? [],
    provider
  };
  if (params.chatId) body.chatId = params.chatId;
  if (model) body.model = model;
  if (provider === 'openrouter') {
    const key = getOpenRouterApiKey();
    if (key) body.openRouterApiKey = key;
  }

  const res = await fetch(`${apiBase()}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', ...authHeaders() },
    body: JSON.stringify(body),
    signal
  });

  if (!res.ok) {
    let msg = `Chat fehlgeschlagen (${res.status})`;
    try {
      const j: any = await res.json();
      if (j?.error || j?.userMessage) msg = j.userMessage || j.error;
    } catch {
      /* non-JSON */
    }
    handlers.onError?.(msg);
    throw new Error(msg);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('Keine Antwort vom Server.');
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let streamError: string | null = null;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let evt: any;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      return; // ignore malformed lines
    }
    if (evt.ping || evt.status) return;
    if (typeof evt.delta === 'string') {
      full += evt.delta;
      handlers.onDelta?.(evt.delta);
    } else if (evt.done) {
      if (typeof evt.fullMessage === 'string') full = evt.fullMessage;
    } else if (evt.error) {
      streamError = String(evt.error);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) handleLine(line);
  }
  if (buffer.trim()) handleLine(buffer);

  if (streamError) {
    handlers.onError?.(streamError);
    throw new Error(streamError);
  }
  handlers.onDone?.(full);
  return full;
}

/**
 * Turn an assistant variant proposal (chat message text) into a real recipe
 * variant. The server generates the full recipe JSON via the AI provider and
 * creates it linked to `recipeId`; returns the new variant's id. Online-only.
 */
export async function proposeVariantFromMessage(recipeId: string, variantMessage: string): Promise<string> {
  const provider = getAiProvider();
  const model = getAiModel();
  const body: Record<string, unknown> = {
    recipeId,
    targetRecipeId: recipeId,
    variantMessage,
    provider
  };
  if (model) body.model = model;
  if (provider === 'openrouter') {
    const key = getOpenRouterApiKey();
    if (key) body.openRouterApiKey = key;
  }
  const res = await fetch(`${apiBase()}/api/ai/propose-variant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders() },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    let msg = `Variante fehlgeschlagen (${res.status})`;
    try {
      const j: any = await res.json();
      if (j?.error || j?.userMessage) msg = j.userMessage || j.error;
    } catch {
      /* non-JSON */
    }
    throw new Error(msg);
  }
  const created: any = await res.json();
  const id = created?.id;
  if (!id) throw new Error('Variante lieferte kein Rezept.');
  return id;
}

/** Clear the server-side chat history for a recipe. */
export async function clearChat(recipeId: string, chatId?: string): Promise<void> {
  const qs = new URLSearchParams({ recipeId });
  if (chatId) qs.set('chatId', chatId);
  await fetch(`${apiBase()}/api/ai/chat?${qs.toString()}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json', ...authHeaders() }
  }).catch(() => {});
}

/** Known UI markers the assistant may append; stripped from the displayed text. */
const MARKER_RE = /^\s*\[(RECIPE_VARIANT|RECIPE_REF|RECIPE_EDIT|SHOPPING_LIST_RECIPES)(:[^\]]*)?\]\s*$/;

export function stripMarkers(text: string): string {
  return text
    .split('\n')
    .filter((line) => !MARKER_RE.test(line))
    .join('\n')
    .trim();
}

/** Detect a variant proposal marker: returns the target recipe id, '' for a new recipe, or null. */
export function detectVariantMarker(text: string): string | null {
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*\[RECIPE_VARIANT(?::([^\]]*))?\]\s*$/);
    if (m) return (m[1] ?? '').trim();
  }
  return null;
}

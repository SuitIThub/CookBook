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

/** Detect an edit-request marker [RECIPE_EDIT:<id>|regions=<list>]; returns the requested regions or null. */
export function detectEditMarker(text: string): { regions: string[] } | null {
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*\[RECIPE_EDIT:([^\]|]*)(?:\|regions=([^\]]*))?\]\s*$/);
    if (m) {
      const regions = (m[2] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return { regions };
    }
  }
  return null;
}

export interface EditHighlight {
  path: string;
  before: string;
  after: string;
}

export interface EditProposal {
  highlights: EditHighlight[];
  draft: any | null;
  diagnostics: { status: string; message: string } | null;
}

/**
 * Ask the AI for an edit patch. The server stores it as a draft and returns a
 * preview token; we fetch the highlights and the proposed (draft) recipe so the
 * caller can show a confirm step before applying. Online-only, token-gated.
 */
export async function proposeEdit(recipeId: string, editMessage: string, regions: string[]): Promise<EditProposal> {
  const provider = getAiProvider();
  const model = getAiModel();
  const body: Record<string, unknown> = { recipeId, editMessage, regions, provider };
  if (model) body.model = model;
  if (provider === 'openrouter') {
    const key = getOpenRouterApiKey();
    if (key) body.openRouterApiKey = key;
  }
  const res = await fetch(`${apiBase()}/api/ai/propose-edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders() },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    let msg = `Bearbeitungsvorschlag fehlgeschlagen (${res.status})`;
    try {
      const j: any = await res.json();
      if (j?.error || j?.userMessage) msg = j.userMessage || j.error;
    } catch {
      /* non-JSON */
    }
    throw new Error(msg);
  }
  const { token } = (await res.json()) as { token?: string };

  let highlights: EditHighlight[] = [];
  let diagnostics: EditProposal['diagnostics'] = null;
  if (token) {
    const pv = await fetch(`${apiBase()}/api/ai/edit-preview?token=${encodeURIComponent(token)}`, {
      headers: { Accept: 'application/json', ...authHeaders() }
    });
    if (pv.ok) {
      const d: any = await pv.json();
      highlights = Array.isArray(d?.highlights) ? d.highlights : [];
      diagnostics = d?.diagnostics ?? null;
    }
  }

  const dr = await fetch(`${apiBase()}/api/drafts?recipeId=${encodeURIComponent(recipeId)}`, {
    headers: { Accept: 'application/json', ...authHeaders() }
  });
  const draft = dr.ok ? await dr.json() : null;

  return { highlights, draft, diagnostics };
}

/** Discard a server-side draft (after applying or cancelling an edit proposal). */
export async function discardDraft(recipeId: string): Promise<void> {
  await fetch(`${apiBase()}/api/drafts?recipeId=${encodeURIComponent(recipeId)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json', ...authHeaders() }
  }).catch(() => {});
}

/* ------------------------------------------------------------------------ */
/* Website RecipeAIChatModal protocol (tabs, references, explicit model). */

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  costUsd?: number;
}

function aiSettingsBody(provider?: string, model?: string): Record<string, unknown> {
  const p = provider || getAiProvider();
  const body: Record<string, unknown> = { provider: p };
  const m = model ?? getAiModel();
  if (m) body.model = m;
  const key = getOpenRouterApiKey();
  if (key) body.openRouterApiKey = key;
  return body;
}

/**
 * Stream one answer with the website's request shape. Calls `onDelta` with the
 * accumulated text, resolves with the final message and usage/cache metadata.
 */
export async function streamChatV2(
  params: {
    recipeId: string;
    recipeIds: string[];
    includeAllRecipes: boolean;
    chatId: string;
    history: ChatMessage[];
    message: string;
    provider: string;
    model: string;
  },
  onDelta: (accumulated: string, firstDelta: boolean) => void,
  signal?: AbortSignal
): Promise<{ full: string; usage: ChatUsage | null; cache: unknown; error: string | null }> {
  const res = await fetch(`${apiBase()}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', ...authHeaders() },
    body: JSON.stringify({
      recipeId: params.recipeId,
      recipeIds: params.recipeIds,
      includeAllRecipes: params.includeAllRecipes,
      chatId: params.chatId,
      history: params.history,
      message: params.message,
      ...aiSettingsBody(params.provider, params.model)
    }),
    signal
  });
  if (!res.ok || !res.body) {
    let msg = 'Request failed';
    try {
      const j: any = await res.json();
      msg = j?.userMessage || j?.error || msg;
    } catch {
      /* non-JSON */
    }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let done = false;
  let usage: ChatUsage | null = null;
  let cache: unknown = null;
  let error: string | null = null;
  let first = true;
  const handle = (line: string) => {
    const t = line.trim();
    if (!t) return;
    let d: any;
    try {
      d = JSON.parse(t);
    } catch {
      return;
    }
    if (d.ping === true || d.status === 'started') return;
    if (d.error) {
      error = String(d.error);
      return;
    }
    if (typeof d.delta === 'string') {
      full += d.delta;
      onDelta(full, first);
      first = false;
    }
    if (d.cache && typeof d.cache === 'object') cache = d.cache;
    if (d.usage && typeof d.usage === 'object') usage = d.usage;
    if (d.done && typeof d.fullMessage === 'string' && !done) {
      full = d.fullMessage;
      done = true;
      onDelta(full, false);
    }
  };
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    buffer += decoder.decode(r.value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const l of lines) {
      handle(l);
      if (error) break;
    }
    if (error) break;
  }
  if (!error) buffer.split('\n').forEach(handle);
  return { full, usage, cache, error };
}

/** Short AI title for a chat tab (POST /api/ai/chat-title). */
export async function generateChatTitle(messages: ChatMessage[], provider: string, model: string): Promise<string | null> {
  try {
    const res = await fetch(`${apiBase()}/api/ai/chat-title`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders() },
      body: JSON.stringify({ messages, ...aiSettingsBody(provider, model) })
    });
    const data: any = await res.json().catch(() => ({}));
    return res.ok && data?.title ? String(data.title) : null;
  } catch {
    return null;
  }
}

/** POST /api/ai/propose-variant with preview:true (website flow). */
export async function proposeVariantPreview(body: {
  recipeId: string;
  targetRecipeId: string;
  recipeIds: string[];
  variantMessage: string;
  provider: string;
  model: string;
}): Promise<any> {
  const res = await fetch(`${apiBase()}/api/ai/propose-variant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders() },
    body: JSON.stringify({ ...body, preview: true, ...aiSettingsBody(body.provider, body.model) })
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw new Error((data && typeof data.error === 'string' && data.error) || `Variante konnte nicht vorbereitet werden (HTTP ${res.status}).`);
  return data;
}

/** POST /api/ai/propose-edit (website flow): returns the preview token. */
export async function proposeEditPreview(body: {
  recipeId: string;
  recipeIds: string[];
  regions: string[];
  editMessage: string;
  provider: string;
  model: string;
}): Promise<string> {
  const res = await fetch(`${apiBase()}/api/ai/propose-edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders() },
    body: JSON.stringify({ ...body, ...aiSettingsBody(body.provider, body.model) })
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Edit-Vorschlag konnte nicht vorbereitet werden.');
  if (data.preview === true && data.token) return String(data.token);
  throw new Error('Edit-Vorschlag konnte nicht vorbereitet werden.');
}

/**
 * App settings, persisted in localStorage and read at runtime by the API client.
 * The server endpoint is user-configurable (entered in the Settings screen), and
 * the alias/token unlock write capability (no token → read-only).
 */
export const SERVER_URL_KEY = 'kochbuch.server.url';
export const ALIAS_KEY = 'kochbuch.alias';
export const TOKEN_KEY = 'kochbuch.token';
export const AI_PROVIDER_KEY = 'kochbuch.ai.provider';
export const AI_MODEL_KEY = 'kochbuch.ai.model';
export const AI_OPENROUTER_KEY = 'kochbuch.ai.openRouterKey';

export type AiProvider = 'ollama' | 'openrouter';

export interface AppSettings {
  serverUrl: string;
  alias: string;
  token: string;
  aiProvider: AiProvider;
  aiModel: string;
  openRouterApiKey: string;
}

function read(key: string): string {
  try {
    return (localStorage.getItem(key) || '').trim();
  } catch {
    return '';
  }
}

/** Configured server base URL (no trailing slash), or '' to use the build default. */
export function getServerUrl(): string {
  return read(SERVER_URL_KEY).replace(/\/+$/, '');
}
export function getAlias(): string {
  return read(ALIAS_KEY);
}
export function getToken(): string {
  return read(TOKEN_KEY);
}
export function getAiProvider(): AiProvider {
  return read(AI_PROVIDER_KEY) === 'openrouter' ? 'openrouter' : 'ollama';
}
export function getAiModel(): string {
  return read(AI_MODEL_KEY);
}
export function getOpenRouterApiKey(): string {
  return read(AI_OPENROUTER_KEY);
}

export function getSettings(): AppSettings {
  return {
    serverUrl: getServerUrl(),
    alias: getAlias(),
    token: getToken(),
    aiProvider: getAiProvider(),
    aiModel: getAiModel(),
    openRouterApiKey: getOpenRouterApiKey()
  };
}

export function saveSettings(s: AppSettings): void {
  const set = (k: string, v: string) => {
    const t = (v || '').trim();
    if (t) localStorage.setItem(k, t);
    else localStorage.removeItem(k);
  };
  set(SERVER_URL_KEY, s.serverUrl.replace(/\/+$/, ''));
  set(ALIAS_KEY, s.alias);
  set(TOKEN_KEY, s.token);
  set(AI_PROVIDER_KEY, s.aiProvider);
  set(AI_MODEL_KEY, s.aiModel);
  set(AI_OPENROUTER_KEY, s.openRouterApiKey);
}

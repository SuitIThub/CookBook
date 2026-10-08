/**
 * App settings, persisted in localStorage and read at runtime by the API client.
 *
 * Alias, token and AI settings use the SAME keys as the website
 * (`cookbook.alias`, `cookbook.token`, `cookbook.ai.settings`), so the shared
 * core helpers (favorites, ingredient defaults, …) and the per-alias settings
 * sync (lib/aliasSync) work unchanged. Only the server URL is app-specific.
 * Values stored under the app's old `kochbuch.*` keys are migrated once.
 */
export const SERVER_URL_KEY = 'kochbuch.server.url';
export const ALIAS_KEY = 'cookbook.alias';
export const TOKEN_KEY = 'cookbook.token';
export const AI_SETTINGS_KEY = 'cookbook.ai.settings';

import type { AiTaskSettings } from '@core/aiTasks';

export type AiProvider = 'ollama' | 'openrouter';

export type ReelVision = 'none' | 'ocr' | 'openrouter' | 'ollama';

export interface AiSettings {
  provider: AiProvider;
  model: string;
  openRouterApiKey: string;
  /** Reel import: how frames are analysed (website: same key). */
  reelVision?: ReelVision;
  /** Vision model for reelVision openrouter/ollama ('' = server default). */
  reelVisionModel?: string;
  /** Per-task models (structure / vision / matching), see @core/aiTasks. */
  tasks?: AiTaskSettings;
}

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

/** One-time migration from the app's former `kochbuch.*` keys. */
function migrateLegacyKeys(): void {
  try {
    const move = (from: string, to: string) => {
      const v = localStorage.getItem(from);
      if (v != null && localStorage.getItem(to) == null) localStorage.setItem(to, v);
      if (v != null) localStorage.removeItem(from);
    };
    move('kochbuch.alias', ALIAS_KEY);
    move('kochbuch.token', TOKEN_KEY);
    const provider = localStorage.getItem('kochbuch.ai.provider');
    const model = localStorage.getItem('kochbuch.ai.model');
    const key = localStorage.getItem('kochbuch.ai.openRouterKey');
    if ((provider || model || key) && localStorage.getItem(AI_SETTINGS_KEY) == null) {
      localStorage.setItem(
        AI_SETTINGS_KEY,
        JSON.stringify({ provider: provider === 'openrouter' ? 'openrouter' : 'ollama', model: model || '', openRouterApiKey: key || '' })
      );
    }
    ['kochbuch.ai.provider', 'kochbuch.ai.model', 'kochbuch.ai.openRouterKey'].forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage unavailable */
  }
}
migrateLegacyKeys();

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

/** AI settings in the website's format (`cookbook.ai.settings`). */
export function getAiSettings(): AiSettings {
  try {
    const p = JSON.parse(localStorage.getItem(AI_SETTINGS_KEY) || '{}') || {};
    return {
      provider: p.provider === 'openrouter' ? 'openrouter' : 'ollama',
      model: typeof p.model === 'string' ? p.model : '',
      openRouterApiKey: typeof p.openRouterApiKey === 'string' ? p.openRouterApiKey : '',
      reelVision: ['none', 'ocr', 'openrouter', 'ollama'].includes(p.reelVision) ? p.reelVision : 'ocr',
      reelVisionModel: typeof p.reelVisionModel === 'string' ? p.reelVisionModel : '',
      tasks: p.tasks && typeof p.tasks === 'object' ? p.tasks : undefined
    };
  } catch {
    return { provider: 'ollama', model: '', openRouterApiKey: '', reelVision: 'ocr', reelVisionModel: '' };
  }
}
export function saveAiSettings(s: AiSettings): void {
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(s));
}
export function getAiProvider(): AiProvider {
  return getAiSettings().provider;
}
export function getAiModel(): string {
  return getAiSettings().model.trim();
}
export function getOpenRouterApiKey(): string {
  return getAiSettings().openRouterApiKey.trim();
}

export function getSettings(): AppSettings {
  const ai = getAiSettings();
  return {
    serverUrl: getServerUrl(),
    alias: getAlias(),
    token: getToken(),
    aiProvider: ai.provider,
    aiModel: ai.model,
    openRouterApiKey: ai.openRouterApiKey
  };
}

export function saveSettings(s: AppSettings): void {
  const set = (k: string, v: string) => {
    const t = (v || '').trim();
    if (t) localStorage.setItem(k, t);
    else localStorage.removeItem(k);
  };
  set(SERVER_URL_KEY, s.serverUrl.replace(/\/+$/, ''));
  set(TOKEN_KEY, s.token);
  saveAiSettings({ ...getAiSettings(), provider: s.aiProvider, model: s.aiModel.trim(), openRouterApiKey: s.openRouterApiKey.trim() });
  // The alias itself is set via aliasSync.setAlias (joins the alias' settings).
}

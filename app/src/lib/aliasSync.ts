/**
 * Per-alias settings sync — port of the website's engine in
 * AliasSettingsModal.astro. All devices (app and website) using the same alias
 * share: theme, Datenspar-Modus, KI-Einstellungen, recipe layout, favorites,
 * tracker profile, product defaults per ingredient and preferred supermarket.
 *
 * Same keys and server API (/api/alias-settings + /stream) as the website,
 * last-write-wins per key via `cookbook.alias.meta` timestamps. App addition:
 * changes made offline are queued (`cookbook.alias.pending`) and pushed once
 * the server is reachable again.
 */
import { apiBase, apiGet, apiPost } from './api';
import { ALIAS_KEY, getAlias } from './settings';

const META_KEY = 'cookbook.alias.meta';
const PENDING_KEY = 'cookbook.alias.pending';
export const SYNC_KEYS = [
  'theme',
  'lowBandwidth',
  'cookbook.ai.settings',
  'cookbook.recipes.layout',
  'cookbook.recipes.favorites',
  'cookbook.tracker.profile',
  'cookbook.ingredient.defaults',
  'cookbook.preferredSupermarket'
];

interface RemoteSetting {
  key: string;
  value: string | null;
  updatedAt: number;
}

const origSetItem = Storage.prototype.setItem;
const origRemoveItem = Storage.prototype.removeItem;
const rawSet = (k: string, v: string) => {
  try {
    origSetItem.call(localStorage, k, v);
  } catch {
    /* ignore */
  }
};
const rawRemove = (k: string) => {
  try {
    origRemoveItem.call(localStorage, k);
  } catch {
    /* ignore */
  }
};
const rawGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

let applyingRemote = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let es: EventSource | null = null;
let installed = false;
const listeners = new Set<() => void>();

function getMeta(): Record<string, number> {
  try {
    return JSON.parse(rawGet(META_KEY) || '{}') || {};
  } catch {
    return {};
  }
}
function saveMeta(m: Record<string, number>) {
  rawSet(META_KEY, JSON.stringify(m));
}
function getPending(): string[] {
  try {
    const p = JSON.parse(rawGet(PENDING_KEY) || '[]');
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}
function savePending(keys: string[]) {
  if (keys.length) rawSet(PENDING_KEY, JSON.stringify([...new Set(keys)]));
  else rawRemove(PENDING_KEY);
}

function onLocalChange(key: string) {
  const meta = getMeta();
  meta[key] = Date.now();
  saveMeta(meta);
  if (!getAlias()) return;
  savePending([...getPending(), key]);
  schedulePush();
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void flushPending();
  }, 400);
}

async function pushSettings(settings: RemoteSetting[]): Promise<boolean> {
  const alias = getAlias();
  if (!alias || !settings.length) return true;
  try {
    await apiPost('/api/alias-settings', { alias, settings });
    return true;
  } catch {
    return false;
  }
}

/** Push queued local changes (no-op when offline; they stay queued). */
export async function flushPending(): Promise<void> {
  const keys = getPending();
  if (!getAlias() || keys.length === 0) return;
  const meta = getMeta();
  const settings = keys.map((key) => ({ key, value: rawGet(key), updatedAt: meta[key] || Date.now() }));
  if (await pushSettings(settings)) {
    // Keep keys changed while the request was in flight.
    const now = getPending().filter((k) => !keys.includes(k) || (getMeta()[k] || 0) > (meta[k] || 0));
    savePending(now);
  }
}

/** Visible side effects of a remotely changed setting. */
function applyKeyEffect(key: string, value: string | null) {
  if (key === 'theme') {
    document.documentElement.classList.toggle('dark', value === 'dark');
  } else if (key === 'lowBandwidth') {
    document.documentElement.classList.toggle('low-bandwidth', value === '1');
    document.dispatchEvent(new CustomEvent('cookbook:low-bandwidth-changed'));
  } else if (key === 'cookbook.ai.settings') {
    let detail = null;
    try {
      detail = value ? JSON.parse(value) : null;
    } catch {
      /* ignore */
    }
    document.dispatchEvent(new CustomEvent('ai-settings-updated', { detail }));
  } else if (key === 'cookbook.recipes.layout') {
    document.dispatchEvent(new CustomEvent('cookbook:recipe-layout-changed'));
  } else if (key === 'cookbook.recipes.favorites') {
    document.dispatchEvent(new CustomEvent('cookbook:favorites-changed'));
  } else if (key === 'cookbook.ingredient.defaults' || key === 'cookbook.preferredSupermarket') {
    document.dispatchEvent(new CustomEvent('cookbook:ingredient-defaults-changed'));
  }
}

function applyRemote(settings: RemoteSetting[]) {
  if (!Array.isArray(settings)) return;
  const meta = getMeta();
  let changed = false;
  for (const item of settings) {
    if (!item || !SYNC_KEYS.includes(item.key)) continue;
    const incomingTs = Number(item.updatedAt) || 0;
    if (incomingTs <= (meta[item.key] || 0)) continue;
    applyingRemote = true;
    if (item.value === null || item.value === undefined) rawRemove(item.key);
    else rawSet(item.key, String(item.value));
    applyingRemote = false;
    meta[item.key] = incomingTs;
    changed = true;
    applyKeyEffect(item.key, item.value == null ? null : String(item.value));
  }
  if (changed) {
    saveMeta(meta);
    listeners.forEach((l) => l());
  }
}

/** Fetch this alias' settings from the server and apply newer ones. */
export async function pullAliasSettings(): Promise<void> {
  const alias = getAlias();
  if (!alias) return;
  try {
    const data = await apiGet<{ settings?: RemoteSetting[] }>(`/api/alias-settings?alias=${encodeURIComponent(alias)}`);
    if (data?.settings) applyRemote(data.settings);
  } catch {
    /* offline */
  }
}

function connect() {
  disconnect();
  const alias = getAlias();
  if (!alias || typeof EventSource === 'undefined') return;
  try {
    es = new EventSource(`${apiBase()}/api/alias-settings/stream?alias=${encodeURIComponent(alias)}`);
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg?.type === 'update' && msg.setting) applyRemote([msg.setting]);
      } catch {
        /* ignore */
      }
    };
  } catch {
    es = null;
  }
}
function disconnect() {
  if (es) {
    try {
      es.close();
    } catch {
      /* ignore */
    }
    es = null;
  }
}

/** Join/switch/leave an alias (website semantics: share this device's settings first, then pull). */
export async function setAlias(newAlias: string): Promise<void> {
  const next = (newAlias || '').trim().slice(0, 128);
  const prev = getAlias();
  if (!next) {
    rawRemove(ALIAS_KEY);
    disconnect();
    listeners.forEach((l) => l());
    return;
  }
  rawSet(ALIAS_KEY, next);
  if (next !== prev) {
    const meta = getMeta();
    const now = Date.now();
    const settings: RemoteSetting[] = [];
    for (const key of SYNC_KEYS) {
      const v = rawGet(key);
      if (v !== null) {
        meta[key] = now;
        settings.push({ key, value: v, updatedAt: now });
      }
    }
    saveMeta(meta);
    if (!(await pushSettings(settings))) savePending(settings.map((s) => s.key));
  }
  connect();
  await pullAliasSettings();
  listeners.forEach((l) => l());
  // The new profile's tracker rows (weight, diary, meal plans) come via the data sync.
  if (next !== prev) void import('./syncRunner').then((m) => m.runSync()).catch(() => {});
}

export function onAliasSettingsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Install once at startup: intercept writes to synced keys, connect, pull. */
export function installAliasSync(): void {
  if (installed) return;
  installed = true;
  localStorage.setItem = function (k: string, v: string) {
    origSetItem.call(this, k, v);
    if (!applyingRemote && SYNC_KEYS.includes(k)) onLocalChange(k);
  };
  localStorage.removeItem = function (k: string) {
    origRemoveItem.call(this, k);
    if (!applyingRemote && SYNC_KEYS.includes(k)) onLocalChange(k);
  };
  const resume = () => {
    void flushPending().then(pullAliasSettings);
    if (!es && getAlias()) connect();
  };
  window.addEventListener('online', resume);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && resume());
  if (getAlias()) {
    connect();
    resume();
  }
}

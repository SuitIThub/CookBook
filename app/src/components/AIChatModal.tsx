/**
 * KI-Chat — port of components/modals/RecipeAIChatModal.astro: chat tabs per
 * recipe (local, 30-day retention, AI-generated titles), provider/model choice
 * locked once a chat has history, cache/usage strip, referenced recipes with a
 * picker (or "Alle Rezepte" from the overview), Markdown answers with
 * collapsible thinking, regenerate, abort, live timer, and the assistant's
 * tool buttons (recipe cards, Zur Einkaufsliste, Änderungen prüfen, Variante).
 * Needs the server (the AI runs there); history stays on the device.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { marked } from 'marked';
import type { Recipe } from '@/types';
import { apiGet, assetUrl } from '@/lib/api';
import { getAiSettings } from '@/lib/settings';
import { localRecipes } from '@/lib/localData';
import { runSync } from '@/lib/syncRunner';
import {
  streamChatV2,
  generateChatTitle,
  proposeVariantPreview,
  proposeEditPreview,
  type ChatMessage,
  type ChatUsage
} from '@/lib/aiChat';
import AddToShoppingListModal from '@/components/AddToShoppingListModal';

export interface ReferencedRecipe {
  id: string;
  title: string;
  imageUrl?: string;
}

const ALL = '__all_recipes__';
const VARIANT_RE = /\[RECIPE_VARIANT(?::([a-zA-Z0-9-_]+))?\]/g;
const REF_RE = /\[RECIPE_REF:([a-zA-Z0-9-_]+)\]/g;
const SHOP_RE = /\[SHOPPING_LIST_RECIPES:([a-zA-Z0-9\-_,@:\s]+)\]/g;
const EDIT_RE = /\[RECIPE_EDIT:([a-zA-Z0-9-_]+)(?:\|regions=([a-zA-Z0-9._,\s-]+))?\]/g;
const ALL_PREF_KEY = 'cookbook.ai.loadAllRecipesContext';
const MODEL_MEMORY_KEY = 'cookbook.ai.chat.modelMemory';
const TABS_PREFIX = 'cookbook.ai.chat.tabs.v1';
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

interface Tab {
  id: string;
  title: string;
  aiTitleGenerated: boolean;
  messages: ChatMessage[];
  provider: 'ollama' | 'openrouter';
  model: string;
  createdAt: string;
  updatedAt: string;
  lastViewedAt: string;
}
interface ModelMeta {
  cacheSupported: boolean;
  cacheMode: string;
  cacheNote: string;
  promptPrice: number | null;
  completionPrice: number | null;
}

/* ------------------------------------------------------------- helpers */

const nowIso = () => new Date().toISOString();
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const normalize = (input: unknown): ChatMessage[] =>
  Array.isArray(input)
    ? (input
        .map((m: any) => (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' ? { role: m.role, content: m.content } : null))
        .filter(Boolean) as ChatMessage[])
    : [];
const deriveTitle = (msgs: ChatMessage[]) => {
  const u = msgs.find((m) => m.role === 'user' && m.content.trim());
  if (!u) return 'Neuer Chat';
  const t = u.content.trim().replace(/\s+/g, ' ');
  return t.length > 34 ? `${t.slice(0, 34)}...` : t;
};
const formatElapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const fmtTokens = (n?: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n).toLocaleString('de-DE') : null);
const fmtUsd = (a: number | null) => (a == null || !Number.isFinite(a) ? null : a === 0 ? '$0.00' : a < 0.01 ? `$${a.toFixed(4)}` : `$${a.toFixed(3)}`);
const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const getAllPref = () => {
  try {
    const raw = localStorage.getItem(ALL_PREF_KEY);
    return raw === null ? true : raw === '1' || raw === 'true';
  } catch {
    return true;
  }
};

const stripVariantKeyword = (t: string) =>
  t
    .replace(/^\s*\[RECIPE_VARIANT(?::[a-zA-Z0-9-_]+)?\]\s*\n?/gim, '')
    .replace(/^\s*\*\*\[?RECIPE_VARIANT(?::[a-zA-Z0-9-_]+)?\]?\*\*\s*\n?/gim, '')
    .trim();
const stripTools = (t: string) => (t || '').replace(VARIANT_RE, '').replace(REF_RE, '').replace(SHOP_RE, '').replace(EDIT_RE, '').trim();
const variantPayload = (t: string) => {
  const m = new RegExp(VARIANT_RE).exec(t || '');
  return m ? { has: true, recipeId: m[1] || '' } : { has: false, recipeId: '' };
};
const refIds = (t: string) => Array.from(new Set(Array.from((t || '').matchAll(REF_RE)).map((m) => m[1]).filter(Boolean)));
const shoppingSelection = (t: string) => {
  const ids: string[] = [];
  const servings: Record<string, number> = {};
  for (const m of (t || '').matchAll(SHOP_RE)) {
    (m[1] || '')
      .split(',')
      .map((v) => v.trim().replace(/\s+/g, ''))
      .filter(Boolean)
      .forEach((entry) => {
        const [id, sv] = entry.split('@');
        if (!id) return;
        ids.push(id);
        const n = Number.parseInt(sv || '', 10);
        if (Number.isFinite(n) && n > 0) servings[id] = n;
      });
  }
  return { recipeIds: Array.from(new Set(ids)), servings };
};
const editPayload = (t: string) => {
  const m = new RegExp(EDIT_RE).exec(t || '');
  if (!m?.[1]) return { id: '', regions: [] as string[] };
  return { id: m[1], regions: (m[2] || '').split(',').map((r) => r.trim()).filter(Boolean) };
};
const splitThinking = (text: string) => {
  const parts: string[] = [];
  const visible = (text || '')
    .replace(/<think>([\s\S]*?)<\/think>/gi, (_m, inner) => {
      if ((inner || '').trim()) parts.push(inner.trim());
      return '';
    })
    .replace(/<thinking>([\s\S]*?)<\/thinking>/gi, (_m, inner) => {
      if ((inner || '').trim()) parts.push(inner.trim());
      return '';
    })
    .trim();
  return { visible, thinking: parts.join('\n\n').trim() };
};
const md = (text: string) => {
  const html = marked.parse(text || '', { breaks: true, async: false }) as string;
  return html.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
};
const normForMatch = (v: string) =>
  String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const BOOK = 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253';

/* ---------------------------------------------------------------- modal */

export default function AIChatModal({ referencedRecipes, onClose }: { referencedRecipes: ReferencedRecipe[]; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [refs, setRefs] = useState<ReferencedRecipe[]>(referencedRecipes);
  const primaryId = refs.length > 0 ? refs[0].id : referencedRecipes[0]?.id ?? '';
  const tabsKey = `${TABS_PREFIX}:${referencedRecipes[0]?.id ?? ''}`;
  const [allPref, setAllPref] = useState(getAllPref);
  const overviewMode = referencedRecipes[0]?.id === ALL || refs.some((r) => r.id === ALL);
  const includeAll = overviewMode && allPref;

  // ---- tabs
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const now = Date.now();
    const settings = getAiSettings();
    const loaded = readJson<any[]>(tabsKey, [])
      .filter((t) => t && typeof t.id === 'string')
      .map<Tab>((t) => ({
        id: t.id,
        title: typeof t.title === 'string' && t.title.trim() ? t.title.trim() : 'Neuer Chat',
        aiTitleGenerated: t.aiTitleGenerated === true,
        messages: normalize(t.messages),
        provider: t.provider === 'openrouter' ? 'openrouter' : 'ollama',
        model: typeof t.model === 'string' ? t.model : '',
        createdAt: t.createdAt || nowIso(),
        updatedAt: t.updatedAt || nowIso(),
        lastViewedAt: t.lastViewedAt || nowIso()
      }))
      .filter((t) => {
        const ts = Date.parse(t.lastViewedAt);
        return Number.isFinite(ts) ? now - ts <= RETENTION_MS : true;
      });
    return loaded.length ? loaded : [makeTab(settings.provider, settings.model)];
  });
  const [activeId, setActiveId] = useState(() => tabs[0].id);
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const messages = active.messages;
  const locked = active.messages.length > 0;
  useEffect(() => {
    try {
      localStorage.setItem(tabsKey, JSON.stringify(tabs));
    } catch {
      /* ignore */
    }
  }, [tabs, tabsKey]);
  const updateTab = (id: string, patch: Partial<Tab>) => setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  // ---- models
  const [models, setModels] = useState<string[] | null>(null);
  const [meta, setMeta] = useState<Map<string, ModelMeta>>(new Map());
  const [modelStatus, setModelStatus] = useState('');
  const loadModels = async (provider: string, preferred: string): Promise<string> => {
    setModels(null);
    setModelStatus('');
    try {
      const key = getAiSettings().openRouterApiKey;
      const headers: Record<string, string> = {};
      if (provider === 'openrouter' && key) headers['x-openrouter-api-key'] = key;
      const data = await apiGet<any>(`/api/ai/models?provider=${encodeURIComponent(provider)}`, { headers, timeoutMs: 30000 });
      const list: string[] = Array.isArray(data.models) ? data.models : [];
      const m = new Map<string, ModelMeta>();
      (Array.isArray(data.modelDetails) ? data.modelDetails : []).forEach((d: any) => {
        if (!d || typeof d.id !== 'string') return;
        m.set(d.id, {
          cacheSupported: d.cacheSupported === true,
          cacheMode: typeof d.cacheMode === 'string' ? d.cacheMode : 'unknown',
          cacheNote: typeof d.cacheNote === 'string' ? d.cacheNote : '',
          promptPrice: typeof d.promptPrice === 'number' ? d.promptPrice : null,
          completionPrice: typeof d.completionPrice === 'number' ? d.completionPrice : null
        });
      });
      setMeta(m);
      setModels(list);
      if (list.length === 0) {
        setModelStatus('Keine Modelle verfügbar.');
        return '';
      }
      setModelStatus(provider === 'openrouter' && data.openRouterAccess?.freeOnly ? `${list.length} kostenlose OpenRouter-Modelle verfügbar.` : `${list.length} Modelle verfügbar.`);
      return preferred && list.includes(preferred) ? preferred : list[0];
    } catch (e) {
      setModels([]);
      setModelStatus(e instanceof Error ? e.message : 'Fehler beim Laden');
      return '';
    }
  };
  // Sync the header chooser with the active tab.
  useEffect(() => {
    const settings = getAiSettings();
    const provider = active.provider || settings.provider;
    void loadModels(provider, active.model || settings.model).then((m) => updateTab(active.id, { provider, model: m || '' }));
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = () => {
      const s = getAiSettings();
      void loadModels(active.provider || s.provider, active.model || s.model);
    };
    document.addEventListener('ai-settings-updated', h);
    return () => document.removeEventListener('ai-settings-updated', h);
  });
  const metaOf = (id: string): ModelMeta => meta.get(id) ?? { cacheSupported: false, cacheMode: 'unknown', cacheNote: 'Keine Cache-Infos verfügbar.', promptPrice: null, completionPrice: null };

  // ---- status
  const [cacheImpact, setCacheImpact] = useState('');
  const [usage, setUsage] = useState<ChatUsage | null>(null);
  const [generating, setGenerating] = useState(false);
  const [liveLabel, setLiveLabel] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startRef = useRef(0);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [picker, setPicker] = useState(false);
  const [shopping, setShopping] = useState<{ ids: string[]; servings: Record<string, number> } | null>(null);
  const [busyButton, setBusyButton] = useState<string | null>(null);
  const titleInFlight = useRef(new Set<string>());

  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => setElapsed(Date.now() - startRef.current), 250);
    return () => clearInterval(t);
  }, [generating]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, streamText, pendingUser]);
  useEffect(() => {
    document.body.classList.add('overflow-hidden');
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    setTimeout(() => inputRef.current?.focus(), 100);
    return () => {
      document.body.classList.remove('overflow-hidden');
      document.removeEventListener('keydown', esc);
      abortRef.current?.abort();
    };
  }, [onClose]);

  // Local recipes for titles/images/cards (offline).
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  useEffect(() => {
    localRecipes().then(setRecipes, () => {});
  }, []);
  const recipeById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const titleOf = (id: string) => recipeById.get(id)?.title || refs.find((r) => r.id === id)?.title || '';
  const imageOf = (r?: Recipe) => assetUrl(r?.images?.[0]?.url || r?.imageUrl || undefined);

  const costOf = (u: ChatUsage | null) => {
    if (!u) return null;
    if (typeof u.costUsd === 'number' && Number.isFinite(u.costUsd)) return u.costUsd;
    const m = metaOf(active.model);
    if (m.promptPrice == null && m.completionPrice == null) return null;
    const c = (u.promptTokens || 0) * (m.promptPrice || 0) + (u.completionTokens || 0) * (m.completionPrice || 0);
    return Number.isFinite(c) ? c : null;
  };
  const usageText = (() => {
    if (!usage || active.provider !== 'openrouter') return '';
    const parts: string[] = [];
    const p = fmtTokens(usage.promptTokens);
    const c = fmtTokens(usage.completionTokens);
    const tot = fmtTokens(usage.totalTokens);
    if (p || c) parts.push(`Tokens ${p || '–'}→${c || '–'}`);
    else if (tot) parts.push(`Tokens ${tot}`);
    if (typeof usage.cachedTokens === 'number' && usage.cachedTokens > 0) parts.push(`Cache ${fmtTokens(usage.cachedTokens)}`);
    const cost = fmtUsd(costOf(usage));
    if (cost) parts.push(cost + (typeof usage.costUsd !== 'number' ? ' approx.' : ''));
    return parts.join(' · ');
  })();
  const cacheHint = (() => {
    const m = metaOf(active.model);
    const lockSuffix = locked ? ' · Modellwechsel gesperrt' : '';
    if (m.cacheSupported) return `${m.cacheMode === 'explicit' ? 'Cache explizit' : 'Cache auto'}${lockSuffix}`;
    if (m.cacheMode === 'none') return `Kein Cache${lockSuffix}`;
    return active.model ? `Cache unklar${lockSuffix}` : '';
  })();

  // ---- tab actions
  const createTab = () => {
    const t = makeTab(active.provider, active.model);
    setTabs((ts) => [t, ...ts]);
    setActiveId(t.id);
    setCacheImpact('Neuer Chat gestartet: Cache wird neu aufgebaut.');
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const removeTab = (id: string) => {
    if (tabs.length <= 1) return;
    const rest = tabs.filter((t) => t.id !== id);
    setTabs(rest);
    if (id === activeId) setActiveId(rest[0].id);
  };
  const deleteChat = () => {
    if (!confirm('Chat-Verlauf wirklich löschen? Dies kann nicht rückgängig gemacht werden.')) return;
    updateTab(active.id, { messages: [], title: 'Neuer Chat', aiTitleGenerated: false, updatedAt: nowIso() });
    setCacheImpact('Chat gelöscht: Cache wird für diesen Tab neu aufgebaut.');
  };

  const maybeTitle = async (tab: Tab) => {
    if (titleInFlight.current.has(tab.id) || tab.aiTitleGenerated) return;
    const heuristic = deriveTitle(tab.messages);
    if (tab.title && tab.title !== 'Neuer Chat' && tab.title !== heuristic) return;
    if (!tab.messages.some((m) => m.role === 'user' && m.content.trim())) return;
    titleInFlight.current.add(tab.id);
    try {
      const title = await generateChatTitle(tab.messages.slice(-8), tab.provider, tab.model);
      if (title) setTabs((ts) => ts.map((t) => (t.id === tab.id && !t.aiTitleGenerated ? { ...t, title: title.trim().slice(0, 48) || t.title, aiTitleGenerated: true, updatedAt: nowIso() } : t)));
    } finally {
      titleInFlight.current.delete(tab.id);
    }
  };

  const commit = (tab: Tab, msgs: ChatMessage[]) => {
    const next: Tab = {
      ...tab,
      messages: msgs,
      title: !tab.title || tab.title === 'Neuer Chat' ? deriveTitle(msgs) : tab.title,
      updatedAt: nowIso(),
      lastViewedAt: nowIso()
    };
    setTabs((ts) => ts.map((t) => (t.id === tab.id ? next : t)));
    void maybeTitle(next);
  };

  // ---- send
  const send = async (opts: { text?: string; history?: ChatMessage[]; regenerate?: boolean } = {}) => {
    const text = (opts.text ?? input).trim();
    if (!text || generating) return;
    const tab = active;
    const base = opts.history ?? tab.messages;
    if (opts.regenerate) updateTab(tab.id, { messages: base });
    if (!opts.text) setInput('');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    startRef.current = Date.now();
    setElapsed(0);
    setGenerating(true);
    setLiveLabel(opts.regenerate ? 'Antwort wird neu generiert…' : 'Antwort wird generiert…');
    setUsage(null);
    setPendingUser(text);
    setStreamText('');
    const recipeIds = includeAll ? [ALL] : refs.map((r) => r.id).filter((id) => id && id !== ALL);
    let finalText = '';
    try {
      const r = await streamChatV2(
        { recipeId: primaryId, recipeIds, includeAllRecipes: includeAll, chatId: tab.id, history: base, message: text, provider: tab.provider, model: tab.model },
        (acc, first) => {
          if (first) setLiveLabel('Antwort wird geschrieben…');
          setStreamText(acc);
        },
        ctrl.signal
      );
      finalText = r.error ? 'Fehler: ' + r.error : r.full || 'Keine Antwort erhalten.';
      setUsage(r.usage);
      const el = formatElapsed(Date.now() - startRef.current);
      if (r.usage && (r.usage.promptTokens != null || r.usage.completionTokens != null || r.usage.costUsd != null)) {
        const cost = fmtUsd(costOf(r.usage));
        const cacheBit = typeof r.usage.cachedTokens === 'number' && r.usage.cachedTokens > 0 ? ` · Cache ${fmtTokens(r.usage.cachedTokens)}` : '';
        setCacheImpact(`Fertig in ${el}` + (cost ? ` · ${cost}${typeof r.usage.costUsd !== 'number' ? ' approx.' : ''}` : '') + cacheBit);
      } else setCacheImpact(opts.regenerate ? `Neu generiert in ${el}.` : `Fertig in ${el}.`);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        finalText = streamTextRef.current || 'Generierung abgebrochen.';
        setCacheImpact(`Abgebrochen nach ${formatElapsed(Date.now() - startRef.current)}.`);
      } else {
        const raw = e instanceof Error ? e.message : '';
        finalText = /failed to fetch|networkerror|load failed|fetch/i.test(raw) || e instanceof TypeError
          ? 'Verbindung abgebrochen (häufig über Tailscale/VPN bei langen KI-Antworten). Bitte erneut versuchen.'
          : raw || 'Netzwerkfehler. Bitte erneut versuchen.';
        setCacheImpact('');
      }
    } finally {
      commit(tab, [...base, { role: 'user', content: text }, { role: 'assistant', content: finalText }]);
      setStreamText(null);
      setPendingUser(null);
      setGenerating(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  };
  const streamTextRef = useRef<string | null>(null);
  streamTextRef.current = streamText;

  const regenerate = (index: number) => {
    let userIdx = -1;
    for (let i = index - 1; i >= 0; i--) if (messages[i]?.role === 'user') {
      userIdx = i;
      break;
    }
    if (userIdx < 0) return;
    setCacheImpact('Antwort wird neu generiert – Verlauf ab hier wird ersetzt.');
    void send({ text: messages[userIdx].content, history: messages.slice(0, userIdx), regenerate: true });
  };

  // ---- tool actions
  const recipeIdsForTools = () => (refs.length > 0 ? refs.map((r) => r.id) : [primaryId]);
  const createVariant = async (index: number, targetRecipeId: string) => {
    const variantMessage = stripVariantKeyword(messages[index]?.content || '');
    if (!variantMessage.trim()) return;
    setBusyButton(`variant-${index}`);
    try {
      const data = await proposeVariantPreview({ recipeId: primaryId, targetRecipeId, recipeIds: recipeIdsForTools(), variantMessage, provider: active.provider, model: active.model });
      if (data?.preview === true && data.mode === 'variant' && data.token && data.parentRecipeId) {
        onClose();
        navigate(`/rezept/${data.parentRecipeId}/variante-neu?draft=${encodeURIComponent(data.token)}`);
        return;
      }
      const createdId = data?.preview === true && data.mode === 'new_recipe' ? data.recipeId : data?.id;
      if (createdId) {
        // Created on the server → pull it into the replica first.
        await runSync().catch(() => {});
        queryClient.invalidateQueries();
        onClose();
        navigate(data?.mode === 'new_recipe' ? `/rezept/${createdId}/bearbeiten` : `/rezept/${createdId}`);
        return;
      }
      alert('Unerwartete Antwort vom Server. Bitte Seite neu laden und prüfen, ob das Rezept trotzdem angelegt wurde.');
    } catch (e) {
      alert((e as Error).message || 'Fehler beim Erstellen der Variante.');
    } finally {
      setBusyButton(null);
    }
  };
  const proposeEdit = async (index: number, recipeId: string, regions: string[]) => {
    setBusyButton(`edit-${index}`);
    try {
      const token = await proposeEditPreview({ recipeId, recipeIds: recipeIdsForTools(), regions, editMessage: stripTools(messages[index]?.content || ''), provider: active.provider, model: active.model });
      onClose();
      navigate(`/rezept/${recipeId}/bearbeiten?aiDraft=1&aiEditToken=${encodeURIComponent(token)}`);
    } catch (e) {
      alert((e as Error).message || 'Fehler beim Vorbereiten der Änderungen.');
    } finally {
      setBusyButton(null);
    }
  };

  // ---- rendering helpers
  const chatTitle = refs.length === 0 ? `KI-Chat: ${referencedRecipes[0]?.title || 'Rezept'}` : refs.length === 1 ? `KI-Chat: ${refs[0].title}` : 'KI-Chat: Mehrere Rezepte';

  const AssistantBody = ({ content, streaming = false }: { content: string; streaming?: boolean }) => {
    const v = variantPayload(content);
    const cleaned = stripTools(v.has ? stripVariantKeyword(content) : content);
    const { visible, thinking } = splitThinking(cleaned);
    return (
      <>
        <div className="ai-msg-bubble prose prose-sm max-w-[85%] rounded-2xl rounded-bl-md border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm dark:prose-invert dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
          {streaming && !visible ? (
            <span className="recipe-ai-waiting-dots" aria-label="Warte auf Antwort"><span /><span /><span /></span>
          ) : (
            <div dangerouslySetInnerHTML={{ __html: md(visible) }} />
          )}
        </div>
        {thinking && (
          <details className="mt-1 max-w-[85%] text-xs text-gray-600 dark:text-gray-300">
            <summary className="cursor-pointer select-none text-[11px] text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">Thinking anzeigen</summary>
            <div className="prose-xs prose mt-1 max-w-none rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 dark:prose-invert dark:border-gray-600 dark:bg-gray-700" dangerouslySetInnerHTML={{ __html: md(thinking) }} />
          </details>
        )}
      </>
    );
  };

  const ToolUi = ({ content, index }: { content: string; index: number }) => {
    const ids = refIds(content);
    const shop = shoppingSelection(content);
    const edit = editPayload(content);
    const v = variantPayload(content);
    let cards: Recipe[] = ids.map((id) => recipeById.get(id)).filter((r): r is Recipe => !!r);
    const unresolved = ids.filter((id) => !recipeById.has(id));
    if (ids.length === 0 && overviewMode) {
      const nt = normForMatch(content);
      cards = recipes
        .map((r) => ({ r, n: normForMatch(r.title) }))
        .filter((x) => x.n.length >= 5 && nt.includes(x.n))
        .sort((a, b) => b.n.length - a.n.length)
        .slice(0, 4)
        .map((x) => x.r);
    }
    const btn = 'inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/25 dark:text-indigo-300 dark:hover:bg-indigo-900/40';
    return (
      <>
        {v.has && (
          <button type="button" disabled={busyButton === `variant-${index}`} onClick={() => createVariant(index, v.recipeId)} className={btn + ' mt-1 px-2 py-1 text-[11px]'}>
            {busyButton === `variant-${index}` ? (
              'Wird vorbereitet…'
            ) : v.recipeId ? (
              <>
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h9v9H4zM9 9h9v9H9z" /></svg> Variante für "{titleOf(v.recipeId) || `ID ${v.recipeId}`}" erstellen
              </>
            ) : (
              <>
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg> Neues Rezept erstellen
              </>
            )}
          </button>
        )}
        <button type="button" onClick={() => regenerate(index)} title="Diese Antwort neu generieren" className="mt-1.5 inline-flex items-center gap-1.5 self-start rounded-full border border-indigo-200/80 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          <span>Neu generieren</span>
        </button>
        {cards.length > 0 && (
          <div className="mt-2 grid w-full max-w-[85%] gap-2">
            {cards.map((r) => (
              <Link key={r.id} to={`/rezept/${r.id}`} onClick={onClose} className="flex items-center gap-3 rounded-lg border border-indigo-200 bg-white px-3 py-2 transition-colors hover:bg-indigo-50 dark:border-indigo-800 dark:bg-gray-800 dark:hover:bg-indigo-900/20" style={{ maxWidth: 360, minHeight: 64 }}>
                {imageOf(r) ? (
                  <img src={imageOf(r)} alt={r.title} className="flex-shrink-0 rounded object-cover" style={{ width: 56, height: 56 }} />
                ) : (
                  <div className="flex flex-shrink-0 items-center justify-center rounded bg-gray-200 text-xs font-semibold text-gray-500 dark:bg-gray-700 dark:text-gray-300" style={{ width: 56, height: 56 }}>REZEPT</div>
                )}
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100" style={{ lineHeight: 1.2 }}>{r.title}</span>
              </Link>
            ))}
          </div>
        )}
        {unresolved.length > 0 && (
          <div className="mt-2 max-w-[85%] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            Einige Rezept-Referenzen konnten nicht aufgelöst werden: {unresolved.join(', ')}
          </div>
        )}
        {shop.recipeIds.length > 0 && (
          <button type="button" onClick={() => setShopping({ ids: shop.recipeIds, servings: shop.servings })} className={btn + ' mt-2 px-2 py-1 text-[11px]'}>
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg> Zur Einkaufsliste hinzufügen
          </button>
        )}
        {edit.id && (
          <button type="button" disabled={busyButton === `edit-${index}`} onClick={() => proposeEdit(index, edit.id, edit.regions)} className={btn + ' mt-2 px-2.5 py-1.5 text-xs leading-none'}>
            {busyButton === `edit-${index}` ? (
              'Wird vorbereitet...'
            ) : (
              <>
                <svg style={{ width: 14, height: 14, flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg> Änderungen in "{titleOf(edit.id) || `ID ${edit.id}`}" prüfen
              </>
            )}
          </button>
        )}
      </>
    );
  };

  const shownMessages = streamText !== null && pendingUser !== null ? messages : messages;

  return (
    <div className="fixed inset-0 flex items-stretch justify-center p-0 md:items-center md:p-4" style={{ zIndex: 1000 }} aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="recipe-ai-chat-panel relative z-[1] flex h-[100dvh] w-screen flex-col border-0 border-gray-200 bg-white shadow-2xl md:h-[80vh] md:w-full md:max-w-2xl md:rounded-xl md:border dark:border-gray-700 dark:bg-gray-800">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
              </span>
              <span className="truncate">{chatTitle}</span>
            </h2>
            <div className="flex flex-shrink-0 items-center gap-2">
              <button type="button" onClick={deleteChat} title="Chat-Verlauf löschen" className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-gray-400 dark:hover:bg-red-900/20 dark:hover:text-red-400">
                Chat löschen
              </button>
              <button type="button" onClick={onClose} aria-label="Schließen" className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-300">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Provider</label>
              <select
                value={active.provider}
                disabled={locked}
                onChange={async (e) => {
                  if (locked) return setCacheImpact('Modellwechsel gesperrt: Dieser Chat hat bereits Verlauf und behält sein Modell für stabile Cache-Hits.');
                  const settings = getAiSettings();
                  const provider = e.target.value === 'openrouter' ? 'openrouter' : 'ollama';
                  const memory = readJson<Record<string, string>>(MODEL_MEMORY_KEY, {});
                  const model = await loadModels(provider, provider === settings.provider ? settings.model : memory[provider] || '');
                  updateTab(active.id, { provider, model });
                  if (provider !== settings.provider && model) localStorage.setItem(MODEL_MEMORY_KEY, JSON.stringify({ ...memory, [provider]: model }));
                  setCacheImpact('Modell geändert: Der nächste Prompt startet einen neuen Cache-Pfad.');
                }}
                className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              >
                <option value="ollama">Ollama</option>
                <option value="openrouter">OpenRouter</option>
              </select>
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Modell</label>
              <select
                value={active.model}
                disabled={locked || !models || models.length === 0}
                onChange={(e) => {
                  if (locked) return;
                  const settings = getAiSettings();
                  updateTab(active.id, { model: e.target.value });
                  if (active.provider !== settings.provider && e.target.value) {
                    const memory = readJson<Record<string, string>>(MODEL_MEMORY_KEY, {});
                    localStorage.setItem(MODEL_MEMORY_KEY, JSON.stringify({ ...memory, [active.provider]: e.target.value }));
                  }
                  setCacheImpact('Modell geändert: Der nächste Prompt startet einen neuen Cache-Pfad.');
                }}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              >
                {!models ? (
                  <option value="">Lade Modelle...</option>
                ) : models.length === 0 ? (
                  <option value="">{modelStatus === 'Keine Modelle verfügbar.' ? 'Keine Modelle gefunden' : 'Fehler beim Laden'}</option>
                ) : (
                  models.map((m) => {
                    const mm = metaOf(m);
                    return (
                      <option key={m} value={m}>
                        {m}
                        {mm.cacheSupported ? (mm.cacheMode === 'explicit' ? ' [Cache*]' : ' [Cache]') : ''}
                      </option>
                    );
                  })
                )}
              </select>
              <button
                type="button"
                disabled={locked}
                onClick={async () => {
                  const m = await loadModels(active.provider, active.model);
                  if (!locked) updateTab(active.id, { model: m });
                }}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Neu laden
              </button>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{modelStatus}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            {cacheHint && <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" title={metaOf(active.model).cacheNote}>{cacheHint}</span>}
            {usageText && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700 dark:bg-emerald-900/25 dark:text-emerald-300">{usageText}</span>}
            {cacheImpact && <span className="text-amber-600 dark:text-amber-300">{cacheImpact}</span>}
          </div>
          {overviewMode && (
            <div className="mt-2">
              <label className="inline-flex cursor-pointer select-none items-start gap-2 text-xs text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={allPref}
                  onChange={(e) => {
                    setAllPref(e.target.checked);
                    try {
                      localStorage.setItem(ALL_PREF_KEY, e.target.checked ? '1' : '0');
                    } catch {
                      /* ignore */
                    }
                    setCacheImpact(e.target.checked ? 'Alle Rezepte werden beim nächsten Prompt wieder in den Kontext geladen.' : 'Alle-Rezepte-Kontext deaktiviert. Nächster Prompt nutzt nur manuell referenzierte Rezepte.');
                  }}
                  className="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>
                  <span className="font-medium text-gray-800 dark:text-gray-100">Alle Rezepte in den Kontext laden</span>
                  <span className="block text-[11px] text-gray-500 dark:text-gray-400">Mehr Tokens/Kosten. Aus = nur manuell referenzierte Rezepte.</span>
                </span>
              </label>
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-1">
              {tabs.map((t) => {
                const on = t.id === active.id;
                return (
                  <div key={t.id} className={'flex items-center gap-1 rounded-md border px-2 py-1 text-xs ' + (on ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300')}>
                    <button type="button" className="max-w-[150px] truncate" onClick={() => setActiveId(t.id)}>
                      {t.title || 'Neuer Chat'}
                      {t.messages.length > 0 ? ' 🔒' : ''}
                    </button>
                    {tabs.length > 1 && (
                      <button type="button" className="text-gray-400 hover:text-red-500" aria-label="Tab löschen" onClick={() => removeTab(t.id)}>
                        &times;
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={createTab} className="flex-shrink-0 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
              Neuer Chat
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-gray-50 p-4 dark:bg-gray-900/30">
          {shownMessages.length === 0 && pendingUser === null && (
            <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              Stelle Fragen zum Rezept oder bitte die KI, eine Variante vorzuschlagen. Der Verlauf wird gespeichert, bis du „Chat löschen“ wählst.
            </div>
          )}
          {shownMessages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex flex-col items-end justify-end">
                <div className="ai-msg-bubble max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2.5 text-sm text-white shadow-sm">{m.content}</div>
              </div>
            ) : (
              <div key={i} className="flex flex-col items-start justify-start">
                <AssistantBody content={m.content} />
                <ToolUi content={m.content} index={i} />
              </div>
            )
          )}
          {pendingUser !== null && (
            <>
              <div className="flex flex-col items-end justify-end">
                <div className="ai-msg-bubble max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2.5 text-sm text-white shadow-sm">{pendingUser}</div>
              </div>
              <div className="flex flex-col items-start justify-start">
                <AssistantBody content={streamText || ''} streaming />
              </div>
            </>
          )}
        </div>

        {/* Referenced recipes */}
        {refs.length > 0 && (
          <div className="flex-shrink-0 border-t border-gray-200 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-800">
            <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">Referenzierte Rezepte</p>
            <div className="flex flex-wrap items-center gap-2 overflow-x-auto pb-1">
              {refs.map((r) => {
                const rec = recipeById.get(r.id);
                const img = r.imageUrl ? assetUrl(r.imageUrl) : imageOf(rec);
                const isAll = r.id === ALL;
                const inner = (
                  <>
                    {img ? (
                      <img src={img} alt="" className="h-8 w-8 flex-shrink-0 rounded object-cover" />
                    ) : (
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={BOOK} /></svg>
                      </span>
                    )}
                    <span className="max-w-[140px] truncate text-sm font-medium text-gray-900 dark:text-gray-100" title={isAll ? (includeAll ? 'Alle Rezepte werden als KI-Kontext geladen' : 'Alle-Rezepte-Kontext deaktiviert – nur manuell referenzierte Rezepte') : undefined}>
                      {isAll ? (includeAll ? 'Alle Rezepte' : 'Ohne Vollkontext') : r.title}
                    </span>
                  </>
                );
                return (
                  <div key={r.id} className="group flex min-w-0 flex-shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 py-1 pl-2 pr-1 shadow-sm dark:border-gray-600 dark:bg-gray-700">
                    {isAll ? (
                      <span className="flex min-w-0 flex-1 cursor-default items-center gap-2">{inner}</span>
                    ) : (
                      <Link to={`/rezept/${r.id}`} onClick={onClose} className="flex min-w-0 flex-1 items-center gap-2 hover:opacity-80">{inner}</Link>
                    )}
                    {!isAll && (
                      <button type="button" aria-label="Referenz entfernen" onClick={() => setRefs((rs) => rs.filter((x) => x.id !== r.id))} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="recipe-ai-chat-input-row flex-shrink-0 border-t border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          {generating && (
            <div className="mb-2 flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
              <div className="inline-flex min-w-0 items-center gap-2">
                <span className="recipe-ai-chat-live-spinner" aria-hidden="true" />
                <span>{liveLabel}</span>
              </div>
              <span className="font-mono tabular-nums text-indigo-600 dark:text-indigo-300">{formatElapsed(elapsed)}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={includeAll}
              onClick={() => setPicker(true)}
              className={'flex-shrink-0 rounded-lg border border-gray-300 bg-white p-2.5 text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600' + (includeAll ? ' opacity-40' : '')}
              title={includeAll ? 'Deaktiviere „Alle Rezepte laden“, um gezielt zu referenzieren' : 'Weitere Rezepte im Chat referenzieren'}
              aria-label="Rezepte hinzufügen"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            </button>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Nachricht eingeben…"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-500 focus:border-transparent focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
            />
            <button
              type="button"
              onClick={() => (generating ? abortRef.current?.abort() : void send())}
              title={generating ? 'Generierung abbrechen' : 'Senden'}
              className={'flex flex-shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ' + (generating ? 'recipe-ai-chat-send-abort bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700')}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
              <span>{generating ? 'Abbrechen' : 'Senden'}</span>
            </button>
          </div>
        </div>
      </div>

      {picker && (
        <ReferencePicker
          recipes={recipes}
          exclude={new Set(refs.map((r) => r.id))}
          onClose={() => setPicker(false)}
          onAdd={(add) => {
            setRefs((rs) => [...rs, ...add.filter((a) => !rs.some((r) => r.id === a.id))]);
            setPicker(false);
          }}
        />
      )}
      {shopping && (
        <AddToShoppingListModal
          recipeIds={shopping.ids}
          recipeServingsById={shopping.servings}
          onClose={() => {
            setShopping(null);
          }}
        />
      )}
    </div>
  );
}

function makeTab(provider: 'ollama' | 'openrouter', model: string): Tab {
  const now = nowIso();
  return { id: newId(), title: 'Neuer Chat', aiTitleGenerated: false, messages: [], provider: provider || 'ollama', model: model || '', createdAt: now, updatedAt: now, lastViewedAt: now };
}

function ReferencePicker({ recipes, exclude, onClose, onAdd }: { recipes: Recipe[]; exclude: Set<string>; onClose: () => void; onAdd: (r: ReferencedRecipe[]) => void }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const list = recipes.filter((r) => !exclude.has(r.id));
  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 1010 }} aria-modal="true" aria-label="Rezepte zum Chat hinzufügen">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-[1] flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Rezepte referenzieren</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-300" aria-label="Schließen">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <p className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">Wähle Rezepte, die die KI zusätzlich berücksichtigen soll.</p>
        <div className="flex-1 overflow-y-auto px-4 pb-2">
          <div className="space-y-1">
            {list.length === 0 ? (
              <p className="py-4 text-center text-gray-500 dark:text-gray-400">Alle Rezepte sind bereits referenziert.</p>
            ) : (
              list.map((r) => {
                const img = assetUrl(r.images?.[0]?.url || r.imageUrl || undefined);
                return (
                  <label key={r.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700">
                    <input
                      type="checkbox"
                      checked={sel.has(r.id)}
                      onChange={() =>
                        setSel((s) => {
                          const n = new Set(s);
                          if (n.has(r.id)) n.delete(r.id);
                          else n.add(r.id);
                          return n;
                        })
                      }
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                    />
                    {img ? (
                      <img src={img} alt="" className="h-8 w-8 flex-shrink-0 rounded object-cover" />
                    ) : (
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-gray-200 text-gray-400 dark:bg-gray-700">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={BOOK} /></svg>
                      </span>
                    )}
                    <span className="flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100">{r.title}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600">Abbrechen</button>
          <button
            type="button"
            onClick={() => onAdd(list.filter((r) => sel.has(r.id)).map((r) => ({ id: r.id, title: r.title, imageUrl: r.images?.[0]?.url || r.imageUrl || undefined })))}
            className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700"
          >
            Hinzufügen
          </button>
        </div>
      </div>
    </div>
  );
}

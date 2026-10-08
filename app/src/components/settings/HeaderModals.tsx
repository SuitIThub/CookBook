/**
 * Header controls shared by every page — ports of the website's
 * AliasSettingsModal, AISettingsModal and the Datenspar-Modus toggle.
 */
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { getAlias, getToken, TOKEN_KEY, getAiSettings, saveAiSettings, type AiProvider } from '@/lib/settings';
import { setAlias, onAliasSettingsChanged } from '@/lib/aliasSync';

/* ------------------------------------------------------- Datenspar-Modus */

const LOW_BANDWIDTH_KEY = 'lowBandwidth';
export function readLowBandwidth(): boolean {
  try {
    return localStorage.getItem(LOW_BANDWIDTH_KEY) === '1';
  } catch {
    return document.documentElement.classList.contains('low-bandwidth');
  }
}
export function applyLowBandwidth(enabled: boolean) {
  document.documentElement.classList.toggle('low-bandwidth', enabled);
  document.dispatchEvent(new CustomEvent('cookbook:low-bandwidth-changed'));
}
/** Re-render on Datenspar changes (local toggle or synced from another device). */
export function useLowBandwidth(): boolean {
  const [on, setOn] = useState(readLowBandwidth);
  useEffect(() => {
    const h = () => setOn(readLowBandwidth());
    document.addEventListener('cookbook:low-bandwidth-changed', h);
    return () => document.removeEventListener('cookbook:low-bandwidth-changed', h);
  }, []);
  return on;
}

export function LowBandwidthToggle({ mobile = false }: { mobile?: boolean }) {
  const on = useLowBandwidth();
  const toggle = () => {
    const next = !on;
    try {
      if (next) localStorage.setItem(LOW_BANDWIDTH_KEY, '1');
      else localStorage.removeItem(LOW_BANDWIDTH_KEY);
    } catch {
      /* ignore */
    }
    applyLowBandwidth(next);
  };
  return (
    <button
      type="button"
      onClick={toggle}
      className={'btn-icon hover:text-orange-500 dark:hover:text-orange-400 ' + (on ? 'text-orange-500 dark:text-orange-400' : 'text-gray-700 dark:text-gray-300')}
      aria-label="Datenspar-Modus"
      aria-pressed={on}
      title={mobile ? 'Datenspar-Modus' : 'Datenspar-Modus: keine Rezeptbilder, keine Einbettungen'}
    >
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M22 2L2 22" />
      </svg>
    </button>
  );
}

/* --------------------------------------------------------- Alias modal */

export function AliasSettingsModal({ onClose }: { onClose: () => void }) {
  const [alias, setAliasInput] = useState(getAlias());
  const [token, setToken] = useState(getToken());
  const [current, setCurrent] = useState(getAlias());
  useEffect(() => onAliasSettingsChanged(() => setCurrent(getAlias())), []);
  // Website: does the saved token belong to the saved alias? (else every write → 403)
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  useEffect(() => {
    if (!getAlias() || !getToken()) return;
    apiGet<{ valid: boolean }>('/api/auth/check')
      .then((r) => setTokenValid(r.valid))
      .catch(() => setTokenValid(null));
  }, [current]);

  const saveToken = () => {
    const t = token.trim();
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  };
  const save = () => {
    // Token first so the settings push triggered by setAlias is authorized.
    saveToken();
    void setAlias(alias);
    onClose();
  };
  const clear = () => {
    void setAlias('');
    localStorage.removeItem(TOKEN_KEY);
    setAliasInput('');
    setToken('');
    setCurrent('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.target === e.currentTarget && onClose()} aria-modal="true">
      <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Alias &amp; Synchronisierung</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-300" aria-label="Schließen">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="space-y-4 p-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Vergib einen Alias (z.&nbsp;B. deinen Namen). Alle Geräte mit demselben Alias teilen automatisch ihre Einstellungen: <strong>Design</strong> (Hell/Dunkel), <strong>Datenspar-Modus</strong>, <strong>KI-Einstellungen</strong>, <strong>Favoriten</strong>, <strong>Produkt-Standards</strong> (welches Produkt zu welcher Zutat) und der <strong>Kalorien-/Nährwerttracker</strong> (Körperprofil, Gewichtsverlauf, Mahlzeitenplan, Tagebuch).
          </p>
          <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-xs text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-200">
            <strong className="mb-1 block">Datenschutz-Hinweis</strong>
            Der Alias ist passwortlos. Wer den Alias kennt, sieht auch <strong>Körpergewicht, Kalorienziel und Tagebuch</strong>. Das ist heikler als die üblichen UI-Einstellungen — bitte nur einen Alias verwenden, den außer dir/euch niemand kennt.
          </div>
          <div>
            <label htmlFor="alias-input" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Alias</label>
            <input
              id="alias-input"
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="z. B. familie-mueller"
              maxLength={128}
              value={alias}
              onChange={(e) => setAliasInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Kein Passwort nötig – wer denselben Alias kennt, teilt die Einstellungen.</p>
          </div>
          <div>
            <label htmlFor="token-input" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Zugangs-Token</label>
            <input
              id="token-input"
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Vom Admin erhalten (leer = nur Lesen)"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Ohne Token nur <strong>Lesezugriff</strong>. Mit gültigem Token: Speichern &amp; Synchronisieren. Wird nur auf diesem Gerät gespeichert (nicht geteilt).
            </p>
            {tokenValid !== null && current && (
              <p className={`mt-1 text-xs ${tokenValid ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {tokenValid ? `✓ Token gültig für „${current}“` : `✗ Token passt nicht zu „${current}“ — Speichern und Pings schlagen fehl.`}
              </p>
            )}
            <Link to="/admin/aliasse" onClick={onClose} className="mt-2 inline-block text-xs text-orange-600 hover:underline dark:text-orange-400">
              Aliasse &amp; Tokens verwalten (Admin)
            </Link>
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {current ? `Aktiv – synchronisiert als "${current}".` : 'Kein Alias gesetzt. Einstellungen bleiben nur auf diesem Gerät.'}
          </div>
        </div>
        <div className="flex justify-between gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <button type="button" onClick={clear} style={{ display: current ? undefined : 'none' }} className="rounded-lg border border-red-300 px-4 py-2 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20">Trennen</button>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 dark:border-gray-600 dark:text-gray-300">Abbrechen</button>
            <button type="button" onClick={save} className="rounded-lg bg-orange-500 px-4 py-2 font-medium text-white hover:bg-orange-600">Speichern</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ KI modal */

interface ModelsResponse {
  models?: string[];
  modelDetails?: { id: string; cacheSupported?: boolean; cacheMode?: string }[];
  openRouterAccess?: { userKeyValid?: boolean; userKeyProvided?: boolean } | null;
  openRouterUsage?: any;
  openRouterUsageError?: string;
  error?: string;
}

function formatReset(iso?: string, seconds?: number): string {
  if (typeof iso === 'string' && iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime()))
      return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) return `in ${seconds}s`;
  return 'unbekannt';
}

export function AISettingsModal({ onClose }: { onClose: () => void }) {
  const initial = getAiSettings();
  const [provider, setProvider] = useState<AiProvider>(initial.provider);
  const [apiKey, setApiKey] = useState(initial.openRouterApiKey);
  const [models, setModels] = useState<{ id: string; label: string }[] | null>(null);
  const [model, setModel] = useState(initial.model);
  const [status, setStatus] = useState('');
  const [keyStatus, setKeyStatus] = useState('');
  const [usage, setUsage] = useState<{ free: string; credit: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (prov: AiProvider, key: string, selected: string, keyTest = false) => {
    setLoading(true);
    setModels(null);
    setStatus('');
    if (prov === 'openrouter') setUsage({ free: 'Nutzungsdaten werden geladen...', credit: '' });
    else setUsage(null);
    try {
      const headers: Record<string, string> = {};
      if (prov === 'openrouter' && key) headers['x-openrouter-api-key'] = key;
      const data = await apiGet<ModelsResponse>(`/api/ai/models?provider=${encodeURIComponent(prov)}`, { headers, timeoutMs: 30000 });
      const list = Array.isArray(data.models) ? data.models : [];
      const meta = new Map((data.modelDetails ?? []).filter((d) => d && typeof d.id === 'string').map((d) => [d.id, d]));
      const access = data.openRouterAccess ?? null;
      if (list.length === 0) {
        setModels([]);
        setStatus('Keine Modelle verfügbar.');
      } else {
        setModels(
          list.map((m) => {
            const d = meta.get(m);
            const marker = d && d.cacheSupported ? (d.cacheMode === 'explicit' ? ' [Cache*]' : ' [Cache]') : '';
            return { id: m, label: `${m}${marker}` };
          })
        );
        setModel(selected && list.includes(selected) ? selected : list[0]);
        if (prov === 'openrouter' && access) {
          if (access.userKeyValid) {
            setStatus(`${list.length} Modelle gefunden (voller Zugriff).`);
            if (keyTest) setKeyStatus('API-Key ist gueltig. Volle Modellauswahl aktiv.');
          } else {
            setStatus(`${list.length} kostenlose Modelle gefunden (Env-Key/Fallback).`);
            if (keyTest)
              setKeyStatus(access.userKeyProvided ? 'API-Key ist ungueltig. Es sind nur kostenlose Modelle verfuegbar.' : 'Kein API-Key eingegeben. Es sind nur kostenlose Modelle verfuegbar.');
          }
        } else setStatus(`${list.length} Modelle gefunden.`);
      }
      if (prov === 'openrouter') {
        const u = data.openRouterUsage;
        if (!u || typeof u !== 'object') {
          setUsage({ free: 'Nutzungsdaten konnten nicht geladen werden.', credit: data.openRouterUsageError || 'Bitte spaeter erneut auf "Aktualisieren" klicken.' });
        } else {
          const freeLeft = typeof u.freeRequestsRemaining === 'number' ? String(u.freeRequestsRemaining) : 'unbekannt';
          const free = `Free Requests uebrig: ${freeLeft} (Reset: ${formatReset(u.freeRequestsResetAt, u.freeRequestsResetInSeconds)})`;
          let credit = 'Fuer Credit-Details bitte einen gueltigen eigenen API-Key verwenden.';
          if (access && access.userKeyValid) {
            const fmt = (v: unknown) => (typeof v === 'number' ? v.toFixed(4) : v === null ? 'unbegrenzt' : 'unbekannt');
            credit = `Credits genutzt: ${typeof u.creditsUsed === 'number' ? u.creditsUsed.toFixed(4) : 'unbekannt'} | uebrig: ${fmt(u.creditsRemaining)} / ${fmt(u.creditsLimit)} (Reset: ${u.creditsReset || 'unbekannt'})`;
          }
          setUsage({ free, credit });
        }
      }
    } catch (e) {
      setModels([]);
      const msg = e instanceof Error ? e.message : 'Fehler beim Laden';
      setStatus(msg);
      if (prov === 'openrouter') setUsage({ free: 'Nutzungsdaten konnten nicht geladen werden.', credit: msg });
      if (keyTest) setKeyStatus(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(initial.provider, initial.openRouterApiKey, initial.model);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    const s = { provider, model: model || '', openRouterApiKey: apiKey.trim() };
    saveAiSettings(s);
    document.dispatchEvent(new CustomEvent('ai-settings-updated', { detail: s }));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.target === e.currentTarget && onClose()} aria-modal="true">
      <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">KI-Einstellungen</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-300" aria-label="Schließen">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="space-y-4 p-4">
          <div>
            <label htmlFor="ai-provider-select" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Service</label>
            <select
              id="ai-provider-select"
              value={provider}
              onChange={(e) => {
                const p = e.target.value === 'openrouter' ? 'openrouter' : 'ollama';
                setProvider(p);
                setKeyStatus('');
                void load(p, apiKey.trim(), '');
              }}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              <option value="ollama">Ollama (lokal)</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </div>
          {provider === 'openrouter' && (
            <div>
              <label htmlFor="ai-openrouter-key" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">OpenRouter API-Key</label>
              <input
                id="ai-openrouter-key"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="sk-or-v1-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Wird nur auf diesem Gerät gespeichert und nicht mit dem Alias synchronisiert.</p>
              {apiKey.trim() && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setKeyStatus('API-Key wird getestet...');
                      void load('openrouter', apiKey.trim(), model, true);
                    }}
                    className="rounded-md border border-indigo-300 px-2.5 py-1.5 text-xs text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-900/20"
                  >
                    API-Key testen
                  </button>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{keyStatus}</p>
                </div>
              )}
            </div>
          )}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="ai-model-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Modell</label>
              <button type="button" onClick={() => void load(provider, apiKey.trim(), model)} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">Aktualisieren</button>
            </div>
            <select
              id="ai-model-select"
              value={model}
              disabled={loading || !models || models.length === 0}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              {loading || !models ? (
                <option value="">Lade Modelle…</option>
              ) : models.length === 0 ? (
                <option value="">{status && status !== 'Keine Modelle verfügbar.' ? 'Fehler beim Laden' : 'Keine Modelle gefunden'}</option>
              ) : (
                models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))
              )}
            </select>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{status}</p>
            {provider === 'openrouter' && usage && (
              <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50/70 p-2 dark:border-indigo-800 dark:bg-indigo-900/20">
                <p className="mb-1 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">OpenRouter Nutzung</p>
                <p className="text-[11px] text-indigo-800 dark:text-indigo-200">{usage.free}</p>
                <p className="mt-1 text-[11px] text-indigo-800 dark:text-indigo-200">{usage.credit}</p>
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 dark:border-gray-600 dark:text-gray-300">Abbrechen</button>
          <button type="button" onClick={save} className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700">Speichern</button>
        </div>
      </div>
    </div>
  );
}

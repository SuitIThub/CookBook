import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSettings, saveSettings, type AiProvider } from '@/lib/settings';
import { apiGet } from '@/lib/api';
import { fullResync } from '@/lib/syncRunner';

export default function SettingsPage() {
  const initial = getSettings();
  const [serverUrl, setServerUrl] = useState(initial.serverUrl);
  const [alias, setAlias] = useState(initial.alias);
  const [token, setToken] = useState(initial.token);
  const [aiProvider, setAiProvider] = useState<AiProvider>(initial.aiProvider);
  const [aiModel, setAiModel] = useState(initial.aiModel);
  const [openRouterApiKey, setOpenRouterApiKey] = useState(initial.openRouterApiKey);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<string | null>(null);
  const [resyncing, setResyncing] = useState(false);
  const [resyncMsg, setResyncMsg] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const persist = () => saveSettings({ serverUrl, alias, token, aiProvider, aiModel, openRouterApiKey });

  const onResync = async () => {
    persist();
    setResyncing(true);
    setResyncMsg('Lade alle Daten neu vom Server …');
    try {
      const o = await fullResync();
      queryClient.invalidateQueries();
      setResyncMsg(o.online ? `✓ Neu synchronisiert (${o.applied} aktualisiert, ${o.deleted} entfernt).` : '✗ Server nicht erreichbar.');
    } catch (e) {
      setResyncMsg(`✗ ${(e as Error).message}`);
    } finally {
      setResyncing(false);
    }
  };

  const onSave = () => {
    persist();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const onTest = async () => {
    persist(); // apply so apiGet uses the current values
    setTest('…');
    try {
      const h = await apiGet<{ status: string; stats?: { recipes?: number } }>('/api/health');
      setTest(`✓ ${h.status}${h.stats?.recipes != null ? ` — ${h.stats.recipes} Rezepte` : ''}`);
    } catch (e) {
      setTest(`✗ ${(e as Error).message}`);
    }
  };

  const hint = 'mt-1 text-xs text-gray-500 dark:text-gray-400';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="heading-primary mb-2">Einstellungen</h1>
        <p className="text-muted">Server-Synchronisation und KI — nur auf diesem Gerät gespeichert.</p>
      </div>

      {/* Server & Synchronisation */}
      <div className="card">
        <div className="card-content space-y-4">
          <h2 className="heading-secondary">Server &amp; Synchronisation</h2>
          <div>
            <label className="form-label" htmlFor="server">Server-Adresse</label>
            <input id="server" className="form-input" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="http://192.168.1.20:4399" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <p className={hint}>Leer lassen, um denselben Ursprung / den Standard zu verwenden.</p>
          </div>
          <div>
            <label className="form-label" htmlFor="alias">Alias</label>
            <input id="alias" className="form-input" value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="z. B. familie-mueller" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          </div>
          <div>
            <label className="form-label" htmlFor="token">Zugangs-Token</label>
            <input id="token" className="form-input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Vom Admin erhalten (leer = nur Lesen)" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <p className={hint}>Ohne Token nur <strong>Lesezugriff</strong>. Mit gültigem Token: Schreiben &amp; Synchronisieren.</p>
          </div>
          <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
            <button onClick={onResync} disabled={resyncing} className="btn btn-secondary disabled:opacity-50">
              {resyncing ? 'Synchronisiere …' : 'Neu synchronisieren'}
            </button>
            <p className={hint}>Lädt alle Daten (inkl. Einkaufslisten &amp; Sammelliste) vollständig neu vom Server. Hilft, wenn nach einem App-Update Daten fehlen.</p>
            {resyncMsg && <p className="mt-1 font-mono text-sm text-gray-600 dark:text-gray-300">{resyncMsg}</p>}
          </div>
        </div>
      </div>

      {/* KI */}
      <div className="card">
        <div className="card-content space-y-4">
          <h2 className="heading-secondary">KI</h2>
          <div>
            <label className="form-label" htmlFor="ai-provider">Anbieter</label>
            <select id="ai-provider" className="form-select" value={aiProvider} onChange={(e) => setAiProvider(e.target.value as AiProvider)}>
              <option value="ollama">Ollama (Server)</option>
              <option value="openrouter">OpenRouter</option>
            </select>
            <p className={hint}>Ollama läuft über den Server (URL/Standardmodell serverseitig konfiguriert). OpenRouter nutzt deinen eigenen Schlüssel.</p>
          </div>
          <div>
            <label className="form-label" htmlFor="ai-model">Modell (optional)</label>
            <input id="ai-model" className="form-input" value={aiModel} onChange={(e) => setAiModel(e.target.value)} placeholder={aiProvider === 'openrouter' ? 'z. B. deepseek/deepseek-chat:free' : 'leer = Serverstandard'} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          </div>
          {aiProvider === 'openrouter' && (
            <div>
              <label className="form-label" htmlFor="ai-key">OpenRouter API-Key</label>
              <input id="ai-key" className="form-input" type="password" value={openRouterApiKey} onChange={(e) => setOpenRouterApiKey(e.target.value)} placeholder="sk-or-…" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
              <p className={hint}>Nur auf diesem Gerät gespeichert. Leer = Serverschlüssel (falls konfiguriert).</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={onSave} className="btn btn-primary">Speichern</button>
        <button onClick={onTest} className="btn btn-secondary">Verbindung testen</button>
        {saved && <span className="text-sm text-green-600 dark:text-green-400">Gespeichert</span>}
      </div>

      {test && <p className="font-mono text-sm text-gray-600 dark:text-gray-300">{test}</p>}
    </div>
  );
}

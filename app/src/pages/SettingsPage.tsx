import { useState } from 'react';
import { getSettings, saveSettings, type AiProvider } from '@/lib/settings';
import { apiGet } from '@/lib/api';

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

  const persist = () => saveSettings({ serverUrl, alias, token, aiProvider, aiModel, openRouterApiKey });

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

  const field =
    'w-full rounded-lg border border-secondary-300 bg-white px-3 py-2 text-secondary-900 outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-600 dark:bg-secondary-800 dark:text-white';
  const label = 'mb-1 block text-sm font-medium';
  const hint = 'mt-1 text-xs text-secondary-500';

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-6 text-2xl font-bold">Einstellungen</h1>

      <div className="space-y-5">
        <div>
          <label className={label} htmlFor="server">Server-Adresse</label>
          <input
            id="server"
            className={field}
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://192.168.1.20:4399"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <p className={hint}>Leer lassen, um denselben Ursprung / den Standard zu verwenden.</p>
        </div>

        <div>
          <label className={label} htmlFor="alias">Alias</label>
          <input
            id="alias"
            className={field}
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="z. B. familie-mueller"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <div>
          <label className={label} htmlFor="token">Zugangs-Token</label>
          <input
            id="token"
            className={field}
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Vom Admin erhalten (leer = nur Lesen)"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <p className={hint}>
            Ohne Token nur <strong>Lesezugriff</strong>. Mit gültigem Token: Schreiben &amp;
            Synchronisieren. Nur auf diesem Gerät gespeichert.
          </p>
        </div>

        <div className="border-t border-secondary-200 pt-5 dark:border-secondary-700">
          <h2 className="mb-3 text-lg font-semibold">KI</h2>
          <div className="space-y-4">
            <div>
              <label className={label} htmlFor="ai-provider">Anbieter</label>
              <select
                id="ai-provider"
                className={field}
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value as AiProvider)}
              >
                <option value="ollama">Ollama (Server)</option>
                <option value="openrouter">OpenRouter</option>
              </select>
              <p className={hint}>
                Ollama läuft über den Server (URL/Standardmodell serverseitig konfiguriert). OpenRouter nutzt deinen
                eigenen Schlüssel.
              </p>
            </div>
            <div>
              <label className={label} htmlFor="ai-model">Modell (optional)</label>
              <input
                id="ai-model"
                className={field}
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                placeholder={aiProvider === 'openrouter' ? 'z. B. deepseek/deepseek-chat:free' : 'leer = Serverstandard'}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            {aiProvider === 'openrouter' && (
              <div>
                <label className={label} htmlFor="ai-key">OpenRouter API-Key</label>
                <input
                  id="ai-key"
                  className={field}
                  type="password"
                  value={openRouterApiKey}
                  onChange={(e) => setOpenRouterApiKey(e.target.value)}
                  placeholder="sk-or-…"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <p className={hint}>Nur auf diesem Gerät gespeichert. Leer = Serverschlüssel (falls konfiguriert).</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onSave}
            className="rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
          >
            Speichern
          </button>
          <button
            onClick={onTest}
            className="rounded-lg border border-secondary-300 px-4 py-2 font-medium hover:bg-secondary-100 dark:border-secondary-600 dark:hover:bg-secondary-800"
          >
            Verbindung testen
          </button>
          {saved && <span className="text-sm text-green-600 dark:text-green-400">Gespeichert</span>}
        </div>

        {test && (
          <p className="font-mono text-sm text-secondary-600 dark:text-secondary-300">{test}</p>
        )}
      </div>
    </div>
  );
}

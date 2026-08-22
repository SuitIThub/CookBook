import { useState } from 'react';
import { getSettings, saveSettings } from '@/lib/settings';
import { apiGet } from '@/lib/api';

export default function SettingsPage() {
  const initial = getSettings();
  const [serverUrl, setServerUrl] = useState(initial.serverUrl);
  const [alias, setAlias] = useState(initial.alias);
  const [token, setToken] = useState(initial.token);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<string | null>(null);

  const persist = () => saveSettings({ serverUrl, alias, token });

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

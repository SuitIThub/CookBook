import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '@/lib/api';

/** Website /admin/aliasse: create aliases, rotate their tokens, delete them (needs the server's ADMIN_TOKEN). */
interface AliasInfo {
  alias: string;
  createdAt: number | null;
  hasToken: boolean;
  devices: number;
  settings: number;
  trackerEntries: number;
}

const KEY = 'cookbook.adminToken';
const readToken = () => {
  try {
    return localStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
};

export default function AdminAliasesPage() {
  const [adminToken, setAdminToken] = useState(readToken);
  const [aliases, setAliases] = useState<AliasInfo[] | null>(null);
  const [error, setError] = useState('');
  const [newAlias, setNewAlias] = useState('');
  const [issued, setIssued] = useState<{ alias: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [purge, setPurge] = useState(false);

  const headers = () => ({ 'X-Admin-Token': readToken() });

  const load = async () => {
    try {
      const data = await apiGet<{ aliases: AliasInfo[] }>('/api/admin/aliases', { headers: headers() });
      setAliases(data.aliases);
      setError('');
    } catch (e) {
      setAliases(null);
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    if (readToken()) void load();
  }, []);

  const login = () => {
    localStorage.setItem(KEY, adminToken.trim());
    void load();
  };

  const issue = async (alias: string, replacing: boolean) => {
    if (replacing && !confirm(`Neuen Token für „${alias}“ erzeugen? Der bisherige Token funktioniert danach auf keinem Gerät mehr.`)) return;
    try {
      setIssued(await apiPost<{ alias: string; token: string }>('/api/admin/aliases', { alias }, { headers: headers() }));
      setCopied(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await load();
    } catch (e) {
      alert(`Fehler: ${(e as Error).message}`);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await apiDelete(`/api/admin/aliases?alias=${encodeURIComponent(deleting)}${purge ? '&purge=1' : ''}`, { headers: headers() });
      setDeleting(null);
      if (issued?.alias === deleting) setIssued(null);
      await load();
    } catch (e) {
      alert(`Fehler: ${(e as Error).message}`);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued?.token ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* token is visible to copy by hand */
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="heading-primary mb-2">Aliasse verwalten</h1>
        <p className="text-muted">
          Aliasse anlegen, Zugangs-Tokens neu erzeugen oder Aliasse löschen. Dafür brauchst du den Admin-Token des Servers (Umgebungsvariable <code>ADMIN_TOKEN</code>).
        </p>
      </div>

      <div className="card">
        <div className="card-content space-y-3">
          <label htmlFor="admin-token" className="form-label">Admin-Token</label>
          <div className="flex gap-2">
            <input id="admin-token" type="password" className="form-input flex-1" autoComplete="off" placeholder="ADMIN_TOKEN des Servers" value={adminToken} onChange={(e) => setAdminToken(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && login()} />
            <button type="button" onClick={login} className="btn btn-primary">Anmelden</button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Wird nur auf diesem Gerät gespeichert.</p>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      </div>

      {aliases && (
        <>
          {issued && (
            <div className="rounded-lg border border-green-300 bg-green-50 p-4 dark:border-green-700 dark:bg-green-900/20">
              <p className="text-sm font-medium text-green-800 dark:text-green-200">Neuer Token für „{issued.alias}“ — jetzt notieren, er wird nur einmal angezeigt:</p>
              <div className="mt-2 flex gap-2">
                <code className="flex-1 break-all rounded bg-white px-2 py-1 text-sm dark:bg-gray-900">{issued.token}</code>
                <button type="button" onClick={() => void copy()} className="btn btn-secondary">{copied ? 'Kopiert!' : 'Kopieren'}</button>
              </div>
              <p className="mt-2 text-xs text-green-700 dark:text-green-300">Der bisherige Token dieses Alias ist ab sofort ungültig — auf allen Geräten den neuen eintragen.</p>
            </div>
          )}

          <div className="card">
            <div className="card-content space-y-3">
              <h2 className="heading-secondary">Neuer Alias</h2>
              <div className="flex gap-2">
                <input type="text" maxLength={128} className="form-input flex-1" placeholder="Alias, z. B. Anna" autoComplete="off" value={newAlias} onChange={(e) => setNewAlias(e.target.value)} />
                <button
                  type="button"
                  className="btn btn-success"
                  onClick={() => {
                    const a = newAlias.trim();
                    if (!a) return;
                    setNewAlias('');
                    void issue(a, false);
                  }}
                >
                  Anlegen
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-content space-y-3">
              <h2 className="heading-secondary">Vorhandene Aliasse</h2>
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {aliases.length === 0 && <p className="py-2 text-sm text-gray-500">Noch keine Aliasse.</p>}
                {aliases.map((a) => (
                  <div key={a.alias} className="flex flex-wrap items-center gap-2 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-gray-900 dark:text-white">{a.alias}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {[
                          a.hasToken ? `Token seit ${a.createdAt ? new Date(a.createdAt).toLocaleDateString('de-DE') : '?'}` : 'kein Token (nur Lesen)',
                          `${a.devices} Gerät(e)`,
                          `${a.settings} Einstellung(en)`,
                          `${a.trackerEntries} Tracker-Einträge`
                        ].join(' · ')}
                      </div>
                    </div>
                    <button type="button" onClick={() => void issue(a.alias, a.hasToken)} className="btn btn-secondary text-sm">{a.hasToken ? 'Neuer Token' : 'Token erzeugen'}</button>
                    <button
                      type="button"
                      onClick={() => {
                        setPurge(false);
                        setDeleting(a.alias);
                      }}
                      className="btn btn-danger text-sm"
                    >
                      Löschen
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.target === e.currentTarget && setDeleting(null)} aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800">
            <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Alias „{deleting}“ löschen?</h2>
            </div>
            <div className="space-y-3 p-4 text-sm text-gray-700 dark:text-gray-200">
              <p>Der Token wird ungültig und registrierte Geräte bekommen keine Pings mehr.</p>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={purge} onChange={(e) => setPurge(e.target.checked)} />
                <span>
                  Auch alle Daten des Alias löschen: Einstellungen, Favoriten, Tracker (Gewicht, Tagebuch, Essenspläne). <strong>Nicht rückgängig zu machen.</strong>
                </span>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
              <button type="button" onClick={() => setDeleting(null)} className="btn btn-secondary">Abbrechen</button>
              <button type="button" onClick={() => void remove()} className="btn btn-danger">Löschen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Server & Synchronisierung — app-only settings (the website runs on the server
 * itself): server address, connection test, full re-sync and the sync state.
 * Alias/token and KI live in the header modals, exactly like on the website.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getServerUrl, getAlias, getToken, SERVER_URL_KEY } from '@/lib/settings';
import { apiGet } from '@/lib/api';
import { fullResync, getSyncStatus, subscribeSyncStatus, runSync, type SyncStatus } from '@/lib/syncRunner';
import { onAliasSettingsChanged } from '@/lib/aliasSync';
import { openAliasSettings, openAiSettings } from '@/components/settings/headerActions';
import { APP_VERSION, checkForUpdate, showUpdate } from '@/lib/appUpdate';
import { getPushStatus, pushAvailable, reregisterPush, subscribePushStatus, type PushStatus } from '@/lib/push';

export default function SettingsPage() {
  const [serverUrl, setServerUrl] = useState(getServerUrl());
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<string | null>(null);
  const [resyncing, setResyncing] = useState(false);
  const [resyncMsg, setResyncMsg] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncStatus>(getSyncStatus());
  const [alias, setAlias] = useState(getAlias());
  const queryClient = useQueryClient();
  useEffect(() => subscribeSyncStatus(setSync), []);
  useEffect(() => onAliasSettingsChanged(() => setAlias(getAlias())), []);

  const persist = () => {
    const v = serverUrl.trim().replace(/\/+$/, '');
    if (v) localStorage.setItem(SERVER_URL_KEY, v);
    else localStorage.removeItem(SERVER_URL_KEY);
  };

  const onSave = () => {
    persist();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    void runSync().catch(() => {});
  };

  const onTest = async () => {
    persist();
    setTest('…');
    try {
      const h = await apiGet<{ status: string; stats?: { recipes?: number } }>('/api/health');
      setTest(`✓ ${h.status}${h.stats?.recipes != null ? ` — ${h.stats.recipes} Rezepte` : ''}`);
    } catch (e) {
      setTest(`✗ ${(e as Error).message}`);
    }
  };

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

  const [push, setPush] = useState<PushStatus>(getPushStatus());
  useEffect(() => subscribePushStatus(setPush), []);
  const [reregistering, setReregistering] = useState(false);
  const onReregister = async () => {
    setReregistering(true);
    try {
      await reregisterPush();
    } finally {
      setReregistering(false);
    }
  };
  const pushText: Record<PushStatus['state'], string> = {
    unavailable: 'In dieser Version nicht verfügbar.',
    starting: 'Wird eingerichtet …',
    'no-permission': 'Benachrichtigungen sind nicht erlaubt — bitte in den Android-Einstellungen der App erlauben und dann neu registrieren.',
    'no-alias': 'Kein Alias mit Token gesetzt — Pings brauchen einen angemeldeten Alias.',
    registered: `Aktiv — dieses Gerät empfängt Pings für „${push.alias ?? ''}“.`,
    error: push.error ?? 'Fehler'
  };

  const [checking, setChecking] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const onCheckUpdate = async () => {
    setChecking(true);
    setUpdateMsg(null);
    try {
      const u = await checkForUpdate(false);
      if (u) showUpdate(u);
      else setUpdateMsg('Die App ist aktuell.');
    } catch (e) {
      setUpdateMsg(`Prüfung fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setChecking(false);
    }
  };

  const hint = 'mt-1 text-xs text-gray-500 dark:text-gray-400';
  const last = sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString('de-DE') : 'noch nie';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="heading-primary mb-2">Server &amp; Synchronisierung</h1>
        <p className="text-muted">Die App arbeitet offline mit einer lokalen Kopie und gleicht sie mit dem Kochbuch-Server ab — so teilt ihr Rezepte und Einkaufslisten im Haushalt.</p>
      </div>

      <div className="card">
        <div className="card-content space-y-4">
          <div>
            <label className="form-label" htmlFor="server">Server-Adresse</label>
            <input id="server" className="form-input" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="http://192.168.1.20:4399" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <p className={hint}>Leer lassen, um denselben Ursprung / den Standard zu verwenden.</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onSave} className="btn btn-primary">Speichern</button>
            <button onClick={onTest} className="btn btn-secondary">Verbindung testen</button>
            {saved && <span className="text-sm text-green-600 dark:text-green-400">Gespeichert</span>}
          </div>
          {test && <p className="font-mono text-sm text-gray-600 dark:text-gray-300">{test}</p>}
        </div>
      </div>

      <div className="card">
        <div className="card-content space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <h2 className="heading-secondary">Status</h2>
          <p>
            Alias: <strong>{alias || '—'}</strong> · Token: <strong>{getToken() ? 'gesetzt (Schreibzugriff)' : 'keiner (nur Lesen)'}</strong>{' '}
            <button onClick={openAliasSettings} className="ml-1 text-orange-600 hover:underline dark:text-orange-400">ändern</button>
          </p>
          <p>
            Letzte Synchronisierung: <strong>{last}</strong>
            {sync.pending > 0 && <> · <strong>{sync.pending}</strong> Änderung(en) warten auf Upload</>}
            {sync.phase === 'offline' && <> · offline</>}
          </p>
          {sync.pushError && <p className="text-red-600 dark:text-red-400">Hochladen fehlgeschlagen — Token prüfen. ({sync.pushError})</p>}
          <p>
            KI-Anbieter und Modell: <button onClick={openAiSettings} className="text-indigo-600 hover:underline dark:text-indigo-400">KI-Einstellungen öffnen</button>
          </p>
          <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
            <button onClick={onResync} disabled={resyncing} className="btn btn-secondary disabled:opacity-50">
              {resyncing ? 'Synchronisiere …' : 'Neu synchronisieren'}
            </button>
            <p className={hint}>Lädt alle Daten (inkl. Einkaufslisten &amp; Sammelliste) vollständig neu vom Server. Hilft, wenn nach einem App-Update Daten fehlen.</p>
            {resyncMsg && <p className="mt-1 font-mono text-sm text-gray-600 dark:text-gray-300">{resyncMsg}</p>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-content space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <h2 className="heading-secondary">Benachrichtigungen (Pings)</h2>
          <p className={push.state === 'error' || push.state === 'no-permission' ? 'text-red-600 dark:text-red-400' : push.state === 'registered' ? 'text-green-700 dark:text-green-400' : ''}>{pushText[push.state]}</p>
          {pushAvailable && (
            <button onClick={() => void onReregister()} disabled={reregistering} className="btn btn-secondary disabled:opacity-50">
              {reregistering ? 'Registriere …' : 'Neu registrieren'}
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-content space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <h2 className="heading-secondary">App-Version</h2>
          <p>
            Installiert: <strong>{APP_VERSION}</strong>
          </p>
          <div className="flex items-center gap-3">
            <button onClick={onCheckUpdate} disabled={checking} className="btn btn-secondary disabled:opacity-50">
              {checking ? 'Suche …' : 'Nach Updates suchen'}
            </button>
            {updateMsg && <span className="text-sm text-gray-600 dark:text-gray-300">{updateMsg}</span>}
          </div>
          <p className={hint}>Neue Versionen erscheinen als Release auf GitHub; die App prüft beim Start automatisch.</p>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import {
  APP_VERSION,
  canInstallInApp,
  downloadAndInstall,
  installAllowed,
  openInstallSettings,
  skipVersion,
  type AvailableUpdate
} from '@/lib/appUpdate';

/** "Neue Version verfügbar" — offers download + install of a GitHub release APK. */
export default function UpdateDialog({ update, onClose }: { update: AvailableUpdate; onClose: () => void }) {
  const [phase, setPhase] = useState<'ask' | 'permission' | 'downloading' | 'installer' | 'error'>('ask');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');

  const start = async () => {
    if (!(await installAllowed())) {
      setPhase('permission');
      return;
    }
    setPhase('downloading');
    setProgress(null);
    try {
      await downloadAndInstall(update, setProgress);
      setPhase(canInstallInApp() ? 'installer' : 'ask');
      if (!canInstallInApp()) onClose();
    } catch (e) {
      setError((e as Error).message || String(e));
      setPhase('error');
    }
  };

  const later = () => onClose();
  const skip = () => {
    skipVersion(update.version);
    onClose();
  };
  const sizeMb = update.sizeBytes ? `${(update.sizeBytes / 1024 / 1024).toFixed(1)} MB` : '';
  const busy = phase === 'downloading';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.target === e.currentTarget && !busy && later()} aria-modal="true">
      <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800">
        <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Neue Version verfügbar</h2>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            Version {update.version} · installiert: {APP_VERSION}
            {sizeMb && ` · ${sizeMb}`}
          </p>
        </div>
        <div className="space-y-3 p-4">
          {update.notes.trim() && (
            <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">{update.notes.trim()}</div>
          )}

          {phase === 'permission' && (
            <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-200">
              Android muss der App einmalig erlauben, Updates zu installieren („Unbekannte Apps installieren“). Erlaube es in den Einstellungen und tippe danach erneut auf „Jetzt aktualisieren“.
              <button type="button" onClick={() => void openInstallSettings()} className="mt-2 block rounded-lg bg-yellow-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-yellow-600">
                Einstellungen öffnen
              </button>
            </div>
          )}

          {busy && (
            <div>
              <p className="mb-1 text-sm text-gray-600 dark:text-gray-300">Wird heruntergeladen … {progress != null && `${Math.round(progress * 100)} %`}</p>
              <div className="h-2 w-full overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
                <div className={`h-full bg-primary-500 transition-all ${progress == null ? 'w-1/3 animate-pulse' : ''}`} style={progress != null ? { width: `${progress * 100}%` } : undefined} />
              </div>
            </div>
          )}

          {phase === 'installer' && (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Der Android-Installer wurde geöffnet — bestätige dort die Installation. Deine Daten bleiben erhalten.
            </p>
          )}

          {phase === 'error' && (
            <p className="text-sm text-red-600 dark:text-red-400">
              Update fehlgeschlagen: {error}{' '}
              <a href={update.pageUrl} target="_blank" rel="noreferrer" className="underline">
                Release auf GitHub öffnen
              </a>
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          {phase !== 'installer' && (
            <button type="button" onClick={skip} disabled={busy} className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700">
              Version überspringen
            </button>
          )}
          <button type="button" onClick={later} disabled={busy} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">
            {phase === 'installer' ? 'Schließen' : 'Später'}
          </button>
          {phase !== 'installer' && (
            <button type="button" onClick={() => void start()} disabled={busy} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
              {phase === 'error' ? 'Erneut versuchen' : 'Jetzt aktualisieren'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { fetchPingTargets, pingShoppingList, type PingTarget } from '@/lib/push';
import { ApiError } from '@/lib/api';

/** Website PingAliasesModal: notify other aliases (their app) about this shopping list. */
export default function PingAliasesModal({ listId, onClose }: { listId: string; onClose: () => void }) {
  const [targets, setTargets] = useState<PingTarget[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<{ text: string; kind: 'info' | 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchPingTargets()
      .then((d) => {
        setTargets(d.aliases);
        if (!d.configured) setStatus({ text: 'Hinweis: Push ist auf dem Server noch nicht eingerichtet.', kind: 'error' });
      })
      .catch((e) => {
        setTargets([]);
        setStatus({
          text: e instanceof ApiError && e.status === 403 ? 'Zum Anpingen brauchst du einen Alias mit Token (Alias-Einstellungen).' : 'Aliasse konnten nicht geladen werden (Server erreichbar?).',
          kind: 'error'
        });
      });
  }, []);

  const toggle = (alias: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(alias)) n.delete(alias);
      else n.add(alias);
      return n;
    });

  const send = async () => {
    setBusy(true);
    setStatus({ text: 'Sende …', kind: 'info' });
    try {
      const r = await pingShoppingList(listId, [...picked], message);
      const missing = r.noDevice ?? [];
      if (r.sent > 0) {
        setStatus({ text: `Gesendet${missing.length ? ` — ohne App: ${missing.join(', ')}` : ''}.`, kind: 'ok' });
        setTimeout(onClose, 1500);
      } else {
        setStatus({ text: `Niemand erreicht — ${missing.join(', ')} ${missing.length === 1 ? 'hat' : 'haben'} die App nicht verbunden.`, kind: 'error' });
      }
    } catch (e) {
      setStatus({ text: `Anpingen fehlgeschlagen: ${(e as Error).message}`, kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const statusCls = status?.kind === 'error' ? 'text-red-600 dark:text-red-400' : status?.kind === 'ok' ? 'text-green-600 dark:text-green-400' : 'text-gray-600 dark:text-gray-300';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.target === e.currentTarget && onClose()} aria-modal="true">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Pingen</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-300" aria-label="Schließen">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">Wer die Kochbuch-App mit seinem Alias nutzt, bekommt eine Benachrichtigung mit der Bitte, sich diese Einkaufsliste anzusehen.</p>
          <div className="space-y-1 text-sm text-gray-800 dark:text-gray-100">
            {targets === null && <p className="text-gray-500">Lade Aliasse …</p>}
            {targets?.length === 0 && !status && <p className="text-gray-500">Keine anderen Aliasse vorhanden.</p>}
            {targets?.map((t) => (
              <label key={t.alias} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <input type="checkbox" className="h-4 w-4" checked={picked.has(t.alias)} onChange={() => toggle(t.alias)} />
                <span>{t.alias}</span>
                <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">{t.hasDevice ? 'App verbunden' : 'keine App'}</span>
              </label>
            ))}
          </div>
          <label className="block text-sm text-gray-700 dark:text-gray-200">
            Nachricht (optional)
            <input type="text" maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="z. B. Bringst du Milch mit?" className="form-input mt-1 w-full" />
          </label>
          {status && <p className={`text-sm ${statusCls}`}>{status.text}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <button type="button" onClick={onClose} className="btn btn-secondary">Abbrechen</button>
          <button type="button" onClick={() => void send()} disabled={busy || picked.size === 0} className="btn btn-primary disabled:opacity-50">Anpingen</button>
        </div>
      </div>
    </div>
  );
}

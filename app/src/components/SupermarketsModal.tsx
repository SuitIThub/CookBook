import { useEffect, useState } from 'react';
import type { Supermarket } from '@shared/tracker';
import { localSupermarkets, saveLocalSupermarket, deleteLocalSupermarket } from '@/lib/localData';

interface Props {
  onClose: () => void;
  onChanged: () => void;
}

export default function SupermarketsModal({ onClose, onChanged }: Props) {
  const [markets, setMarkets] = useState<Supermarket[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = async () => setMarkets(await localSupermarkets());
  useEffect(() => {
    reload();
  }, []);

  const add = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    await saveLocalSupermarket({ name: newName.trim() });
    setNewName('');
    await reload();
    onChanged();
    setBusy(false);
  };

  const rename = async (m: Supermarket, name: string) => {
    if (!name.trim() || name === m.name) return;
    await saveLocalSupermarket({ id: m.id, name: name.trim() });
    await reload();
    onChanged();
  };

  const remove = async (m: Supermarket) => {
    if (!confirm(`Supermarkt "${m.name}" löschen?`)) return;
    await deleteLocalSupermarket(m.id);
    await reload();
    onChanged();
  };

  const field =
    'rounded-lg border border-secondary-300 bg-white px-3 py-2 text-sm text-secondary-900 outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-600 dark:bg-secondary-700 dark:text-white';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl dark:bg-secondary-800" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold">Supermärkte</h2>

        <ul className="mb-4 space-y-2">
          {markets.map((m) => (
            <li key={m.id} className="flex items-center gap-2">
              <input
                className={field + ' flex-1'}
                defaultValue={m.name}
                onBlur={(e) => rename(m, e.target.value)}
              />
              <button
                onClick={() => remove(m)}
                className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                ✕
              </button>
            </li>
          ))}
          {markets.length === 0 && <li className="text-sm text-secondary-500">Noch keine Supermärkte.</li>}
        </ul>

        <div className="flex gap-2">
          <input
            className={field + ' flex-1'}
            placeholder="Neuer Supermarkt"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button onClick={add} disabled={busy} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            Hinzufügen
          </button>
        </div>

        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="rounded-lg border border-secondary-300 px-4 py-2 text-sm dark:border-secondary-600">
            Fertig
          </button>
        </div>
      </div>
    </div>
  );
}

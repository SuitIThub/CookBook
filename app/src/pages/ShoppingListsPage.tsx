import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { localShoppingLists, createLocalShoppingList, deleteLocalShoppingList } from '@/lib/localData';
import { runSync } from '@/lib/syncRunner';

export default function ShoppingListsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['shoppingLists'],
    queryFn: localShoppingLists
  });
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['shoppingLists'] });
    runSync().catch(() => {});
  };

  const create = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await createLocalShoppingList(t);
      setTitle('');
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Liste "${name}" löschen?`)) return;
    await deleteLocalShoppingList(id);
    refresh();
  };

  if (isLoading) return <p className="text-secondary-500">Lade Einkaufslisten …</p>;
  if (isError) return <p className="text-red-600 dark:text-red-400">Fehler: {(error as Error).message}</p>;

  const lists = data ?? [];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Einkaufslisten</h1>

      <div className="mb-6 flex gap-2">
        <input
          className="flex-1 rounded-lg border border-secondary-300 bg-white px-3 py-2 text-sm text-secondary-900 outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-600 dark:bg-secondary-800 dark:text-white"
          placeholder="Neue Liste …"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <button
          onClick={create}
          disabled={busy || !title.trim()}
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          Anlegen
        </button>
      </div>

      {lists.length === 0 ? (
        <p className="text-secondary-500">Noch keine Einkaufslisten. Lege oben eine an.</p>
      ) : (
        <ul className="space-y-2">
          {lists.map((l) => {
            const open = l.items.filter((i) => !i.isChecked).length;
            return (
              <li
                key={l.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-secondary-200 bg-white p-4 dark:border-secondary-700 dark:bg-secondary-800"
              >
                <Link to={`/einkaufsliste/${l.id}`} className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{l.title}</span>
                    {l.isPermanent && (
                      <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                        Dauerliste
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-secondary-500">
                    {open} offen · {l.items.length} Artikel · {l.recipes.length} Rezepte
                  </p>
                </Link>
                {!l.isPermanent && (
                  <button
                    onClick={() => remove(l.id, l.title)}
                    aria-label="Liste löschen"
                    className="shrink-0 rounded-lg px-2 py-1 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

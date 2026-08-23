import { useEffect, useState } from 'react';
import type { ShoppingList } from '@/types';

/**
 * "Zur Einkaufsliste" — pick an existing shopping list (or create one) and add
 * the current recipe to it. Mirrors the website's add-to-shopping flow, offline
 * via the shared core.
 */
export default function AddToShoppingListModal({
  recipeId,
  recipeTitle,
  onClose,
  loadLists,
  createList,
  addRecipe
}: {
  recipeId: string;
  recipeTitle: string;
  onClose: () => void;
  loadLists: () => Promise<ShoppingList[]>;
  createList: (title: string) => Promise<ShoppingList>;
  addRecipe: (listId: string, recipeId: string) => Promise<ShoppingList | null>;
}) {
  const [lists, setLists] = useState<ShoppingList[] | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadLists().then(setLists).catch(() => setLists([]));
  }, [loadLists]);

  const addTo = async (listId: string, title: string) => {
    setBusy(true);
    setError(null);
    try {
      await addRecipe(listId, recipeId);
      setDone(title);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async () => {
    const t = newTitle.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    try {
      const list = await createList(t);
      await addRecipe(list.id, recipeId);
      setDone(t);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Zur Einkaufsliste hinzufügen</h2>
          <button onClick={onClose} className="text-2xl leading-none text-gray-500 hover:text-gray-800 dark:text-gray-300">&times;</button>
        </div>

        {done ? (
          <div className="space-y-4">
            <p className="text-gray-700 dark:text-gray-200">
              „{recipeTitle}“ wurde zu <span className="font-semibold">{done}</span> hinzugefügt.
            </p>
            <div className="flex justify-end">
              <button onClick={onClose} className="btn btn-primary">Fertig</button>
            </div>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">Liste wählen:</p>
            {lists === null ? (
              <p className="text-gray-500">Lade …</p>
            ) : lists.length === 0 ? (
              <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">Noch keine Listen. Erstelle unten eine neue.</p>
            ) : (
              <ul className="mb-4 max-h-52 space-y-1 overflow-y-auto">
                {lists.map((l) => (
                  <li key={l.id}>
                    <button
                      onClick={() => addTo(l.id, l.title)}
                      disabled={busy}
                      className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-left hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-700"
                    >
                      <span className="font-medium text-gray-900 dark:text-white">{l.title}</span>
                      <span className="text-xs text-gray-500">{l.items.length} Artikel</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
              <label className="form-label" htmlFor="new-list">Neue Liste</label>
              <div className="flex gap-2">
                <input
                  id="new-list"
                  className="form-input"
                  value={newTitle}
                  placeholder="z.B. Wocheneinkauf"
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createAndAdd()}
                />
                <button onClick={createAndAdd} disabled={!newTitle.trim() || busy} className="btn btn-success shrink-0 disabled:opacity-50">
                  Erstellen &amp; hinzufügen
                </button>
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}

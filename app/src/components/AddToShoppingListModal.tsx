/**
 * "Zur Einkaufsliste hinzufügen" — port of the website's ShoppingListModal
 * (bulk + single recipe). Creates "Einkaufsliste vom <Datum>" or adds to an
 * existing list (skipping recipes already on it), then opens the list.
 * Works offline on the local replica.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { ShoppingList } from '@/types';
import { localShoppingLists, createLocalShoppingList, addRecipesToLocalShoppingList, setLocalRecipeServings } from '@/lib/localData';
import { runSync } from '@/lib/syncRunner';

export default function AddToShoppingListModal({
  recipeIds,
  recipeServingsById = {},
  onClose
}: {
  recipeIds: string[];
  recipeServingsById?: Record<string, number>;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [lists, setLists] = useState<ShoppingList[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    localShoppingLists().then(setLists, () => setFailed(true));
  }, []);

  const finish = (listId: string) => {
    queryClient.invalidateQueries();
    runSync().catch(() => {});
    onClose();
    navigate(`/einkaufsliste/${listId}`);
  };

  const applyServings = async (listId: string, ids: string[]) => {
    for (const id of ids) {
      const s = recipeServingsById[id];
      if (typeof s === 'number' && s > 0) await setLocalRecipeServings(listId, id, s);
    }
  };

  const createNew = async () => {
    if (creating) return;
    if (recipeIds.length === 0) {
      alert('Keine Rezepte ausgewählt.');
      return;
    }
    setCreating(true);
    try {
      const list = await createLocalShoppingList(`Einkaufsliste vom ${new Date().toLocaleDateString('de-DE')}`);
      await addRecipesToLocalShoppingList(list.id, recipeIds);
      await applyServings(list.id, recipeIds);
      finish(list.id);
    } catch (e) {
      console.error('Fehler beim Erstellen der Einkaufsliste:', e);
      alert('Die Einkaufsliste konnte nicht erstellt werden.');
      setCreating(false);
    }
  };

  const addToExisting = async (list: ShoppingList, toAdd: string[]) => {
    try {
      if (toAdd.length > 0) {
        await addRecipesToLocalShoppingList(list.id, toAdd);
        await applyServings(list.id, toAdd);
      }
      finish(list.id);
    } catch (e) {
      console.error('Fehler beim Hinzufügen zur Einkaufsliste:', e);
      alert('Die Rezepte konnten nicht zur Einkaufsliste hinzugefügt werden.');
    }
  };

  const now = new Date();
  const todayStr = [String(now.getDate()).padStart(2, '0'), String(now.getMonth() + 1).padStart(2, '0'), now.getFullYear()].join('.');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">Zur Einkaufsliste hinzufügen</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300" aria-label="Schließen">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="space-y-4">
          <button onClick={createNew} disabled={creating} className="btn btn-primary flex w-full items-center justify-center space-x-2">
            {creating ? (
              <span>Wird erstellt...</span>
            ) : (
              <>
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                <span>Neue Einkaufsliste erstellen</span>
              </>
            )}
          </button>
          <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
            <h4 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">Oder zu bestehender Liste hinzufügen:</h4>
            <div id="existing-lists" className="max-h-60 space-y-2 overflow-y-auto pr-2">
              {failed ? (
                <div className="py-4 text-center text-sm text-red-600 dark:text-red-400">Fehler beim Laden der Einkaufslisten</div>
              ) : !lists ? null : lists.length === 0 ? (
                <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">Keine bestehenden Einkaufslisten gefunden</p>
              ) : (
                lists.map((list) => {
                  const existing = new Set((list.recipes || []).map((r) => r.id));
                  const already = recipeIds.filter((id) => existing.has(id));
                  const alreadyTitles = (list.recipes || []).filter((r) => already.includes(r.id)).map((r) => r.title);
                  const all = already.length === recipeIds.length;
                  const some = already.length > 0 && !all;
                  const toAdd = recipeIds.filter((id) => !existing.has(id));
                  return (
                    <button
                      key={list.id}
                      disabled={all}
                      onClick={() => addToExisting(list, toAdd)}
                      className={
                        'btn btn-secondary flex w-full flex-col items-start p-3 hover:bg-gray-50 dark:hover:bg-gray-700' +
                        (all ? ' cursor-not-allowed opacity-50' : '') +
                        (list.title.includes(todayStr) ? ' shopping-list-today' : '')
                      }
                    >
                      <div className="flex w-full items-center justify-between">
                        <span className="flex items-center space-x-3">
                          <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                          <span className="text-left">
                            <span className="block font-medium">{list.title}</span>
                            <span className="block text-sm text-gray-500">{list.items?.length || 0} Zutaten</span>
                            {all && <span className="mt-1 block text-xs text-orange-600 dark:text-orange-400">Alle Rezepte bereits hinzugefügt</span>}
                          </span>
                        </span>
                      </div>
                      {some && (
                        <div className="mt-2 w-full border-t border-orange-200 pt-2 dark:border-orange-800">
                          <div className="flex-1 text-left text-xs text-orange-600 dark:text-orange-400">
                            <span className="font-medium">Bereits hinzugefügt:</span>
                            <span className="ml-1">{alreadyTitles.join(', ')}</span>
                            <div className="mt-1 text-gray-600 dark:text-gray-400">Nur die anderen Rezepte werden hinzugefügt.</div>
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ShoppingList } from '@/types';
import { localShoppingLists, createLocalShoppingList, deleteLocalShoppingList } from '@/lib/localData';
import { runSync } from '@/lib/syncRunner';

export default function ShoppingListsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['shoppingLists'], queryFn: localShoppingLists });
  const [showCreate, setShowCreate] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['shoppingLists'] });
    runSync().catch(() => {});
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Möchten Sie die Einkaufsliste "${name}" wirklich löschen?`)) return;
    await deleteLocalShoppingList(id);
    refresh();
  };

  if (isLoading) return <p className="text-gray-500 dark:text-gray-400">Lade Einkaufslisten …</p>;
  if (isError) return <p className="text-red-600 dark:text-red-400">Fehler: {(error as Error).message}</p>;

  const lists = data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex-between">
        <div>
          <h1 className="heading-primary mb-2">Einkaufslisten</h1>
          <p className="text-muted">
            {lists.length === 0 ? 'Noch keine Einkaufslisten vorhanden' : `${lists.length} ${lists.length === 1 ? 'Liste' : 'Listen'} verfügbar`}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button onClick={() => setShowCreate(true)} className="btn btn-success flex w-full items-center justify-center space-x-2 sm:w-auto">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
            <span>Neue Liste</span>
          </button>
        </div>
      </div>

      {lists.length === 0 ? (
        <div className="card">
          <div className="card-content py-12 text-center">
            <p className="text-muted mb-4">Noch keine Einkaufslisten. Erstelle deine erste Liste.</p>
            <button onClick={() => setShowCreate(true)} className="btn btn-primary">Neue Liste</button>
          </div>
        </div>
      ) : (
        <div className="grid-responsive">
          {lists.map((l) => (
            <ListCard key={l.id} list={l} onDelete={() => remove(l.id, l.title)} />
          ))}
        </div>
      )}

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={refresh} />}
    </div>
  );
}

function ListCard({ list, onDelete }: { list: ShoppingList; onDelete: () => void }) {
  const total = list.items.length;
  const completed = list.items.filter((i) => i.isChecked).length;
  const permLabel = list.permanentType === 2 ? 'Vorlage' : 'Sammelliste';
  return (
    <div className="shopping-list-card card transition-all duration-200 hover:shadow-lg">
      <div className="card-content relative">
        <div className="mb-3 flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h2 className="heading-card truncate text-lg font-semibold text-gray-900 dark:text-white">{list.title}</h2>
              {list.isPermanent && (
                <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-900/40 dark:text-orange-200">{permLabel}</span>
              )}
            </div>
            {list.description && <p className="text-muted mb-2 line-clamp-2 text-sm">{list.description}</p>}
          </div>
          {!list.isPermanent && (
            <button onClick={onDelete} aria-label="Einkaufsliste löschen" className="btn-icon text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          )}
        </div>

        <div className="mb-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">Artikel</span>
            <span className="font-medium text-gray-900 dark:text-white">{completed}/{total}</span>
          </div>
          {total > 0 && (
            <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
              <div className="h-2 rounded-full bg-green-500 transition-all duration-300" style={{ width: `${(completed / total) * 100}%` }} />
            </div>
          )}
          {list.recipes && list.recipes.length > 0 && (
            <div className="flex items-center space-x-1 text-xs text-blue-600 dark:text-blue-400">
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
              <span>{list.recipes.length} Rezept{list.recipes.length !== 1 ? 'e' : ''}</span>
            </div>
          )}
        </div>

        <div className="flex space-x-2">
          <Link to={`/einkaufsliste/${list.id}`} className="btn btn-primary flex-1 text-center">Öffnen</Link>
        </div>
      </div>
    </div>
  );
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await createLocalShoppingList(t);
      onCreated();
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Neue Einkaufsliste erstellen</h2>
          <button onClick={onClose} className="text-2xl leading-none text-gray-500 hover:text-gray-800 dark:text-gray-300">&times;</button>
        </div>
        <label className="form-label" htmlFor="sl-title">Titel</label>
        <input id="sl-title" autoFocus className="form-input mb-4" value={title} placeholder="z.B. Wocheneinkauf" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-secondary">Abbrechen</button>
          <button onClick={create} disabled={busy || !title.trim()} className="btn btn-primary disabled:opacity-50">Erstellen</button>
        </div>
      </div>
    </div>
  );
}

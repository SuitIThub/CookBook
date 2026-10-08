/**
 * Einkaufslisten (overview) — port of src/pages/einkaufslisten.astro with
 * ShoppingListsHeader / ShoppingListCard / EmptyShoppingListsState.
 * Local-first; live updates arrive through the background sync.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ShoppingList } from '@/types';
import { localShoppingLists, createLocalShoppingList, deleteLocalShoppingList } from '@/lib/localData';
import { runSync } from '@/lib/syncRunner';

const icon = (d: string, cls = 'h-5 w-5') => (
  <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} /></svg>
);
const CHECK_CIRCLE = 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z';
const TRASH = 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16';
const CLIP = 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2';
const CLOCK = 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z';
const PLUS = 'M12 6v6m0 0v6m0-6h6m-6 0H6';

function todayStr() {
  const now = new Date();
  return [String(now.getDate()).padStart(2, '0'), String(now.getMonth() + 1).padStart(2, '0'), now.getFullYear()].join('.');
}

export default function ShoppingListsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['shoppingLists'], queryFn: localShoppingLists });
  const [showCreate, setShowCreate] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['shoppingLists'] });
    runSync().catch(() => {});
  };

  if (isLoading) return <p className="text-gray-500 dark:text-gray-400">Lade Einkaufslisten …</p>;
  if (isError) return <p className="text-red-600 dark:text-red-400">Fehler: {(error as Error).message}</p>;
  const lists = data ?? [];

  const toggleSelected = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const endSelection = () => {
    setSelectionMode(false);
    setSelected(new Set());
  };
  const selectAll = () => {
    const all = lists.every((l) => selected.has(l.id));
    setSelected(all ? new Set() : new Set(lists.map((l) => l.id)));
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Möchten Sie ${selected.size} ausgewählte ${selected.size === 1 ? 'Liste' : 'Listen'} wirklich löschen?`)) return;
    setDeleting(true);
    let ok = 0;
    let fail = 0;
    for (const id of selected) {
      if (await deleteLocalShoppingList(id)) ok++;
      else fail++;
    }
    setDeleting(false);
    endSelection();
    refresh();
    if (fail === 0) alert(`${ok} ${ok === 1 ? 'Liste wurde' : 'Listen wurden'} erfolgreich gelöscht`);
    else alert(`${fail} ${fail === 1 ? 'Liste konnte' : 'Listen konnten'} nicht gelöscht werden`);
  };

  const quickAdd = async () => {
    try {
      const list = await createLocalShoppingList(`Einkaufsliste ${todayStr()}`, '');
      refresh();
      navigate(`/einkaufsliste/${list.id}`);
    } catch (e) {
      console.error('Error creating quick shopping list:', e);
      alert('Fehler beim Erstellen der Einkaufsliste');
    }
  };

  const removeOne = async (l: ShoppingList) => {
    if (!confirm(`Möchten Sie die Einkaufsliste "${l.title}" wirklich löschen?`)) return;
    if (await deleteLocalShoppingList(l.id)) refresh();
    else alert('Fehler beim Löschen der Einkaufsliste');
  };

  return (
    <div className="space-y-6">
      <div className="flex-between">
        <div>
          <h1 className="heading-primary mb-2">Einkaufslisten</h1>
          <p className="text-muted">{lists.length === 0 ? 'Noch keine Einkaufslisten vorhanden' : `${lists.length} ${lists.length === 1 ? 'Liste' : 'Listen'} verfügbar`}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          {selectionMode ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <button onClick={selectAll} className="btn btn-secondary flex w-full items-center justify-center space-x-2 sm:w-auto">
                {icon(CHECK_CIRCLE)}
                <span>Alle auswählen</span>
              </button>
              <button onClick={deleteSelected} disabled={selected.size === 0 || deleting} className="btn btn-danger flex w-full items-center justify-center space-x-2 sm:w-auto">
                {icon(TRASH)}
                <span>Ausgewählte löschen</span>
              </button>
              <button onClick={endSelection} className="btn btn-secondary w-full justify-center sm:w-auto">Abbrechen</button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row">
              <button onClick={() => setSelectionMode(true)} className="btn btn-secondary flex w-full items-center justify-center space-x-2 sm:w-auto">
                {icon(CLIP)}
                <span>Auswählen</span>
              </button>
              <button onClick={quickAdd} className="btn btn-success flex w-full items-center justify-center space-x-2 sm:w-auto">
                {icon(CLOCK)}
                <span>Schnell hinzufügen</span>
              </button>
              <button onClick={() => setShowCreate(true)} className="btn btn-success flex w-full items-center justify-center space-x-2 sm:w-auto">
                {icon(PLUS)}
                <span>Neue Liste</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {lists.length === 0 ? (
        <div className="py-12 text-center">
          <div className="mb-6">
            <svg className="mx-auto h-24 w-24 text-gray-400 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v11a2 2 0 002 2h5.586a1 1 0 00.707-.293l5.414-5.414a1 1 0 00.293-.707V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
          </div>
          <h3 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">Noch keine Einkaufslisten vorhanden</h3>
          <p className="mx-auto mb-6 max-w-md text-gray-600 dark:text-gray-400">Erstellen Sie Ihre erste Einkaufsliste, um den Überblick über Ihre Einkäufe zu behalten.</p>
          <button onClick={() => setShowCreate(true)} className="btn btn-success mx-auto flex items-center space-x-2">
            {icon(PLUS)}
            <span>Erste Einkaufsliste erstellen</span>
          </button>
        </div>
      ) : (
        <div className="grid-responsive">
          {lists.map((l) => (
            <ListCard
              key={l.id}
              list={l}
              selectionMode={selectionMode}
              selected={selected.has(l.id)}
              onToggle={() => toggleSelected(l.id)}
              onDelete={() => removeOne(l)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            refresh();
            navigate(`/einkaufsliste/${id}`);
          }}
        />
      )}
    </div>
  );
}

function ListCard({
  list,
  selectionMode,
  selected,
  onToggle,
  onDelete
}: {
  list: ShoppingList;
  selectionMode: boolean;
  selected: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const total = list.items.length;
  const completed = list.items.filter((i) => i.isChecked).length;
  const isToday = list.title.includes(todayStr());
  return (
    <div
      className={'shopping-list-card card transition-all duration-200 hover:shadow-lg' + (isToday ? ' shopping-list-today' : '') + (selectionMode && selected ? ' ring-2 ring-primary-500' : '')}
      onClickCapture={(e) => {
        if (!selectionMode) return;
        const t = e.target as HTMLElement;
        if (t.closest('input[type=checkbox]')) return;
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
    >
      <div className="card-content relative">
        {selectionMode && (
          <input type="checkbox" checked={selected} onChange={onToggle} className="absolute left-3 top-3 h-5 w-5 rounded border-gray-300 bg-gray-100 text-primary-500 focus:ring-2 focus:ring-primary-500" />
        )}
        <div className="mb-3 flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h2 className="heading-card truncate text-lg font-semibold text-gray-900 dark:text-white">{list.title}</h2>
              {list.isPermanent && (
                <span
                  className="shrink-0 rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-800 dark:bg-primary-900/40 dark:text-primary-200"
                  title={list.permanentType === 2 ? 'Vorlage: Wird auf Einkaufslisten angewendet, kann nicht gelöscht werden.' : 'Diese Liste kann nicht gelöscht werden. Artikel können nicht abgehakt werden.'}
                >
                  {list.permanentType === 2 ? 'Vorlage' : 'Sammelliste'}
                </span>
              )}
            </div>
            {list.description && <p className="text-muted mb-2 line-clamp-2 text-sm">{list.description}</p>}
          </div>
          {!list.isPermanent && (
            <button onClick={onDelete} aria-label="Einkaufsliste löschen" className="btn-icon text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400">
              {icon(TRASH)}
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

        <div className={'flex space-x-2' + (selectionMode ? ' max-sm:hidden' : '')}>
          <Link to={`/einkaufsliste/${list.id}`} className="btn btn-primary flex-1 text-center">Öffnen</Link>
          <Link to={`/einkaufsliste/${list.id}/bearbeiten`} className="btn btn-secondary" title="Bearbeiten">
            {icon('M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z', 'h-4 w-4')}
          </Link>
        </div>
      </div>
    </div>
  );
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      alert('Bitte geben Sie einen Titel ein.');
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const list = await createLocalShoppingList(title.trim(), description.trim() || undefined);
      onClose();
      onCreated(list.id);
    } catch (err) {
      console.error('Error creating shopping list:', err);
      alert('Fehler beim Erstellen der Einkaufsliste');
      setBusy(false);
    }
  };
  return (
    <div className="modal">
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal-content">
        <div className="modal-header">
          <h2 className="modal-title">Neue Einkaufsliste erstellen</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <form id="create-shopping-list-form" className="modal-body space-y-4" onSubmit={submit}>
          <div>
            <label htmlFor="shopping-list-title" className="form-label">Titel</label>
            <input id="shopping-list-title" autoFocus className="form-input" placeholder="z.B. Wocheneinkauf, Grillparty, ..." value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="shopping-list-description" className="form-label">Beschreibung (optional)</label>
            <textarea id="shopping-list-description" className="form-textarea" rows={3} placeholder="Kurze Beschreibung der Einkaufsliste..." value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </form>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary modal-close" onClick={onClose}>Abbrechen</button>
          <button type="submit" form="create-shopping-list-form" disabled={busy} className="btn btn-success">Erstellen</button>
        </div>
      </div>
    </div>
  );
}

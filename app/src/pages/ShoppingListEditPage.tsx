/**
 * Einkaufsliste bearbeiten — port of src/pages/einkaufsliste/[id]/edit.astro.
 * Title/description, item rows (name/amount/unit/description), linked recipes,
 * add recipe ingredients, delete list. Edits the local replica (offline).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Recipe, ShoppingListItem, Ingredient, IngredientGroup } from '@/types';
import { localShoppingList, localRecipes, updateLocalShoppingList, deleteLocalShoppingList } from '@/lib/localData';
import { runSync } from '@/lib/syncRunner';
import { unitOptions } from '@/lib/unitDisplay';
import { assetUrl } from '@/lib/api';

interface Row {
  key: string;
  /** Existing item id, or undefined for rows added here. */
  id?: string;
  name: string;
  amount: string;
  unit: string;
  description: string;
  showDescription: boolean;
  recipeId?: string;
  /** Recipe title badge for rows added from a recipe in this session. */
  recipeBadge?: string;
}

const TRASH = 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16';
const BOOK =
  'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253';

/** Ingredients of the active (default) alternative + satisfied visibleWhen — same as the website. */
function recipeIngredients(recipe: Recipe): Ingredient[] {
  const out: Ingredient[] = [];
  const optionToGroup: Record<string, string> = {};
  const selection: Record<string, string> = {};
  const hasRealDefault: Record<string, boolean> = {};
  const scan = (items: any[]) =>
    (items || []).forEach((item) => {
      if (item.ingredients) return scan(item.ingredients);
      if (item.alternativeGroupId) {
        optionToGroup[item.id] = item.alternativeGroupId;
        if (!(item.alternativeGroupId in selection)) selection[item.alternativeGroupId] = item.id;
        if (item.isAlternativeDefault && !hasRealDefault[item.alternativeGroupId]) {
          selection[item.alternativeGroupId] = item.id;
          hasRealDefault[item.alternativeGroupId] = true;
        }
      }
    });
  (recipe.ingredientGroups || []).forEach((g) => scan(g.ingredients as any[]));
  const vwOk = (vw: any) => {
    if (!vw || !vw.optionIds || vw.optionIds.length === 0) return true;
    for (const oid of vw.optionIds) {
      const gid = optionToGroup[oid];
      if (!gid || selection[gid] === oid) return true;
    }
    return false;
  };
  const visible = (item: any) => (item.alternativeGroupId && selection[item.alternativeGroupId] !== item.id ? false : vwOk(item.visibleWhen));
  const extract = (group: IngredientGroup | any) => {
    if (group.visibleWhen && !vwOk(group.visibleWhen)) return;
    (group.ingredients || []).forEach((item: any) => {
      if (item.ingredients) extract(item);
      else if (item.name && visible(item)) out.push(item);
    });
  };
  (recipe.ingredientGroups || []).forEach(extract);
  return out;
}

let rowCounter = 0;
const rowKey = () => `new-${rowCounter++}`;

export default function ShoppingListEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: list, isLoading } = useQuery({ queryKey: ['shoppingList', id], queryFn: () => localShoppingList(id!), enabled: !!id });
  const units = useMemo(unitOptions, []);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [removedRecipes, setRemovedRecipes] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [recipeModal, setRecipeModal] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // Initialise the form once from the stored list (later syncs don't clobber edits).
  useEffect(() => {
    if (!list || rows) return;
    setTitle(list.title);
    setDescription(list.description || '');
    setRows(
      list.items.map((it) => ({
        key: it.id,
        id: it.id,
        name: it.name,
        amount: it.quantity?.amount ? String(it.quantity.amount) : '',
        unit: it.quantity?.unit || '',
        description: it.description || '',
        showDescription: !!(it.description && it.description.trim() !== ''),
        recipeId: it.recipeId
      }))
    );
  }, [list, rows]);

  if (isLoading || (list && !rows)) return <p className="text-secondary-500">Lade Liste …</p>;
  if (!list || !rows) {
    return (
      <div className="container-narrow">
        <p className="text-red-600 dark:text-red-400">Liste nicht gefunden.</p>
        <Link to="/einkaufslisten" className="text-primary-600 hover:underline">← Einkaufslisten</Link>
      </div>
    );
  }

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs!.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // Linked recipes = recipes referenced by remaining rows (like the website).
  const linkedRecipes = (() => {
    const seen = new Set<string>();
    const out: { id: string; title: string; image?: string }[] = [];
    for (const r of rows) {
      if (!r.recipeId || seen.has(r.recipeId) || removedRecipes.has(r.recipeId)) continue;
      seen.add(r.recipeId);
      const info = list.recipes?.find((x) => x.id === r.recipeId);
      out.push({ id: r.recipeId, title: info?.title || `Rezept ${r.recipeId}` });
    }
    return out;
  })();

  // Grouping indicators: rows with same name + unit are merged on the list.
  const groupColor = (() => {
    const groups = new Map<string, string[]>();
    for (const r of rows) {
      const name = r.name.toLowerCase().trim();
      const unit = r.unit.toLowerCase().trim();
      if (!name || !unit) continue;
      const k = `${name}_${unit}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r.key);
    }
    const colors = ['bg-blue-100', 'bg-green-100', 'bg-purple-100', 'bg-yellow-100', 'bg-pink-100'];
    const map = new Map<string, { color: string; others: number }>();
    let i = 0;
    groups.forEach((keys) => {
      if (keys.length < 2) return;
      const color = colors[i++ % colors.length];
      keys.forEach((k) => map.set(k, { color, others: keys.length - 1 }));
    });
    return map;
  })();

  const addRow = () => setRows((rs) => [...rs!, { key: rowKey(), name: '', amount: '', unit: '', description: '', showDescription: false }]);

  const deleteRow = (r: Row) => {
    if (!confirm(`Möchten Sie "${r.name || 'diesem Artikel'}" wirklich löschen?`)) return;
    setRows((rs) => rs!.filter((x) => x.key !== r.key));
  };

  const removeRecipe = (rid: string, rtitle: string) => {
    if (!confirm(`Möchten Sie das Rezept "${rtitle}" und alle zugehörigen Zutaten aus der Einkaufsliste entfernen?`)) return;
    setRows((rs) => rs!.filter((r) => r.recipeId !== rid));
    setRemovedRecipes((s) => new Set(s).add(rid));
  };

  const addRecipeRows = (recipe: Recipe) => {
    const ings = recipeIngredients(recipe);
    setRows((rs) => [
      ...rs!,
      ...ings.map((ing) => ({
        key: rowKey(),
        name: ing.name,
        amount: String(ing.quantities?.[0]?.amount || 1),
        unit: ing.quantities?.[0]?.unit || 'Stück',
        description: ing.description || '',
        showDescription: !!(ing.description && ing.description.trim() !== ''),
        recipeBadge: recipe.title
      }))
    ]);
    setRecipeModal(false);
    alert(`${ings.length} Zutaten aus "${recipe.title}" wurden hinzugefügt!`);
  };

  const save = async () => {
    const t = title.trim();
    if (!t) {
      alert('Bitte geben Sie einen Titel ein.');
      titleRef.current?.focus();
      return;
    }
    if (rows.some((r) => !r.name.trim())) {
      alert('Bitte geben Sie einen Namen für alle Artikel ein.');
      return;
    }
    const items: ShoppingListItem[] = rows.map((r) => {
      const original = r.id ? list.items.find((i) => i.id === r.id) : undefined;
      const amount = r.amount && !isNaN(parseFloat(r.amount)) ? parseFloat(r.amount) : null;
      const unit = r.unit.trim() || null;
      // Keep everything the form doesn't edit (note/noteRef, grouping, recipe
      // link, alternatives, product, checked state …).
      const { quantity: _q, description: _d, name: _n, ...keep } = original ?? ({} as ShoppingListItem);
      const item: ShoppingListItem = {
        ...(keep as ShoppingListItem),
        id: original?.id ?? (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
        name: r.name.trim(),
        description: r.description.trim() || undefined,
        isChecked: original?.isChecked || false
      };
      if (amount !== null && unit !== null) item.quantity = { amount, unit };
      return item;
    });
    setSaving(true);
    try {
      await updateLocalShoppingList(list.id, {
        title: t,
        description: description.trim() || undefined,
        items,
        recipes: (list.recipes || []).filter((r) => !removedRecipes.has(r.id))
      });
      queryClient.invalidateQueries();
      runSync().catch(() => {});
      navigate(`/einkaufsliste/${list.id}`);
    } catch (e) {
      console.error('Error saving shopping list:', e);
      alert('Fehler beim Speichern');
      setSaving(false);
    }
  };

  const deleteList = async () => {
    if (!confirm(`Möchten Sie die Einkaufsliste "${list.title}" wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return;
    setDeleting(true);
    const ok = await deleteLocalShoppingList(list.id);
    if (!ok) {
      alert('Fehler beim Löschen');
      setDeleting(false);
      return;
    }
    queryClient.invalidateQueries();
    runSync().catch(() => {});
    navigate('/einkaufslisten');
  };

  return (
    <div className="container-narrow">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:justify-between md:gap-0">
        <div>
          <h1 className="heading-primary">Einkaufsliste bearbeiten</h1>
          <p className="text-muted">Ändern Sie Titel, Beschreibung und Artikel der Einkaufsliste</p>
        </div>
        <div className="flex space-x-2">
          <Link to={`/einkaufsliste/${list.id}`} className="btn btn-ghost">Abbrechen</Link>
          <button onClick={save} disabled={saving} className="btn btn-success">{saving ? 'Speichert...' : 'Speichern'}</button>
        </div>
      </div>

      <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
        <div className="card">
          <div className="card-content space-y-4">
            <div>
              <label htmlFor="edit-title" className="form-label">Titel</label>
              <input ref={titleRef} id="edit-title" className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="edit-description" className="form-label">Beschreibung (optional)</label>
              <textarea id="edit-description" className="form-textarea" rows={3} placeholder="Beschreibung der Einkaufsliste..." value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
        </div>

        {linkedRecipes.length > 0 && (
          <div className="card">
            <div className="card-content">
              <div className="mb-4">
                <h2 className="heading-secondary">Verknüpfte Rezepte</h2>
                <p className="text-muted mt-1 text-sm">Rezepte, die der Einkaufsliste hinzugefügt wurden. Das Entfernen eines Rezepts entfernt alle zugehörigen Zutaten.</p>
              </div>
              <div className="space-y-3">
                {linkedRecipes.map((r) => (
                  <div key={r.id} className="rounded-lg border border-gray-300 p-4 dark:border-gray-600">
                    <div className="flex items-start justify-between">
                      <div className="flex min-w-0 flex-1 items-start space-x-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-200 dark:bg-gray-700">
                          <svg className="h-6 w-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={BOOK} /></svg>
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-medium text-gray-900 dark:text-white">{r.title}</h3>
                          <p className="text-muted text-sm">{rows.filter((x) => x.recipeId === r.id).length} Zutaten in der Liste</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Link to={`/rezept/${r.id}`} className="btn btn-sm btn-ghost" title="Rezept anzeigen">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        </Link>
                        <button type="button" onClick={() => removeRecipe(r.id, r.title)} className="btn btn-sm btn-danger" title="Rezept und alle Zutaten entfernen">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={TRASH} /></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-content">
            <div className="mb-4 flex flex-col gap-4 md:flex-row md:justify-between md:gap-0">
              <div>
                <h2 className="heading-secondary">Artikel ({list.items.length})</h2>
                <p className="text-muted mt-1 text-sm">
                  Artikel mit <span className="inline-flex items-center rounded bg-blue-100 px-2 py-1 text-xs text-blue-800">🍳 Rezept</span> stammen aus einem Rezept. Änderungen an der Menge werden beim Anpassen der Portionen berücksichtigt.
                </p>
              </div>
              <div className="flex flex-col space-y-2 sm:flex-row sm:space-x-2 sm:space-y-0">
                <button type="button" onClick={addRow} className="btn btn-success btn-sm flex items-center space-x-2">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                  <span>Artikel hinzufügen</span>
                </button>
                <button type="button" onClick={() => setRecipeModal(true)} className="btn btn-blue btn-sm flex items-center space-x-2">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={BOOK} /></svg>
                  <span>Rezept hinzufügen</span>
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {rows.map((r, index) => {
                const recipeTitle = r.recipeBadge ?? (r.recipeId ? list.recipes?.find((x) => x.id === r.recipeId)?.title : undefined);
                const grp = groupColor.get(r.key);
                const unitList = r.unit && !units.some((u) => u.name === r.unit) ? [{ name: r.unit, category: '' }, ...units] : units;
                return (
                  <div key={r.key} className={'relative rounded-lg border border-gray-200 p-4 dark:border-gray-700 ' + (index % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50')}>
                    {grp && <div className={`absolute -left-2 top-0 h-full w-1 rounded-l ${grp.color}`} title={`Wird mit ${grp.others} anderen Artikel(n) zusammengefasst`} />}
                    <div className="flex flex-wrap items-end gap-3">
                      <button type="button" onClick={() => update(r.key, { showDescription: !r.showDescription })} className="flex-shrink-0 p-1 text-gray-500 transition-transform hover:text-gray-700 dark:hover:text-gray-300" aria-label="Beschreibung ein-/ausblenden">
                        <svg className="h-5 w-5 transition-transform" style={r.showDescription ? { transform: 'rotate(90deg)' } : undefined} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                      </button>
                      <div className="min-w-[150px] flex-1">
                        <div className="mb-1 flex items-center space-x-2">
                          <label className="form-label text-sm">Name *</label>
                          {recipeTitle && <span className="inline-flex items-center rounded bg-blue-100 px-2 py-1 text-xs text-blue-800" title="Zutat aus Rezept">🍳 {recipeTitle}</span>}
                        </div>
                        <input className="form-input w-full" value={r.name} placeholder="Artikel..." onChange={(e) => update(r.key, { name: e.target.value })} required autoFocus={r.key.startsWith('new-') && !r.name && !r.recipeBadge} />
                      </div>
                      <div className="w-24 sm:w-32">
                        <label className="form-label text-sm">Menge</label>
                        <input type="number" className="form-input w-full" value={r.amount} placeholder="0" step="0.1" min="0" onChange={(e) => update(r.key, { amount: e.target.value })} />
                      </div>
                      <div className="w-28 sm:w-36">
                        <label className="form-label text-sm">Einheit</label>
                        <select className="form-input w-full" value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })}>
                          <option value="">Einheit wählen...</option>
                          {unitList.map((u) => (
                            <option key={u.name} value={u.name}>{u.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {r.showDescription && (
                      <div className="mt-3">
                        <div className="flex items-end gap-3">
                          <div className="flex-1">
                            <label className="form-label text-sm">Beschreibung</label>
                            <input className="form-input w-full" value={r.description} placeholder="Optional..." onChange={(e) => update(r.key, { description: e.target.value })} />
                          </div>
                          <button type="button" onClick={() => deleteRow(r)} className="btn btn-ghost btn-sm flex-shrink-0 text-red-600 hover:bg-red-50 dark:hover:bg-red-900">
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={TRASH} /></svg>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {rows.length === 0 && (
              <div className="rounded-lg border-2 border-dashed border-gray-300 py-8 text-center dark:border-gray-600">
                <svg className="mx-auto mb-3 h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v11a2 2 0 002 2h5.586a1 1 0 00.707-.293l5.414-5.414a1 1 0 00.293-.707V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                <p className="text-muted">Noch keine Artikel hinzugefügt</p>
                <p className="text-muted text-sm">Klicken Sie auf "Artikel hinzufügen" um zu beginnen</p>
              </div>
            )}
          </div>
        </div>

        {!list.isPermanent && (
          <div className="card border-red-200 dark:border-red-800">
            <div className="card-content">
              <h3 className="mb-2 text-lg font-semibold text-red-600 dark:text-red-400">Gefährlicher Bereich</h3>
              <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">Das Löschen der Einkaufsliste kann nicht rückgängig gemacht werden.</p>
              <button type="button" onClick={deleteList} disabled={deleting} className="btn btn-danger">{deleting ? 'Löscht...' : 'Einkaufsliste löschen'}</button>
            </div>
          </div>
        )}
      </form>

      {recipeModal && <AddRecipeRowsModal onClose={() => setRecipeModal(false)} onAdd={addRecipeRows} />}
    </div>
  );
}

function AddRecipeRowsModal({ onClose, onAdd }: { onClose: () => void; onAdd: (r: Recipe) => void }) {
  const { data: recipes } = useQuery({ queryKey: ['recipes'], queryFn: localRecipes });
  const [q, setQ] = useState('');
  const filtered = (recipes ?? []).filter((r) => {
    const t = q.toLowerCase();
    return !t || r.title.toLowerCase().includes(t) || r.description?.toLowerCase().includes(t) || recipeIngredients(r).some((i) => i.name.toLowerCase().includes(t));
  });
  return (
    <div className="modal">
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal-content modal-lg">
        <div className="modal-header">
          <h2 className="modal-title">Rezept hinzufügen</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          {!recipes ? (
            <div className="py-8 text-center">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-orange-500" />
              <p className="text-muted mt-2">Rezepte werden geladen...</p>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <input className="form-input" placeholder="Rezepte durchsuchen..." value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              {filtered.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-muted">Keine Rezepte gefunden</p>
                </div>
              ) : (
                <div className="max-h-96 space-y-3 overflow-y-auto">
                  {filtered.map((recipe) => (
                    <div key={recipe.id} className="recipe-card cursor-pointer rounded-lg border border-gray-300 p-4 transition-colors hover:border-orange-500 dark:border-gray-600">
                      <div className="flex items-start space-x-3">
                        {recipe.images && recipe.images.length > 0 ? (
                          <img src={assetUrl(recipe.images[0].url)} alt={recipe.title} className="h-16 w-16 rounded-lg object-cover" />
                        ) : (
                          <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-gray-200 dark:bg-gray-700">
                            <svg className="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-medium text-gray-900 dark:text-white">{recipe.title}</h3>
                          <p className="text-muted mt-1 text-sm">{recipeIngredients(recipe).length} Zutaten</p>
                          {recipe.description && <p className="text-muted mt-1 line-clamp-2 text-sm">{recipe.description}</p>}
                        </div>
                        <button type="button" onClick={() => onAdd(recipe)} className="btn btn-sm btn-success">Hinzufügen</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary modal-close" onClick={onClose}>Schließen</button>
        </div>
      </div>
    </div>
  );
}

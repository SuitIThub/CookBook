import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ShoppingListItem } from '@/types';
import {
  localShoppingList,
  localRecipes,
  updateLocalShoppingList,
  addRecipeToLocalShoppingList,
  removeRecipeFromLocalShoppingList,
  setLocalRecipeServings,
  addItemToLocalShoppingList
} from '@/lib/localData';
import { runSync } from '@/lib/syncRunner';
import ShoppingListMarketPanel from '@/components/ShoppingListMarketPanel';

function formatAmount(n: number): string {
  const r = Math.round(n * 100) / 100;
  return (Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/\.?0+$/, '')).replace('.', ',');
}

export default function ShoppingListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: list, isLoading, isError } = useQuery({
    queryKey: ['shoppingList', id],
    queryFn: () => localShoppingList(id!),
    enabled: !!id
  });
  const { data: recipes } = useQuery({ queryKey: ['recipes'], queryFn: localRecipes });

  const [addRecipeId, setAddRecipeId] = useState('');
  const [search, setSearch] = useState('');
  const [hideChecked, setHideChecked] = useState(false);
  const [itemName, setItemName] = useState('');
  const [itemAmount, setItemAmount] = useState('');
  const [itemUnit, setItemUnit] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['shoppingList', id] });
    queryClient.invalidateQueries({ queryKey: ['shoppingLists'] });
    runSync().catch(() => {});
  };

  const addable = useMemo(() => {
    const inList = new Set((list?.recipes ?? []).map((r) => r.id));
    return (recipes ?? []).filter((r) => !r.parentRecipeId && !inList.has(r.id));
  }, [recipes, list]);

  if (isLoading) return <p className="text-secondary-500">Lade Liste …</p>;
  if (isError || !list) {
    return (
      <div>
        <p className="text-red-600 dark:text-red-400">Liste nicht gefunden.</p>
        <Link to="/einkaufslisten" className="text-primary-600 hover:underline">← Einkaufslisten</Link>
      </div>
    );
  }

  const toggleItem = async (itemId: string) => {
    if (list.isPermanent) return; // permanent lists can't be crossed off
    const items = list.items.map((it) => (it.id === itemId ? { ...it, isChecked: !it.isChecked } : it));
    await updateLocalShoppingList(list.id, { items });
    refresh();
  };

  const removeItem = async (itemId: string) => {
    const items = list.items.filter((it) => it.id !== itemId);
    await updateLocalShoppingList(list.id, { items });
    refresh();
  };

  const addRecipe = async () => {
    if (!addRecipeId || busy) return;
    setBusy(true);
    try {
      await addRecipeToLocalShoppingList(list.id, addRecipeId);
      setAddRecipeId('');
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const removeRecipe = async (recipeId: string) => {
    await removeRecipeFromLocalShoppingList(list.id, recipeId);
    refresh();
  };

  const changeServings = async (recipeId: string, servings: number) => {
    if (servings < 1) return;
    await setLocalRecipeServings(list.id, recipeId, servings);
    refresh();
  };

  const addManualItem = async () => {
    const name = itemName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const amount = Number(itemAmount.replace(',', '.'));
      const item: Omit<ShoppingListItem, 'id'> = {
        name,
        isChecked: false,
        quantity: itemAmount.trim() && Number.isFinite(amount) ? { amount, unit: itemUnit.trim() } : undefined
      };
      await addItemToLocalShoppingList(list.id, item);
      setItemName('');
      setItemAmount('');
      setItemUnit('');
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const unchecked = list.items.filter((i) => !i.isChecked);
  const checked = list.items.filter((i) => i.isChecked);
  const visibleUnchecked = search.trim()
    ? unchecked.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))
    : unchecked;
  const visibleChecked = search.trim()
    ? checked.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))
    : checked;

  const ItemRow = ({ item }: { item: ShoppingListItem }) => (
    <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800">
      <input
        type="checkbox"
        checked={!!item.isChecked}
        disabled={list.isPermanent}
        onChange={() => toggleItem(item.id)}
        className="h-5 w-5 shrink-0 rounded border-gray-300 text-orange-500 focus:ring-2 focus:ring-orange-500 disabled:opacity-50"
      />
      <span className={'min-w-0 flex-1 truncate ' + (item.isChecked ? 'text-gray-400 line-through dark:text-gray-500' : 'text-gray-900 dark:text-gray-100')}>
        {item.name}
      </span>
      {item.recipeId && (
        <Link to={`/rezept/${item.recipeId}`} title="Aus Rezept" className="shrink-0 text-blue-500 hover:text-blue-700 dark:text-blue-400">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
        </Link>
      )}
      {item.quantity && (
        <span className="shrink-0 rounded bg-gray-100 px-2 py-1 text-sm font-medium tabular-nums text-gray-700 dark:bg-gray-700 dark:text-gray-200">
          {formatAmount(item.quantity.amount)} {item.quantity.unit}
        </span>
      )}
      <button onClick={() => removeItem(item.id)} aria-label="Artikel entfernen" className="btn-icon shrink-0 text-gray-400 hover:text-red-500">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      <Link to="/einkaufslisten" className="inline-flex items-center gap-1 text-sm text-orange-600 hover:underline dark:text-orange-400">← Einkaufslisten</Link>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="heading-primary">{list.title}</h1>
          {list.isPermanent && (
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-900/40 dark:text-orange-200">
              {list.permanentType === 2 ? 'Vorlage' : 'Sammelliste'}
            </span>
          )}
        </div>
        {list.description && <p className="text-muted mt-1">{list.description}</p>}
        <p className="text-muted mt-1 text-sm">{unchecked.length} von {list.items.length} Artikeln offen</p>
      </div>

      {/* Supermarket price estimation */}
      <ShoppingListMarketPanel list={list} onChanged={refresh} />

      {/* Recipes */}
      {(list.recipes.length > 0 || addable.length > 0) && (
        <div className="card">
          <div className="card-content">
            <h2 className="heading-secondary mb-4">Rezepte</h2>
            {list.recipes.length === 0 ? (
              <p className="text-muted text-sm">Keine Rezepte hinzugefügt.</p>
            ) : (
              <div className="space-y-3">
                {list.recipes.map((r) => (
                  <div key={r.id} className="rounded-lg border border-gray-300 p-4 transition-all hover:shadow-sm dark:border-gray-600">
                    <div className="flex items-center justify-between gap-3">
                      <Link to={`/rezept/${r.id}`} className="min-w-0 flex-1 truncate font-medium text-gray-900 hover:text-orange-600 dark:text-white dark:hover:text-orange-400">{r.title}</Link>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        <span className="text-sm text-gray-600 dark:text-gray-400">Portionen:</span>
                        <button onClick={() => changeServings(r.id, (r.currentServings ?? r.servings) - 1)} className="flex h-7 w-7 items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700" aria-label="weniger Portionen">−</button>
                        <span className="min-w-[2rem] text-center tabular-nums text-gray-900 dark:text-white">{r.currentServings ?? r.servings}</span>
                        <button onClick={() => changeServings(r.id, (r.currentServings ?? r.servings) + 1)} className="flex h-7 w-7 items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700" aria-label="mehr Portionen">+</button>
                        <button onClick={() => removeRecipe(r.id)} aria-label="Rezept entfernen" className="btn-icon text-gray-400 hover:text-red-500">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">Originalportionen: {r.servings}</p>
                  </div>
                ))}
              </div>
            )}
            {addable.length > 0 && (
              <div className="mt-4 flex gap-2">
                <select value={addRecipeId} onChange={(e) => setAddRecipeId(e.target.value)} className="form-select flex-1">
                  <option value="">Rezept hinzufügen …</option>
                  {addable.map((r) => (
                    <option key={r.id} value={r.id}>{r.title}</option>
                  ))}
                </select>
                <button onClick={addRecipe} disabled={!addRecipeId || busy} className="btn btn-primary disabled:opacity-50">Hinzufügen</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Controls */}
      {!list.isPermanent && (
        <div className="card">
          <div className="card-content">
            <label className="flex cursor-pointer items-center space-x-3">
              <input type="checkbox" checked={hideChecked} onChange={(e) => setHideChecked(e.target.checked)} className="h-5 w-5 rounded border-gray-300 text-orange-500 focus:ring-2 focus:ring-orange-500" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Erledigte Artikel ausblenden</span>
            </label>
          </div>
        </div>
      )}

      {/* Items */}
      <div className="card">
        <div className="card-content">
          <h2 className="heading-secondary mb-4">Einkaufsliste ({list.items.length} Artikel)</h2>

          <div className="mb-4">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Zutaten durchsuchen..."
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-orange-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>

          {/* Add manual item */}
          <div className="mb-4 flex flex-wrap gap-2">
            <input className="w-20 rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white" placeholder="Menge" inputMode="decimal" value={itemAmount} onChange={(e) => setItemAmount(e.target.value)} />
            <input className="w-20 rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white" placeholder="Einheit" value={itemUnit} onChange={(e) => setItemUnit(e.target.value)} />
            <input className="min-w-[8rem] flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white" placeholder="Artikel hinzufügen …" value={itemName} onChange={(e) => setItemName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addManualItem()} />
            <button onClick={addManualItem} disabled={!itemName.trim() || busy} className="btn btn-success disabled:opacity-50">+ Hinzufügen</button>
          </div>

          <div className="space-y-2">
            {visibleUnchecked.map((it) => <ItemRow key={it.id} item={it} />)}
          </div>
          {unchecked.length === 0 && <p className="text-muted text-sm">Alles erledigt 🎉</p>}

          {!hideChecked && visibleChecked.length > 0 && (
            <details className="mt-4" open>
              <summary className="text-muted mb-2 cursor-pointer text-sm">Erledigt ({checked.length})</summary>
              <div className="space-y-2">
                {visibleChecked.map((it) => <ItemRow key={it.id} item={it} />)}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

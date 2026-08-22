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

  const ItemRow = ({ item }: { item: ShoppingListItem }) => (
    <li className="flex items-center gap-3 py-1.5">
      <input
        type="checkbox"
        checked={!!item.isChecked}
        disabled={list.isPermanent}
        onChange={() => toggleItem(item.id)}
        className="h-4 w-4 shrink-0 accent-primary-600 disabled:opacity-50"
      />
      <span className={'flex-1 ' + (item.isChecked ? 'text-secondary-400 line-through' : '')}>
        {item.quantity && (
          <span className="mr-2 tabular-nums text-secondary-500">
            {formatAmount(item.quantity.amount)} {item.quantity.unit}
          </span>
        )}
        {item.name}
      </span>
      <button
        onClick={() => removeItem(item.id)}
        aria-label="Artikel entfernen"
        className="shrink-0 rounded px-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
      >
        ✕
      </button>
    </li>
  );

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/einkaufslisten" className="text-sm text-primary-600 hover:underline">← Einkaufslisten</Link>
      <div className="mt-2 flex items-center gap-2">
        <h1 className="text-2xl font-bold">{list.title}</h1>
        {list.isPermanent && (
          <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
            Dauerliste
          </span>
        )}
      </div>

      {/* Recipes */}
      <section className="mt-6">
        <h2 className="mb-2 text-lg font-semibold">Rezepte</h2>
        {list.recipes.length === 0 ? (
          <p className="text-sm text-secondary-500">Keine Rezepte hinzugefügt.</p>
        ) : (
          <ul className="space-y-1">
            {list.recipes.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-lg border border-secondary-200 p-2 dark:border-secondary-700">
                <Link to={`/rezept/${r.id}`} className="flex-1 truncate text-sm font-medium text-primary-600 hover:underline">
                  {r.title}
                </Link>
                <div className="flex items-center gap-1 text-sm">
                  <button
                    onClick={() => changeServings(r.id, (r.currentServings ?? r.servings) - 1)}
                    className="flex h-6 w-6 items-center justify-center rounded border border-secondary-300 dark:border-secondary-600"
                    aria-label="weniger Portionen"
                  >
                    −
                  </button>
                  <span className="min-w-[3.5rem] text-center tabular-nums">{r.currentServings ?? r.servings} Pt.</span>
                  <button
                    onClick={() => changeServings(r.id, (r.currentServings ?? r.servings) + 1)}
                    className="flex h-6 w-6 items-center justify-center rounded border border-secondary-300 dark:border-secondary-600"
                    aria-label="mehr Portionen"
                  >
                    +
                  </button>
                </div>
                <button
                  onClick={() => removeRecipe(r.id)}
                  aria-label="Rezept entfernen"
                  className="rounded px-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {addable.length > 0 && (
          <div className="mt-2 flex gap-2">
            <select
              value={addRecipeId}
              onChange={(e) => setAddRecipeId(e.target.value)}
              className="flex-1 rounded-lg border border-secondary-300 bg-white px-3 py-2 text-sm dark:border-secondary-600 dark:bg-secondary-800 dark:text-white"
            >
              <option value="">Rezept hinzufügen …</option>
              {addable.map((r) => (
                <option key={r.id} value={r.id}>{r.title}</option>
              ))}
            </select>
            <button
              onClick={addRecipe}
              disabled={!addRecipeId || busy}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              Hinzufügen
            </button>
          </div>
        )}
      </section>

      {/* Items */}
      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold">
          Artikel <span className="text-sm font-normal text-secondary-500">{unchecked.length} offen</span>
        </h2>
        <ul className="divide-y divide-secondary-100 dark:divide-secondary-800">
          {unchecked.map((it) => <ItemRow key={it.id} item={it} />)}
        </ul>
        {unchecked.length === 0 && <p className="text-sm text-secondary-500">Alles erledigt 🎉</p>}

        {checked.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-secondary-500">Erledigt ({checked.length})</summary>
            <ul className="mt-1 divide-y divide-secondary-100 dark:divide-secondary-800">
              {checked.map((it) => <ItemRow key={it.id} item={it} />)}
            </ul>
          </details>
        )}

        {/* Add manual item */}
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            className="w-20 rounded-lg border border-secondary-300 bg-white px-2 py-2 text-sm dark:border-secondary-600 dark:bg-secondary-800 dark:text-white"
            placeholder="Menge"
            inputMode="decimal"
            value={itemAmount}
            onChange={(e) => setItemAmount(e.target.value)}
          />
          <input
            className="w-20 rounded-lg border border-secondary-300 bg-white px-2 py-2 text-sm dark:border-secondary-600 dark:bg-secondary-800 dark:text-white"
            placeholder="Einheit"
            value={itemUnit}
            onChange={(e) => setItemUnit(e.target.value)}
          />
          <input
            className="min-w-[8rem] flex-1 rounded-lg border border-secondary-300 bg-white px-3 py-2 text-sm dark:border-secondary-600 dark:bg-secondary-800 dark:text-white"
            placeholder="Artikel hinzufügen …"
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addManualItem()}
          />
          <button
            onClick={addManualItem}
            disabled={!itemName.trim() || busy}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            +
          </button>
        </div>
      </section>
    </div>
  );
}

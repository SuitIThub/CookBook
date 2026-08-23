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
  const [groupMode, setGroupMode] = useState(false);
  const [groupSel, setGroupSel] = useState<Set<string>>(new Set());
  const [showSuggest, setShowSuggest] = useState(false);
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

  /* ---- grouping ------------------------------------------------------------
     Two layers, matching the website:
     - Auto grouping: ungrouped items with the same (case-insensitive) name are
       merged into one display line with summed quantities.
     - Manual grouping: items sharing a manualGroupId are merged (names joined).
     "Gruppierung vorschlagen" suggests manual groups by name similarity. */
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  const anyGrouped = list.items.some((i) => i.manualGroupId);

  const setItems = (items: ShoppingListItem[]) => updateLocalShoppingList(list.id, { items }).then(refresh);
  const ungroupAll = () => setItems(list.items.map(({ manualGroupId, ...rest }) => rest));
  const toggleGroupChecked = (ids: string[], next: boolean) => {
    const set = new Set(ids);
    return setItems(list.items.map((i) => (set.has(i.id) ? { ...i, isChecked: next } : i)));
  };
  const removeGroup = (ids: string[]) => {
    const set = new Set(ids);
    return setItems(list.items.filter((i) => !set.has(i.id)));
  };
  const toggleGroupSel = (key: string) =>
    setGroupSel((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  interface Unit {
    key: string;
    items: ShoppingListItem[];
    isManual: boolean;
  }
  const buildUnits = (items: ShoppingListItem[]): Unit[] => {
    const map = new Map<string, Unit>();
    const order: string[] = [];
    for (const it of items) {
      const key = it.manualGroupId ? 'm:' + it.manualGroupId : 'n:' + it.name.toLowerCase().trim();
      if (!map.has(key)) {
        map.set(key, { key, items: [], isManual: !!it.manualGroupId });
        order.push(key);
      }
      map.get(key)!.items.push(it);
    }
    return order.map((k) => map.get(k)!);
  };
  const groupQty = (items: ShoppingListItem[]): string => {
    const byUnit = new Map<string, number>();
    for (const it of items) if (it.quantity) byUnit.set(it.quantity.unit || '', (byUnit.get(it.quantity.unit || '') ?? 0) + it.quantity.amount);
    return Array.from(byUnit.entries()).map(([u, a]) => `${formatAmount(a)} ${u}`.trim()).join(', ');
  };
  const unitChecked = (u: Unit) => u.items.every((i) => i.isChecked);
  const unitName = (u: Unit) => (u.isManual ? u.items.map((i) => i.name).join(', ') : u.items[0].name);
  const unitMatches = (u: Unit) => {
    const needle = search.trim().toLowerCase();
    return !needle || u.items.some((i) => i.name.toLowerCase().includes(needle));
  };

  const confirmGroup = async () => {
    // Selected units (by key) → assign one shared manualGroupId to all their items.
    const units = buildUnits(list.items).filter((u) => groupSel.has(u.key));
    const ids = new Set(units.flatMap((u) => u.items.map((i) => i.id)));
    if (units.length < 2 || ids.size < 2) return;
    const gid = uid();
    await setItems(list.items.map((i) => (ids.has(i.id) ? { ...i, manualGroupId: gid } : i)));
    setGroupMode(false);
    setGroupSel(new Set());
  };

  /** Apply accepted suggestion groups: each becomes a new manualGroupId. */
  const applySuggestions = async (groups: ShoppingListItem[][]) => {
    const assign = new Map<string, string>(); // itemId -> gid
    for (const g of groups) {
      const gid = uid();
      for (const it of g) assign.set(it.id, gid);
    }
    await setItems(list.items.map((i) => (assign.has(i.id) ? { ...i, manualGroupId: assign.get(i.id)! } : i)));
    setShowSuggest(false);
  };

  const allUnits = buildUnits(list.items).filter(unitMatches);
  const uncheckedUnits = allUnits.filter((u) => !unitChecked(u));
  const checkedUnits = allUnits.filter((u) => unitChecked(u));
  const unchecked = list.items.filter((i) => !i.isChecked);
  const checked = list.items.filter((i) => i.isChecked);

  const recipeIcon = (recipeId: string) => (
    <Link to={`/rezept/${recipeId}`} title="Aus Rezept" className="shrink-0 text-blue-500 hover:text-blue-700 dark:text-blue-400">
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
    </Link>
  );

  const UnitRow = ({ unit }: { unit: Unit }) => {
    const ischk = unitChecked(unit);
    const ids = unit.items.map((i) => i.id);
    const qty = groupQty(unit.items);
    const recipeId = unit.items.length === 1 ? unit.items[0].recipeId : undefined;
    return (
      <div className={'flex items-center gap-3 rounded-lg border px-3 py-2.5 ' + (unit.isManual ? 'border-orange-200 bg-orange-50/40 dark:border-orange-900/50 dark:bg-orange-900/10' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800')}>
        {groupMode ? (
          <input type="checkbox" checked={groupSel.has(unit.key)} onChange={() => toggleGroupSel(unit.key)} className="h-5 w-5 shrink-0 rounded border-gray-300 text-orange-500 focus:ring-2 focus:ring-orange-500" />
        ) : (
          <input type="checkbox" checked={ischk} disabled={list.isPermanent} onChange={() => toggleGroupChecked(ids, !ischk)} className="h-5 w-5 shrink-0 rounded border-gray-300 text-orange-500 focus:ring-2 focus:ring-orange-500 disabled:opacity-50" />
        )}
        <span className={'min-w-0 flex-1 truncate ' + (ischk ? 'text-gray-400 line-through dark:text-gray-500' : 'text-gray-900 dark:text-gray-100')}>
          {unit.isManual && <span className="mr-1.5 rounded bg-orange-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-orange-800 dark:bg-orange-800 dark:text-orange-100">Gruppe</span>}
          {unitName(unit)}
        </span>
        {recipeId && recipeIcon(recipeId)}
        {qty && <span className="shrink-0 rounded bg-gray-100 px-2 py-1 text-sm font-medium tabular-nums text-gray-700 dark:bg-gray-700 dark:text-gray-200">{qty}</span>}
        <button onClick={() => removeGroup(ids)} aria-label="Entfernen" className="btn-icon shrink-0 text-gray-400 hover:text-red-500">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
    );
  };

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
          <div className="card-content flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex cursor-pointer items-center space-x-3">
              <input type="checkbox" checked={hideChecked} onChange={(e) => setHideChecked(e.target.checked)} className="h-5 w-5 rounded border-gray-300 text-orange-500 focus:ring-2 focus:ring-orange-500" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Erledigte Artikel ausblenden</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {groupMode ? (
                <>
                  <button onClick={confirmGroup} disabled={groupSel.size < 2} className="btn btn-success btn-sm disabled:opacity-50">Gruppierung bestätigen</button>
                  <button onClick={() => { setGroupMode(false); setGroupSel(new Set()); }} className="btn btn-secondary btn-sm">Abbrechen</button>
                  <span className="text-sm text-gray-600 dark:text-gray-400">{groupSel.size} ausgewählt</span>
                </>
              ) : (
                <>
                  <button onClick={() => setShowSuggest(true)} className="btn btn-secondary btn-sm flex items-center gap-2">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                    <span>Gruppierung vorschlagen</span>
                  </button>
                  <button onClick={() => setGroupMode(true)} className="btn btn-secondary btn-sm flex items-center gap-2">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                    <span>Gruppieren</span>
                  </button>
                  {anyGrouped && <button onClick={ungroupAll} className="btn btn-secondary btn-sm">Gruppierung aufheben</button>}
                </>
              )}
            </div>
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

          {groupMode && <p className="mb-2 text-sm text-orange-600 dark:text-orange-400">Wähle mindestens zwei Artikel und bestätige die Gruppierung.</p>}

          <div className="space-y-2">
            {uncheckedUnits.map((u) => <UnitRow key={u.key} unit={u} />)}
          </div>
          {unchecked.length === 0 && <p className="text-muted text-sm">Alles erledigt 🎉</p>}

          {!hideChecked && checkedUnits.length > 0 && (
            <details className="mt-4" open>
              <summary className="text-muted mb-2 cursor-pointer text-sm">Erledigt ({checked.length})</summary>
              <div className="space-y-2">
                {checkedUnits.map((u) => <UnitRow key={u.key} unit={u} />)}
              </div>
            </details>
          )}
        </div>
      </div>

      {showSuggest && <SuggestGroupingModal items={list.items} onClose={() => setShowSuggest(false)} onApply={applySuggestions} />}
    </div>
  );
}

/* --------------------------------- Gruppierungsvorschläge (suggest modal) */

function similarity(a: string, b: string): number {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();
  if (s1 === s2) return 1;
  if (!s1.length || !s2.length) return 0;
  const m: number[][] = [];
  for (let i = 0; i <= s2.length; i++) m[i] = [i];
  for (let j = 0; j <= s1.length; j++) m[0][j] = j;
  for (let i = 1; i <= s2.length; i++)
    for (let j = 1; j <= s1.length; j++)
      m[i][j] = s2[i - 1] === s1[j - 1] ? m[i - 1][j - 1] : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
  return 1 - m[s2.length][s1.length] / Math.max(s1.length, s2.length);
}

interface Suggestion {
  id: string;
  items: ShoppingListItem[];
  similarity: number;
}

/** Suggest manual groups by name similarity (mirrors GroupingSuggestionModal). */
function suggestGroups(items: ShoppingListItem[]): Suggestion[] {
  const THRESHOLD = 0.6;
  const out: Suggestion[] = [];
  const processed = new Set<string>();
  const sameGroup = (a: ShoppingListItem, b: ShoppingListItem) => {
    if (a.manualGroupId && b.manualGroupId) return a.manualGroupId === b.manualGroupId;
    if (!a.manualGroupId && !b.manualGroupId) return a.name.toLowerCase().trim() === b.name.toLowerCase().trim();
    return false;
  };
  for (let i = 0; i < items.length; i++) {
    if (processed.has(items[i].id)) continue;
    const group = [items[i]];
    processed.add(items[i].id);
    for (let j = i + 1; j < items.length; j++) {
      if (processed.has(items[j].id) || sameGroup(items[i], items[j])) continue;
      if (similarity(items[i].name, items[j].name) >= THRESHOLD) {
        group.push(items[j]);
        processed.add(items[j].id);
      }
    }
    if (group.length >= 2) {
      let tot = 0;
      let cnt = 0;
      for (let k = 0; k < group.length; k++)
        for (let l = k + 1; l < group.length; l++) {
          tot += similarity(group[k].name, group[l].name);
          cnt++;
        }
      out.push({ id: uidStatic(), items: group, similarity: cnt ? tot / cnt : 0 });
    }
  }
  return out;
}
const uidStatic = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

function SuggestGroupingModal({
  items,
  onClose,
  onApply
}: {
  items: ShoppingListItem[];
  onClose: () => void;
  onApply: (groups: ShoppingListItem[][]) => void;
}) {
  const suggestions = useMemo(() => suggestGroups(items), [items]);
  const [accepted, setAccepted] = useState<Set<string>>(() => new Set(suggestions.map((s) => s.id)));

  const toggle = (id: string) =>
    setAccepted((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const acceptAll = () => onApply(suggestions.filter((s) => accepted.has(s.id)).map((s) => s.items));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Gruppierungsvorschläge</h2>
          <button onClick={onClose} className="text-2xl leading-none text-gray-500 hover:text-gray-800 dark:text-gray-300">&times;</button>
        </div>

        {suggestions.length === 0 ? (
          <div className="py-8 text-center text-muted">Keine Gruppierungsvorschläge gefunden.</div>
        ) : (
          <>
            <p className="text-muted mb-4 text-sm">Vorschläge nach Namensähnlichkeit. Einzelne Vorschläge akzeptieren oder ablehnen.</p>
            <div className="max-h-96 space-y-3 overflow-y-auto">
              {suggestions.map((s) => {
                const on = accepted.has(s.id);
                return (
                  <div key={s.id} className={'rounded-lg border p-4 ' + (on ? 'border-gray-300 dark:border-gray-600' : 'border-gray-200 opacity-50 dark:border-gray-700')}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <label className="mb-2 flex items-center gap-2">
                          <input type="checkbox" checked={on} onChange={() => toggle(s.id)} className="h-5 w-5 rounded border-gray-300 text-green-600 focus:ring-2 focus:ring-green-500" />
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{s.items.length} Artikel</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">({Math.round(s.similarity * 100)}% Ähnlichkeit)</span>
                        </label>
                        <div className="ml-7 space-y-1">
                          {s.items.map((it) => (
                            <div key={it.id} className="text-sm text-gray-600 dark:text-gray-400">
                              <span className="font-medium">{it.name}</span>
                              {it.quantity && it.quantity.amount !== 0 && <span className="ml-1 text-gray-500">{it.quantity.amount} {it.quantity.unit}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                      <button onClick={() => toggle(s.id)} title="Vorschlag ablehnen" className="text-red-600 hover:text-red-700">
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={acceptAll} disabled={accepted.size === 0 || suggestions.length === 0} className="btn btn-success disabled:opacity-50">Alle akzeptieren</button>
          <button onClick={onClose} className="btn btn-secondary">Abbrechen</button>
        </div>
      </div>
    </div>
  );
}

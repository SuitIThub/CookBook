import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Recipe } from '@/types';
import {
  localRecipes,
  deleteLocalRecipe,
  localShoppingLists,
  createLocalShoppingList,
  addRecipeToLocalShoppingList
} from '@/lib/localData';
import { runSync } from '@/lib/syncRunner';
import { exportRecipeJson } from '@/lib/recipeExport';
import RecipeCard from '@/components/recipe_list/RecipeCard';
import ImportModal from '@/components/ImportModal';
import AddToShoppingListModal from '@/components/AddToShoppingListModal';

const LAYOUT_KEY = 'cookbook.recipes.layout';
type View = 'grid' | 'list';
type CatMode = 'none' | 'collapsible' | 'tabs';

function readLayout(): { view: View; categoryMode: CatMode } {
  try {
    const p = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
    return {
      view: p?.view === 'list' ? 'list' : 'grid',
      categoryMode: ['none', 'collapsible', 'tabs'].includes(p?.categoryMode) ? p.categoryMode : 'none'
    };
  } catch {
    return { view: 'grid', categoryMode: 'none' };
  }
}
function writeLayout(patch: Partial<{ view: View; categoryMode: CatMode }>) {
  try {
    const p = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ ...p, ...patch }));
  } catch {
    /* ignore */
  }
}

const UNCATEGORIZED = 'Ohne Kategorie';

export default function RecipesPage() {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['recipes'], queryFn: localRecipes });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const initial = readLayout();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [view, setView] = useState<View>(initial.view);
  const [catMode, setCatMode] = useState<CatMode>(initial.categoryMode);
  const [showImport, setShowImport] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [addToListFor, setAddToListFor] = useState<Recipe | null>(null);

  const originals = useMemo(() => (data ?? []).filter((r) => !r.parentRecipeId), [data]);

  const categories = useMemo(
    () => Array.from(new Set(originals.map((r) => r.category).filter((c): c is string => !!c))).sort((a, b) => a.localeCompare(b, 'de')),
    [originals]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return originals.filter((r) => {
      if (category && (r.category ?? '') !== category) return false;
      if (!needle) return true;
      return (
        r.title.toLowerCase().includes(needle) ||
        (r.description ?? '').toLowerCase().includes(needle) ||
        (r.tags ?? []).some((t) => t.toLowerCase().includes(needle))
      );
    });
  }, [originals, q, category]);

  const grouped = useMemo(() => {
    const map = new Map<string, Recipe[]>();
    for (const r of filtered) {
      const cat = r.category || UNCATEGORIZED;
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(r);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], 'de'));
  }, [filtered]);

  const setViewMode = (v: View) => {
    setView(v);
    writeLayout({ view: v });
  };
  const setCategoryMode = (m: CatMode) => {
    setCatMode(m);
    writeLayout({ categoryMode: m });
    if (m === 'tabs') setActiveTab((t) => t ?? grouped[0]?.[0] ?? null);
  };

  const onImported = async (recipeId: string) => {
    setShowImport(false);
    await runSync();
    queryClient.invalidateQueries();
    navigate(`/rezept/${recipeId}`);
  };

  const randomRecipe = () => {
    if (originals.length === 0) return;
    navigate(`/rezept/${originals[Math.floor(Math.random() * originals.length)].id}`);
  };

  const deleteRecipe = async (r: Recipe) => {
    if (!confirm(`Rezept „${r.title}“ wirklich löschen?`)) return;
    await deleteLocalRecipe(r.id);
    queryClient.invalidateQueries();
  };

  const toggleSelect = (id: string) =>
    setSelectedIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const bulkExport = () => {
    for (const r of filtered) if (selectedIds.has(r.id)) exportRecipeJson(r);
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  if (isLoading) return <p className="text-muted">Lade Rezepte …</p>;
  if (isError) return <p className="text-red-600 dark:text-red-400">Fehler beim Laden: {(error as Error).message}</p>;

  const cardProps = {
    selectionMode,
    onToggleSelect: toggleSelect,
    onAddToList: (r: Recipe) => setAddToListFor(r),
    onDeleted: deleteRecipe
  };
  const renderGrid = (recipes: Recipe[]) => (
    <div className={'recipe-cards-container ' + (view === 'list' ? 'view-list' : 'view-grid')}>
      {recipes.map((r) => (
        <RecipeCard key={r.id} recipe={r} selected={selectedIds.has(r.id)} {...cardProps} />
      ))}
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-0">
        <div>
          <h1 className="heading-primary">Meine Rezepte</h1>
          <p className="mt-1 text-muted">{filtered.length} Rezepte gefunden</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selectionMode ? (
            <>
              <button onClick={bulkExport} disabled={selectedIds.size === 0} className="btn btn-primary flex items-center gap-2 disabled:opacity-50">
                Exportieren ({selectedIds.size})
              </button>
              <button onClick={() => { setSelectionMode(false); setSelectedIds(new Set()); }} className="btn btn-secondary">Abbrechen</button>
            </>
          ) : (
            <>
              <button onClick={() => setSelectionMode(true)} className="btn btn-secondary flex flex-1 items-center justify-center gap-2 md:flex-none">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                <span>Auswählen</span>
              </button>
              <button onClick={randomRecipe} className="btn btn-secondary flex flex-1 items-center justify-center gap-2 md:flex-none">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                <span>Zufälliges Rezept</span>
              </button>
              <Link to="/rezept/neu" className="btn btn-primary flex flex-1 items-center justify-center gap-2 md:flex-none">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                <span>Neues Rezept</span>
              </Link>
              <button onClick={() => setShowImport(true)} className="btn btn-secondary flex flex-1 items-center justify-center gap-2 md:flex-none">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" /></svg>
                <span>Importieren</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Search + category filter */}
      <div className="mt-6 flex flex-col gap-4 sm:flex-row">
        <div className="flex-1">
          <input type="text" className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-orange-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100" placeholder="Rezept suchen..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="w-full sm:w-48">
          <select className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-orange-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Alle Kategorien</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* View controls */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="rvc-group" role="group" aria-label="Ansicht">
          <button type="button" className={'rvc-seg' + (view === 'grid' ? ' active' : '')} onClick={() => setViewMode('grid')} aria-label="Kachelansicht">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" /></svg>
            <span>Kacheln</span>
          </button>
          <button type="button" className={'rvc-seg' + (view === 'list' ? ' active' : '')} onClick={() => setViewMode('list')} aria-label="Listenansicht">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
            <span>Liste</span>
          </button>
        </div>

        <div className="rvc-group" role="group" aria-label="Kategorie-Aufteilung">
          <button type="button" className={'rvc-seg' + (catMode === 'none' ? ' active' : '')} onClick={() => setCategoryMode('none')} title="Keine Aufteilung">Keine</button>
          <button type="button" className={'rvc-seg' + (catMode === 'collapsible' ? ' active' : '')} onClick={() => setCategoryMode('collapsible')} title="Einklappbare Gruppen">Gruppen</button>
          <button type="button" className={'rvc-seg' + (catMode === 'tabs' ? ' active' : '')} onClick={() => setCategoryMode('tabs')} title="Tabseiten">Tabs</button>
        </div>
      </div>

      {/* Collection */}
      <div className="mt-8">
        {filtered.length === 0 ? (
          <div className="card p-8 text-center text-muted">Keine Rezepte gefunden.</div>
        ) : catMode === 'none' ? (
          renderGrid(filtered)
        ) : catMode === 'collapsible' ? (
          <div className="space-y-4">
            {grouped.map(([cat, recipes]) => {
              const isCollapsed = collapsed.has(cat);
              return (
                <div key={cat} className="card">
                  <button
                    type="button"
                    onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(cat)) n.delete(cat); else n.add(cat); return n; })}
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                  >
                    <span className="font-semibold text-gray-900 dark:text-white">{cat} <span className="text-sm font-normal text-muted">({recipes.length})</span></span>
                    <svg className={'h-5 w-5 text-gray-400 transition-transform ' + (isCollapsed ? '' : 'rotate-180')} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {!isCollapsed && <div className="px-4 pb-4">{renderGrid(recipes)}</div>}
                </div>
              );
            })}
          </div>
        ) : (
          <div>
            <div className="mb-4 flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-700">
              {grouped.map(([cat, recipes]) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveTab(cat)}
                  className={'-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ' + ((activeTab ?? grouped[0]?.[0]) === cat ? 'border-orange-500 text-orange-600 dark:text-orange-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-200')}
                >
                  {cat} ({recipes.length})
                </button>
              ))}
            </div>
            {renderGrid((grouped.find(([c]) => c === (activeTab ?? grouped[0]?.[0]))?.[1]) ?? [])}
          </div>
        )}
      </div>

      {showImport && <ImportModal onClose={() => setShowImport(false)} onImported={onImported} />}
      {addToListFor && (
        <AddToShoppingListModal
          recipeId={addToListFor.id}
          recipeTitle={addToListFor.title}
          onClose={() => setAddToListFor(null)}
          loadLists={localShoppingLists}
          createList={createLocalShoppingList}
          addRecipe={addRecipeToLocalShoppingList}
        />
      )}
    </div>
  );
}

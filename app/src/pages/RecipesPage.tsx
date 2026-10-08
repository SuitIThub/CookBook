import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Recipe } from '@/types';
import { localRecipes, deleteLocalRecipe, addRecipesToLocalShoppingList } from '@/lib/localData';
import { runSync } from '@/lib/syncRunner';
import { exportRecipesJson, exportRecipesRcb } from '@/lib/recipeExport';
import { getAlias } from '@/lib/settings';
import { getFavoriteIds } from '@core/favorites';
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

/** Website SearchBar syntax: words, "quoted phrases" and "tag:xyz" (tag-only). */
function parseSearchTerms(input: string): { regular: string[]; tagOnly: string[] } {
  const terms = { regular: [] as string[], tagOnly: [] as string[] };
  let current = '';
  let inQuotes = false;
  const add = (term: string) => {
    const t = term.trim().toLowerCase();
    if (!t) return;
    if (inQuotes && t.startsWith('tag:')) terms.tagOnly.push(t.slice(4));
    else terms.regular.push(t);
  };
  for (const ch of input) {
    if (ch === '"') {
      if (inQuotes) {
        add(current);
        current = '';
      }
      inQuotes = !inQuotes;
    } else if (ch === ' ' && !inQuotes) {
      add(current);
      current = '';
    } else current += ch;
  }
  add(current);
  return terms;
}
const matchesAll = (text: string, terms: string[]) => {
  const t = text.toLowerCase();
  return terms.every((term) => t.includes(term));
};

export default function RecipesPage() {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['recipes'], queryFn: localRecipes });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const initial = readLayout();
  const [searchParams] = useSearchParams();
  // ?search= / ?category= (tag and category links on the recipe page), like the website.
  const [q, setQ] = useState(() => searchParams.get('search') || '');
  const [category, setCategory] = useState(() => searchParams.get('category') || '');
  const [view, setView] = useState<View>(initial.view);
  const [catMode, setCatMode] = useState<CatMode>(initial.categoryMode);
  const [showImport, setShowImport] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // "Rezept hinzufügen" on a shopping list opens this page in selection mode.
  const addToListId = searchParams.get('addToList');
  const [selectionMode, setSelectionMode] = useState(!!addToListId);
  const [addingToList, setAddingToList] = useState(false);
  const [bulkListOpen, setBulkListOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [addToListFor, setAddToListFor] = useState<Recipe | null>(null);

  const originals = useMemo(() => (data ?? []).filter((r) => !r.parentRecipeId), [data]);
  // Re-sort on favorite changes; adopt layout changes from other devices (alias sync).
  const [favTick, setFavTick] = useState(0);
  useEffect(() => {
    const onFav = () => setFavTick((n) => n + 1);
    const onLayout = () => {
      const l = readLayout();
      setView(l.view);
      setCatMode(l.categoryMode);
    };
    document.addEventListener('cookbook:favorites-changed', onFav);
    document.addEventListener('cookbook:recipe-layout-changed', onLayout);
    return () => {
      document.removeEventListener('cookbook:favorites-changed', onFav);
      document.removeEventListener('cookbook:recipe-layout-changed', onLayout);
    };
  }, []);
  const familyOf = (id: string) => [id, ...(data ?? []).filter((r) => r.parentRecipeId === id).map((r) => r.id)];

  const categories = useMemo(
    () => Array.from(new Set(originals.map((r) => r.category).filter((c): c is string => !!c))).sort((a, b) => a.localeCompare(b, 'de')),
    [originals]
  );

  const filtered = useMemo(() => {
    const terms = parseSearchTerms(q);
    const cat = category.toLowerCase();
    const list = originals.filter((r) => {
      if (cat && (r.category ?? '').toLowerCase() !== cat) return false;
      const tags = (r.tags ?? []).map((t) => t.toLowerCase());
      const matchesTags = terms.tagOnly.every((tt) => tags.some((t) => t.includes(tt)));
      const matchesRegular =
        terms.regular.length === 0 ||
        matchesAll(r.title, terms.regular) ||
        matchesAll(r.description ?? '', terms.regular) ||
        tags.some((t) => matchesAll(t, terms.regular));
      return matchesTags && matchesRegular;
    });
    // Favorites first (only with an alias), original order within each group — like the website.
    if (!getAlias()) return list;
    const favs = getFavoriteIds();
    const isFav = (r: Recipe) => familyOf(r.id).some((id) => favs.has(id));
    return [...list.filter(isFav), ...list.filter((r) => !isFav(r))];
  }, [originals, q, category, favTick]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Möchten Sie wirklich ${selectedIds.size} Rezept${selectedIds.size === 1 ? '' : 'e'} löschen?`)) return;
    for (const id of selectedIds) await deleteLocalRecipe(id);
    cancelSelection();
    queryClient.invalidateQueries();
    runSync().catch(() => {});
  };

  const exportRcb = (ids?: string[]) =>
    exportRecipesRcb(ids).catch(() => alert('Der vollständige Export (mit Bildern) braucht eine Verbindung zum Server.'));

  const confirmAddToList = async () => {
    if (!addToListId) return;
    const ids = [...selectedIds];
    if (ids.length === 0) {
      navigate(`/einkaufsliste/${addToListId}`);
      return;
    }
    setAddingToList(true);
    try {
      await addRecipesToLocalShoppingList(addToListId, ids);
      queryClient.invalidateQueries();
      runSync().catch(() => {});
      navigate(`/einkaufsliste/${addToListId}`);
    } catch (error) {
      console.error('Fehler beim Hinzufügen zur Einkaufsliste:', error);
      alert('Die Rezepte konnten nicht zur Einkaufsliste hinzugefügt werden.');
      setAddingToList(false);
    }
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
        <RecipeCard key={r.id} recipe={r} familyIds={familyOf(r.id)} selected={selectedIds.has(r.id)} {...cardProps} />
      ))}
    </div>
  );

  return (
    <div>
      {/* Header (RecipeListHeader) */}
      <div className="flex flex-col gap-4 md:flex-row md:justify-between md:gap-0">
        <div>
          <h1 className="heading-primary">Meine Rezepte</h1>
          <p className="mt-1 text-muted">
            {filtered.length} Rezepte gefunden
            {(selectionMode || addToListId) && (
              <span> (<span className="text-orange-600 dark:text-orange-400">{selectedIds.size} ausgewählt</span>)</span>
            )}
          </p>
        </div>

        {addToListId ? (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => navigate(`/einkaufsliste/${addToListId}`)} className="btn btn-secondary flex flex-1 items-center justify-center space-x-2 md:flex-none">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              <span>Abbrechen</span>
            </button>
            <button onClick={confirmAddToList} disabled={addingToList} className="btn btn-primary flex flex-1 items-center justify-center space-x-2 md:flex-none">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
              <span>Zur Einkaufsliste hinzufügen</span>
            </button>
          </div>
        ) : selectionMode ? (
          <div className="flex flex-wrap gap-2">
            <button onClick={cancelSelection} className="btn btn-secondary flex flex-1 items-center justify-center space-x-2 md:flex-none">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              <span>Auswahl beenden</span>
            </button>
            <button onClick={bulkDelete} className="btn btn-danger flex flex-1 items-center justify-center space-x-2 md:flex-none">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              <span>Löschen</span>
            </button>
            <ExportMenu
              onJson={() => exportRecipesJson(originals.filter((r) => selectedIds.has(r.id)), true)}
              onRcb={() => exportRcb([...selectedIds])}
            />
            <button onClick={() => selectedIds.size > 0 && setBulkListOpen(true)} className="btn btn-secondary flex flex-1 items-center justify-center space-x-2 md:flex-none">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
              <span>Zur Einkaufsliste</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setSelectionMode(true)} className="btn btn-secondary flex flex-1 items-center justify-center space-x-2 md:hidden">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
              <span>Auswählen</span>
            </button>
            <button onClick={randomRecipe} className="btn btn-secondary flex flex-1 items-center justify-center space-x-2 md:flex-none">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
              <span>Zufälliges Rezept</span>
            </button>
            <Link to="/rezept/neu" className="btn btn-primary flex flex-1 items-center justify-center space-x-2 md:flex-none">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              <span>Neues Rezept</span>
            </Link>
            <button onClick={() => setShowImport(true)} className="btn btn-secondary flex flex-1 items-center justify-center space-x-2 md:flex-none">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" /></svg>
              <span>Importieren</span>
            </button>
            <ExportMenu onJson={() => exportRecipesJson(data ?? [], false)} onRcb={() => exportRcb()} />
          </div>
        )}
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
      {addToListFor && <AddToShoppingListModal recipeIds={[addToListFor.id]} onClose={() => setAddToListFor(null)} />}
      {bulkListOpen && <AddToShoppingListModal recipeIds={[...selectedIds]} onClose={() => setBulkListOpen(false)} />}
    </div>
  );
}

/** "Exportieren" dropdown (JSON ohne Bilder / Vollständig mit Bildern), like RecipeListHeader. */
function ExportMenu({ onJson, onRcb }: { onJson: () => void; onRcb: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);
  return (
    <div className="relative flex-1 md:flex-none">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="btn btn-secondary flex w-full items-center justify-center space-x-2"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
        <span>Exportieren</span>
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-48 rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <div className="py-1">
            <button onClick={onJson} className="flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700">
              <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              JSON (ohne Bilder)
            </button>
            <button onClick={onRcb} className="flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700">
              <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" /></svg>
              Vollständig (mit Bildern)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

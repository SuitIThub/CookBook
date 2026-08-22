import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { localRecipes } from '@/lib/localData';
import { runSync } from '@/lib/syncRunner';
import RecipeCard from '@/components/recipe_list/RecipeCard';
import ImportModal from '@/components/ImportModal';

const LAYOUT_KEY = 'cookbook.recipes.layout';
type View = 'grid' | 'list';

function readView(): View {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p?.view === 'list') return 'list';
    }
  } catch {
    /* ignore */
  }
  return 'grid';
}
function writeView(view: View) {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    const p = raw ? JSON.parse(raw) : {};
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ ...p, view }));
  } catch {
    /* ignore */
  }
}

export default function RecipesPage() {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['recipes'], queryFn: localRecipes });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [view, setView] = useState<View>(readView);
  const [showImport, setShowImport] = useState(false);

  const originals = useMemo(() => (data ?? []).filter((r) => !r.parentRecipeId), [data]);

  const categories = useMemo(
    () =>
      Array.from(new Set(originals.map((r) => r.category).filter((c): c is string => !!c))).sort((a, b) =>
        a.localeCompare(b, 'de')
      ),
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

  const setViewMode = (v: View) => {
    setView(v);
    writeView(v);
  };

  const onImported = async (recipeId: string) => {
    setShowImport(false);
    await runSync();
    queryClient.invalidateQueries();
    navigate(`/rezept/${recipeId}`);
  };

  const randomRecipe = () => {
    if (originals.length === 0) return;
    const r = originals[Math.floor(Math.random() * originals.length)];
    navigate(`/rezept/${r.id}`);
  };

  if (isLoading) return <p className="text-muted">Lade Rezepte …</p>;
  if (isError)
    return <p className="text-red-600 dark:text-red-400">Fehler beim Laden: {(error as Error).message}</p>;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-0">
        <div>
          <h1 className="heading-primary">Meine Rezepte</h1>
          <p className="mt-1 text-muted">{filtered.length} Rezepte gefunden</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={randomRecipe}
            className="btn btn-secondary flex flex-1 items-center justify-center space-x-2 md:flex-none"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            <span>Zufälliges Rezept</span>
          </button>
          <Link
            to="/rezept/neu"
            className="btn btn-primary flex flex-1 items-center justify-center space-x-2 md:flex-none"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>Neues Rezept</span>
          </Link>
          <button
            onClick={() => setShowImport(true)}
            className="btn btn-secondary flex flex-1 items-center justify-center space-x-2 md:flex-none"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
            </svg>
            <span>Importieren</span>
          </button>
        </div>
      </div>

      {/* Search + category filter */}
      <div className="mt-6 flex flex-col gap-4 sm:flex-row">
        <div className="flex-1">
          <input
            type="text"
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-orange-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:ring-orange-400"
            placeholder="Rezept suchen..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-48">
          <select
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-orange-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:ring-orange-400"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Alle Kategorien</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* View controls */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="rvc-group" role="group" aria-label="Ansicht">
          <button
            type="button"
            className={'rvc-seg' + (view === 'grid' ? ' active' : '')}
            onClick={() => setViewMode('grid')}
            aria-label="Kachelansicht"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
            </svg>
            <span>Kacheln</span>
          </button>
          <button
            type="button"
            className={'rvc-seg' + (view === 'list' ? ' active' : '')}
            onClick={() => setViewMode('list')}
            aria-label="Listenansicht"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <span>Liste</span>
          </button>
        </div>
      </div>

      {/* Collection */}
      <div className="mt-8">
        {filtered.length === 0 ? (
          <div className="card p-8 text-center text-muted">Keine Rezepte gefunden.</div>
        ) : (
          <div className={'recipe-cards-container ' + (view === 'list' ? 'view-list' : 'view-grid')}>
            {filtered.map((r) => (
              <RecipeCard key={r.id} recipe={r} />
            ))}
          </div>
        )}
      </div>

      {showImport && <ImportModal onClose={() => setShowImport(false)} onImported={onImported} />}
    </div>
  );
}

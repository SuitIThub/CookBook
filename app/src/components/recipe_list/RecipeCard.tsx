import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Recipe } from '@/types';
import RecipeImageCarousel from './RecipeImageCarousel';
import { getSettings } from '@/lib/settings';
import { getFavoriteIds, toggleFamilyFavorite } from '@core/favorites';
import { exportRecipeJson, exportRecipeMarkdown } from '@/lib/recipeExport';

/**
 * Mirrors the website's RecipeCard. The same markup serves both views; the
 * ported CSS decides what shows where. Adds the favorite star (per-alias, shown
 * only when an alias is configured), a selection checkbox (in selection mode),
 * and the per-card meatball menu (Export / Zur Einkaufsliste / Löschen).
 */
export default function RecipeCard({
  recipe,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  onAddToList,
  onDeleted
}: {
  recipe: Recipe;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onAddToList?: (recipe: Recipe) => void;
  onDeleted?: (recipe: Recipe) => void;
}) {
  const tags = recipe.tags ?? [];
  const displayTags = tags.slice(0, 3);
  const remaining = Math.max(0, tags.length - 3);
  const totalTime = (recipe.metadata.timeEntries ?? []).reduce((t, e) => t + (e.minutes || 0), 0);
  const familyIds = [recipe.id];

  const [hasAlias] = useState(() => !!getSettings().alias);
  const [fav, setFav] = useState(() => getFavoriteIds().has(recipe.id));
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const toggleFav = (e: React.MouseEvent) => {
    stop(e);
    const now = toggleFamilyFavorite(familyIds);
    setFav(now);
  };

  return (
    <Link
      to={`/rezept/${recipe.id}`}
      className={'recipe-card group relative' + (selected ? ' selected' : '') + (selectionMode ? ' selection-mode' : '')}
      data-category={recipe.category || ''}
      onClick={(e) => {
        if (selectionMode) {
          e.preventDefault();
          onToggleSelect?.(recipe.id);
        }
      }}
    >
      {/* Selection checkbox */}
      {(selectionMode || selected) && (
        <div className="absolute left-2 top-2 z-10">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect?.(recipe.id)}
            onClick={stop}
            className="h-5 w-5 cursor-pointer rounded border-gray-300 text-orange-600 focus:ring-orange-500"
          />
        </div>
      )}

      {/* Favorite star (only when an alias is set) */}
      {hasAlias && !selectionMode && (
        <button
          type="button"
          onClick={toggleFav}
          title="Favorit"
          aria-label="Als Favorit markieren"
          className="absolute right-2 top-2 z-10 rounded-full border border-gray-200 bg-white/90 p-1.5 shadow-sm transition-colors hover:bg-amber-50 dark:border-gray-600 dark:bg-gray-800/90 dark:hover:bg-amber-900/40"
        >
          {fav ? (
            <svg className="h-5 w-5 text-amber-500" fill="currentColor" viewBox="0 0 24 24"><path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" /></svg>
          ) : (
            <svg className="h-5 w-5 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" /></svg>
          )}
        </button>
      )}

      {/* Image (top in grid, left in list) */}
      <div className="rc-image">
        <RecipeImageCarousel images={recipe.images ?? []} />
      </div>

      {/* Content */}
      <div className="card-content p-4">
        <div className="rc-title-block mb-3">
          <h3 className="heading-tertiary mb-1 transition-colors group-hover:text-orange-600 dark:group-hover:text-orange-400">
            {recipe.title}
          </h3>
          {recipe.subtitle && <p className="text-sm text-muted">{recipe.subtitle}</p>}
        </div>

        {recipe.description && <p className="rc-grid-only mb-3 line-clamp-2 text-sm text-body">{recipe.description}</p>}

        <div className="rc-tags mb-4 flex flex-wrap gap-1.5">
          {displayTags.map((tag) => (
            <span key={tag} className="tag">{tag}</span>
          ))}
          {remaining > 0 && (
            <span className="tag-more" title={tags.slice(3).join(', ')}>+{remaining} weitere</span>
          )}
        </div>

        {/* Open arrow (list only) */}
        <span className="rc-open-arrow rc-list-only" aria-hidden="true">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </span>

        {/* Divider (grid only) */}
        <div className="rc-grid-only my-3 border-t border-gray-200 dark:border-gray-700"></div>

        {/* Metadata + meatball (grid only) */}
        <div className="rc-grid-only flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
          <div className="flex items-center gap-4">
            {recipe.metadata.servings ? (
              <div className="flex items-center">
                <svg className="mr-1.5 h-4 w-4 text-gray-400 dark:text-gray-500" fill="currentColor" viewBox="0 0 20 20"><path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3z" /></svg>
                <span>{recipe.metadata.servings} Portionen</span>
              </div>
            ) : null}
            {totalTime > 0 && (
              <div className="flex items-center">
                <svg className="mr-1.5 h-4 w-4 text-gray-400 dark:text-gray-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" /></svg>
                <span>{totalTime} Min</span>
              </div>
            )}
          </div>

          {/* Meatball menu */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={(e) => {
                stop(e);
                setMenuOpen((o) => !o);
              }}
              className="rounded-full p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
              aria-label="Menü"
            >
              <svg className="h-5 w-5 text-gray-400 dark:text-gray-500" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" /></svg>
            </button>
            {menuOpen && (
              <div className="absolute bottom-full right-0 z-50 mb-1 w-48 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800" role="menu">
                <MenuItem onClick={(e) => { stop(e); exportRecipeMarkdown(recipe); setMenuOpen(false); }} label="Als Markdown" iconD="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                <MenuItem onClick={(e) => { stop(e); exportRecipeJson(recipe); setMenuOpen(false); }} label="Als JSON" iconD="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                <MenuItem onClick={(e) => { stop(e); onAddToList?.(recipe); setMenuOpen(false); }} label="Zur Einkaufsliste" iconD="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                <MenuItem onClick={(e) => { stop(e); setMenuOpen(false); onDeleted?.(recipe); }} label="Löschen" danger iconD="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

function MenuItem({ onClick, label, iconD, danger }: { onClick: (e: React.MouseEvent) => void; label: string; iconD: string; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={'flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ' + (danger ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300')}
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconD} /></svg>
      <span>{label}</span>
    </button>
  );
}

import { Link } from 'react-router-dom';
import type { Recipe } from '@/types';
import RecipeImageCarousel from './RecipeImageCarousel';

/**
 * Mirrors the website's RecipeCard. The same markup serves both views; the
 * ported CSS (.recipe-cards-container.view-grid / .view-list + .rc-grid-only /
 * .rc-list-only) decides what shows where. The whole card links to the recipe;
 * carousel controls stopPropagation so they don't trigger navigation.
 *
 * Deferred for a follow-up (kept out so the layout still matches): favorite
 * star, multi-select checkbox, and the per-card meatball menu.
 */
export default function RecipeCard({ recipe }: { recipe: Recipe }) {
  const tags = recipe.tags ?? [];
  const displayTags = tags.slice(0, 3);
  const remaining = Math.max(0, tags.length - 3);
  const totalTime = (recipe.metadata.timeEntries ?? []).reduce((t, e) => t + (e.minutes || 0), 0);

  return (
    <Link
      to={`/rezept/${recipe.id}`}
      className="recipe-card group relative"
      data-category={recipe.category || ''}
    >
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

        {recipe.description && (
          <p className="rc-grid-only mb-3 line-clamp-2 text-sm text-body">{recipe.description}</p>
        )}

        <div className="rc-tags mb-4 flex flex-wrap gap-1.5">
          {displayTags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
          {remaining > 0 && (
            <span className="tag-more" title={tags.slice(3).join(', ')}>
              +{remaining} weitere
            </span>
          )}
        </div>

        {/* Open arrow (list only) */}
        <span className="rc-open-arrow rc-list-only" aria-hidden="true">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </span>

        {/* Divider (grid only) */}
        <div className="rc-grid-only my-3 border-t border-gray-200 dark:border-gray-700"></div>

        {/* Metadata (grid only) */}
        <div className="rc-grid-only flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
          <div className="flex items-center gap-4">
            {recipe.metadata.servings ? (
              <div className="flex items-center">
                <svg className="mr-1.5 h-4 w-4 text-gray-400 dark:text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3z" />
                </svg>
                <span>{recipe.metadata.servings} Portionen</span>
              </div>
            ) : null}
            {totalTime > 0 && (
              <div className="flex items-center">
                <svg className="mr-1.5 h-4 w-4 text-gray-400 dark:text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>{totalTime} Min</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

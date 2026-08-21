import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiGet, assetUrl } from '@/lib/api';
import type { Recipe } from '@/types';

export default function RecipesPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['recipes'],
    queryFn: () => apiGet<Recipe[]>('/api/recipes')
  });
  const [q, setQ] = useState('');

  // Overview shows originals only (variants are reached from their parent).
  const recipes = useMemo(() => {
    const originals = (data ?? []).filter((r) => !r.parentRecipeId);
    const needle = q.trim().toLowerCase();
    if (!needle) return originals;
    return originals.filter(
      (r) =>
        r.title.toLowerCase().includes(needle) ||
        (r.category ?? '').toLowerCase().includes(needle) ||
        (r.tags ?? []).some((t) => t.toLowerCase().includes(needle))
    );
  }, [data, q]);

  if (isLoading) return <p className="text-secondary-500">Lade Rezepte …</p>;
  if (isError) {
    return (
      <p className="text-red-600 dark:text-red-400">
        Fehler beim Laden: {(error as Error).message}
      </p>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Rezepte</h1>
        <span className="text-sm text-secondary-500">{recipes.length}</span>
      </div>

      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Rezepte, Kategorien oder Tags suchen …"
        className="mb-6 w-full rounded-lg border border-secondary-300 bg-white px-4 py-2 text-secondary-900 outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-600 dark:bg-secondary-800 dark:text-white"
      />

      {recipes.length === 0 ? (
        <p className="text-secondary-500">Keine Rezepte gefunden.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {recipes.map((r) => (
            <li key={r.id}>
              <Link
                to={`/rezept/${r.id}`}
                className="group block overflow-hidden rounded-xl border border-secondary-200 bg-white shadow-sm transition hover:shadow-md dark:border-secondary-700 dark:bg-secondary-800"
              >
                <div className="aspect-[4/3] w-full overflow-hidden bg-secondary-100 dark:bg-secondary-700">
                  {assetUrl(r.imageUrl) ? (
                    <img
                      src={assetUrl(r.imageUrl)}
                      alt={r.title}
                      loading="lazy"
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-3xl">🍳</div>
                  )}
                </div>
                <div className="p-3">
                  <h2 className="line-clamp-2 font-semibold leading-tight">{r.title}</h2>
                  {r.category && (
                    <p className="mt-1 text-xs text-secondary-500">{r.category}</p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

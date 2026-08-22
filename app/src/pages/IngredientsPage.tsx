import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { localRecipeIngredients } from '@/lib/localData';

export default function IngredientsPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['recipe-ingredients'],
    queryFn: localRecipeIngredients
  });
  const [q, setQ] = useState('');

  const ingredients = useMemo(() => {
    const all = data ?? [];
    const needle = q.trim().toLowerCase();
    const filtered = needle ? all.filter((i) => i.name.toLowerCase().includes(needle)) : all;
    return [...filtered].sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0));
  }, [data, q]);

  if (isLoading) return <p className="text-secondary-500">Lade Zutaten …</p>;
  if (isError)
    return <p className="text-red-600 dark:text-red-400">Fehler: {(error as Error).message}</p>;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">
          Zutaten <span className="text-sm font-normal text-secondary-500">{ingredients.length}</span>
        </h1>
      </div>

      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Zutaten suchen …"
        className="mb-6 w-full rounded-lg border border-secondary-300 bg-white px-4 py-2 text-secondary-900 outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-600 dark:bg-secondary-800 dark:text-white"
      />

      {ingredients.length === 0 ? (
        <p className="text-secondary-500">Keine Zutaten gefunden.</p>
      ) : (
        <ul className="divide-y divide-secondary-200 overflow-hidden rounded-xl border border-secondary-200 dark:divide-secondary-700 dark:border-secondary-700">
          {ingredients.map((i) => (
            <li key={i.name} className="flex items-center justify-between gap-3 bg-white px-4 py-2.5 dark:bg-secondary-800">
              <p className="min-w-0 truncate font-medium">{i.name}</p>
              <span className="shrink-0 rounded-full bg-secondary-100 px-2 py-0.5 text-xs text-secondary-500 dark:bg-secondary-700">
                {i.usageCount ?? 0}×
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Recipe } from '@/types';
import { localRecipes } from '@/lib/localData';
import { assetUrl } from '@/lib/api';

/**
 * Recipe picker for adding recipes to a shopping list — mirrors the website's
 * flow of choosing from the recipe overview (the name alone isn't enough): shows
 * image, title, subtitle, category and servings, with search. Multiple recipes
 * can be selected and added at once.
 */
export default function RecipePickerModal({
  excludeIds = [],
  onClose,
  onPick
}: {
  excludeIds?: string[];
  onClose: () => void;
  onPick: (recipes: Recipe[]) => Promise<void> | void;
}) {
  const { data } = useQuery({ queryKey: ['recipes'], queryFn: localRecipes });
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const exclude = useMemo(() => new Set(excludeIds), [excludeIds]);
  const recipes = useMemo(() => {
    const all = (data ?? []).filter((r) => !r.parentRecipeId && !exclude.has(r.id));
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (r) =>
        r.title.toLowerCase().includes(needle) ||
        (r.subtitle ?? '').toLowerCase().includes(needle) ||
        (r.category ?? '').toLowerCase().includes(needle) ||
        (r.tags ?? []).some((t) => t.toLowerCase().includes(needle))
    );
  }, [data, q, exclude]);

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const confirm = async () => {
    const picked = (data ?? []).filter((r) => sel.has(r.id));
    if (picked.length === 0) return;
    setBusy(true);
    try {
      await onPick(picked);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50 p-3" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Rezept auswählen</h2>
          <button onClick={onClose} className="text-2xl leading-none text-gray-500 hover:text-gray-800 dark:text-gray-300">&times;</button>
        </div>

        <div className="p-4 pb-2">
          <input
            autoFocus
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rezept suchen …"
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-orange-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
          />
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4 pt-2">
          {recipes.length === 0 ? (
            <p className="py-8 text-center text-gray-500 dark:text-gray-400">Keine Rezepte gefunden.</p>
          ) : (
            recipes.map((r) => {
              const on = sel.has(r.id);
              const img = assetUrl(r.images?.[0]?.url ?? r.imageUrl ?? undefined);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggle(r.id)}
                  className={
                    'flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors ' +
                    (on ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50')
                  }
                >
                  <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-100 dark:bg-gray-700">
                    {img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <img src="/icons/icon_alpha_128.svg" alt="" className="h-7 w-7 opacity-60" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-gray-900 dark:text-white">{r.title}</div>
                    {r.subtitle && <div className="truncate text-sm text-gray-500 dark:text-gray-400">{r.subtitle}</div>}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-gray-500 dark:text-gray-400">
                      {r.category && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200">{r.category}</span>}
                      {r.metadata.servings ? <span>{r.metadata.servings} Portionen</span> : null}
                    </div>
                  </div>
                  <div className={'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 ' + (on ? 'border-orange-500 bg-orange-500 text-white' : 'border-gray-300 dark:border-gray-600')}>
                    {on && (
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 p-4 dark:border-gray-700">
          <button onClick={onClose} className="btn btn-secondary">Abbrechen</button>
          <button onClick={confirm} disabled={sel.size === 0 || busy} className="btn btn-primary disabled:opacity-50">
            {sel.size > 0 ? `${sel.size} hinzufügen` : 'Hinzufügen'}
          </button>
        </div>
      </div>
    </div>
  );
}

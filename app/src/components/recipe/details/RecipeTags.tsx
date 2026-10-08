/**
 * Port of components/recipe/details/RecipeTags.astro: category + tag chips
 * (filter links into the overview) and inline "Tag hinzufügen" with up to
 * three suggestions from existing tags. Saved to the local replica (offline).
 */
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Recipe } from '@/types';
import { localRecipes } from '@/lib/localData';

// Scoped styles of RecipeTags.astro (blue tags, orange category).
const TAG = 'rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-700 transition-colors cursor-pointer hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50';
const CATEGORY_TAG = 'rounded-full bg-orange-50 px-3 py-1 text-sm text-orange-700 transition-colors cursor-pointer hover:bg-orange-100 dark:bg-orange-900/30 dark:text-orange-300 dark:hover:bg-orange-900/50';

export default function RecipeTags({ recipe, onAddTag }: { recipe: Recipe; onAddTag: (tags: string[]) => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [notice, setNotice] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tags = recipe.tags ?? [];
  const { data: all } = useQuery({ queryKey: ['recipes'], queryFn: localRecipes });
  const allTags = useMemo(() => Array.from(new Set((all ?? []).flatMap((r) => r.tags ?? []))).sort((a, b) => a.localeCompare(b, 'de')), [all]);
  const query = value.trim();
  const suggestions = query ? allTags.filter((t) => t.toLowerCase().includes(query.toLowerCase()) && !tags.includes(t)).slice(0, 3) : [];
  const valid = query.length > 0 && !tags.includes(query);

  const notify = (text: string, type: 'success' | 'error') => {
    setNotice({ text, type });
    setTimeout(() => setNotice(null), 3000);
  };
  const hide = () => {
    setAdding(false);
    setValue('');
    setShowSuggestions(false);
  };
  const add = async () => {
    if (!valid) return;
    try {
      await onAddTag([...tags, query]);
      hide();
      notify('Tag erfolgreich hinzugefügt!', 'success');
    } catch {
      notify('Fehler beim Hinzufügen des Tags. Bitte versuchen Sie es erneut.', 'error');
      hide();
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm transition-colors duration-200 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-wrap gap-2">
        {recipe.category && (
          <Link to={`/rezepte?category=${encodeURIComponent(recipe.category)}`} className={CATEGORY_TAG} title="Nach Kategorie filtern">
            {recipe.category}
          </Link>
        )}
        {tags.map((tag) => (
          <Link key={tag} to={`/rezepte?search=${encodeURIComponent(`"tag:${tag}"`)}`} className={TAG} title="Nach Tag filtern">
            {tag}
          </Link>
        ))}
        {!adding ? (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
            className="inline-flex items-center justify-center rounded-full border border-gray-200 bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600 transition-colors duration-200 hover:bg-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            title="Tag hinzufügen"
          >
            <svg className="mr-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
            <span>Tag hinzufügen</span>
          </button>
        ) : (
          <div className="relative">
            <div className="flex items-center space-x-2">
              <input
                ref={inputRef}
                type="text"
                placeholder="Tag eingeben..."
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setShowSuggestions(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void add();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    hide();
                  }
                }}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                className="min-w-[120px] rounded-full border border-gray-300 bg-white px-3 py-1 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-orange-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
              <button type="button" onClick={() => void add()} disabled={!valid} title="Bestätigen" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-green-500 text-white transition-colors duration-200 hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </button>
              <button type="button" onClick={hide} title="Abbrechen" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gray-500 text-white transition-colors duration-200 hover:bg-gray-600">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-32 overflow-y-auto rounded-md border border-gray-300 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setValue(s);
                      setShowSuggestions(false);
                      inputRef.current?.focus();
                    }}
                    className="block w-full border-b border-gray-200 px-3 py-2 text-left text-gray-900 transition-colors duration-150 last:border-b-0 hover:bg-gray-100 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {notice && (
        <div className={`fixed right-4 top-4 z-50 rounded-lg px-4 py-2 text-white shadow-lg ${notice.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}>{notice.text}</div>
      )}
    </div>
  );
}

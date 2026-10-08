import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '@/lib/api';
import {
  arrangeModels,
  badges,
  formatPrice,
  readFavorites,
  TASK_HINTS,
  toggleFavorite,
  type CatalogModel,
  type ModelTask,
  type SortMode
} from '@core/modelPicker';

/** Website modelPicker.ts: searchable model list with favorites and per-task recommendations. */
interface Props {
  provider: 'openrouter' | 'ollama';
  apiKey?: string;
  task: ModelTask;
  value: string;
  onChange: (id: string) => void;
  /** Label of the "no own model" option (e.g. "Wie Chat-Modell"); omit for a required choice. */
  inheritLabel?: string;
  id?: string;
}

const catalogCache = new Map<string, Promise<{ models: CatalogModel[]; freeOnly?: boolean }>>();
function loadCatalog(provider: string, apiKey: string) {
  const key = `${provider}|${apiKey}`;
  if (!catalogCache.has(key)) {
    const p = apiGet<{ models: CatalogModel[]; freeOnly?: boolean }>(`/api/ai/model-catalog?provider=${provider}`, {
      headers: apiKey ? { 'X-OpenRouter-Api-Key': apiKey } : {},
      timeoutMs: 20000
    });
    p.catch(() => catalogCache.delete(key));
    catalogCache.set(key, p);
  }
  return catalogCache.get(key)!;
}

const toneCls = {
  good: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  info: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  muted: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
};

export default function ModelPicker({ provider, apiKey = '', task, value, onChange, inheritLabel, id }: Props) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<CatalogModel[] | null>(null);
  const [freeOnly, setFreeOnly] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('recommended');
  const [onlyRecommended, setOnlyRecommended] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(readFavorites);

  useEffect(() => {
    let alive = true;
    setModels(null);
    setError('');
    loadCatalog(provider, apiKey.trim())
      .then((d) => alive && (setModels(d.models), setFreeOnly(!!d.freeOnly)))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [provider, apiKey]);

  const current = models?.find((m) => m.id === value);
  const arranged = useMemo(
    () => (models ? arrangeModels(models, { provider, task, query, sort, onlyRecommended, favorites }) : null),
    [models, provider, task, query, sort, onlyRecommended, favorites]
  );

  const pick = (mid: string) => {
    onChange(mid);
    setOpen(false);
  };

  const row = (m: CatalogModel) => {
    const fav = favorites.has(`${provider}:${m.id}`);
    return (
      <div key={m.id} className={`flex items-start gap-2 px-3 py-2 ${m.id === value ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
        <button
          type="button"
          onClick={() => setFavorites(toggleFavorite(provider, m.id))}
          title={fav ? 'Aus Favoriten entfernen' : 'Als Favorit merken'}
          aria-label={fav ? 'Aus Favoriten entfernen' : 'Als Favorit merken'}
          className={`mt-0.5 text-lg leading-none ${fav ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-400 dark:text-gray-600'}`}
        >
          {fav ? '★' : '☆'}
        </button>
        <button type="button" onClick={() => pick(m.id)} className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm font-medium text-gray-900 dark:text-white">{m.name}</div>
          <div className="truncate text-[11px] text-gray-500 dark:text-gray-400">{m.id}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {badges(m, task).map((b) => (
              <span key={b.label} title={b.title} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${toneCls[b.tone]}`}>
                {b.label}
              </span>
            ))}
            {formatPrice(m) && <span className="text-[10px] text-gray-500 dark:text-gray-400">{formatPrice(m)}</span>}
          </div>
        </button>
      </div>
    );
  };

  const section = (title: string, list: CatalogModel[]) =>
    list.length > 0 && (
      <div>
        <div className="sticky top-0 z-10 bg-gray-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:bg-gray-900 dark:text-gray-300">
          {title} ({list.length})
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-700">{list.map(row)}</div>
      </div>
    );

  return (
    <>
      <button
        type="button"
        id={id}
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
      >
        <span className="min-w-0 truncate">{value ? current?.name ?? value : inheritLabel ?? 'Modell wählen …'}</span>
        <span className="text-xs text-gray-400">▾</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/50 sm:items-center sm:p-4" onClick={(e) => e.target === e.currentTarget && setOpen(false)} aria-modal="true">
          <div className="flex w-full max-w-xl flex-col bg-white shadow-2xl dark:bg-gray-800 sm:max-h-[85vh] sm:rounded-xl">
            <div className="space-y-2 border-b border-gray-200 p-3 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Modell suchen (Name oder ID) …"
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-2 py-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Schließen">
                  ✕
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600 dark:text-gray-300">
                <label className="flex items-center gap-1">
                  Sortierung
                  <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} className="rounded border border-gray-300 bg-white px-1 py-0.5 dark:border-gray-600 dark:bg-gray-700">
                    <option value="recommended">Empfehlung</option>
                    <option value="price">Preis</option>
                    <option value="newest">Neueste</option>
                    <option value="name">Name</option>
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={onlyRecommended} onChange={(e) => setOnlyRecommended(e.target.checked)} />
                  nur empfohlene & Favoriten
                </label>
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {TASK_HINTS[task]}
                {provider === 'openrouter' && freeOnly && ' Ohne eigenen API-Key sind nur kostenlose Modelle verfügbar.'}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {inheritLabel && (
                <button type="button" onClick={() => pick('')} className={`block w-full px-3 py-2 text-left text-sm ${!value ? 'bg-indigo-50 font-medium dark:bg-indigo-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                  {inheritLabel}
                </button>
              )}
              {error && <p className="p-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
              {!models && !error && <p className="p-3 text-sm text-gray-500">Lade Modelle …</p>}
              {arranged && (
                <>
                  {section('Favoriten', arranged.favorites)}
                  {section('Empfohlen für diese Aufgabe', arranged.recommended)}
                  {section(arranged.favorites.length || arranged.recommended.length ? 'Weitere passende Modelle' : 'Modelle', arranged.others)}
                  {arranged.total === 0 && <p className="p-3 text-sm text-gray-500">Kein passendes Modell gefunden.</p>}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

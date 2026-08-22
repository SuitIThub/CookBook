import { useState } from 'react';
import { importFromUrl, importFromText } from '@/lib/recipeImport';

interface Props {
  onClose: () => void;
  onImported: (recipeId: string) => void;
}

export default function ImportModal({ onClose, onImported }: Props) {
  const [mode, setMode] = useState<'url' | 'text'>('url');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = mode === 'url' ? await importFromUrl(url.trim()) : await importFromText(text);
      onImported(id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const field =
    'w-full rounded-lg border border-secondary-300 bg-white px-3 py-2 text-sm text-secondary-900 outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-600 dark:bg-secondary-800 dark:text-white';
  const tab = (m: 'url' | 'text', label: string) => (
    <button
      onClick={() => setMode(m)}
      className={
        '-mb-px border-b-2 px-4 py-2 text-sm font-medium ' +
        (mode === m
          ? 'border-primary-500 text-primary-600 dark:text-primary-400'
          : 'border-transparent text-secondary-500')
      }
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl dark:bg-secondary-800" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-semibold">Rezept importieren</h2>

        <div className="mb-4 flex border-b border-secondary-200 dark:border-secondary-700">
          {tab('url', 'Von URL')}
          {tab('text', 'Aus Text (JSON)')}
        </div>

        {mode === 'url' ? (
          <div>
            <input
              className={field}
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              inputMode="url"
              autoCapitalize="off"
              onKeyDown={(e) => e.key === 'Enter' && url.trim() && run()}
            />
            <p className="mt-1 text-xs text-secondary-500">
              Die Seite wird serverseitig ausgelesen (nur online, Token nötig).
            </p>
          </div>
        ) : (
          <textarea
            className={field + ' font-mono'}
            rows={8}
            placeholder='{"title": "…", "ingredientGroups": […], "preparationGroups": […]}'
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        )}

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="rounded-lg border border-secondary-300 px-4 py-2 text-sm dark:border-secondary-600">
            Abbrechen
          </button>
          <button
            onClick={run}
            disabled={busy || (mode === 'url' ? !url.trim() : !text.trim())}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {busy ? 'Importiere …' : 'Importieren'}
          </button>
        </div>
      </div>
    </div>
  );
}

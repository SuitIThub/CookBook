import { useState } from 'react';
import { importFromUrl, importFromText, importFromReel, isReelUrl } from '@/lib/recipeImport';

interface Props {
  onClose: () => void;
  onImported: (recipeId: string) => void;
  /** Prefilled URL (shared link). */
  initialUrl?: string;
}

export default function ImportModal({ onClose, onImported, initialUrl }: Props) {
  const [mode, setMode] = useState<'url' | 'text'>('url');
  const [url, setUrl] = useState(initialUrl ?? '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [aiReview, setAiReview] = useState(false);
  const reel = mode === 'url' && isReelUrl(url);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'url') {
        const r = reel ? await importFromReel(url, setProgress) : await importFromUrl(url.trim(), setProgress, aiReview);
        if (r.warnings.length) alert(r.warnings.join('\n\n'));
        onImported(r.recipeId);
        return;
      }
      onImported(await importFromText(text));
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
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
              {reel
                ? 'Instagram-Reel — KI-Import aus Beschreibung, gesprochenem und eingeblendetem Text (dauert ca. 1–2 Minuten, nur online).'
                : 'Die Seite wird serverseitig ausgelesen (nur online, Token nötig). Seiten ohne Rezept-Daten liest die KI aus.'}
            </p>
            {!reel && (
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-secondary-700 dark:text-secondary-300">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-primary-600"
                  checked={aiReview}
                  onChange={(e) => setAiReview(e.target.checked)}
                />
                <span>
                  Mit KI prüfen und ergänzen
                  <span className="block text-xs text-secondary-500">
                    Die KI gleicht das importierte Rezept mit der Seite ab und korrigiert oder ergänzt fehlende Angaben (dauert etwas länger).
                  </span>
                </span>
              </label>
            )}
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

        {busy && progress && <p className="mt-3 text-sm text-secondary-600 dark:text-secondary-300">{progress}</p>}
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

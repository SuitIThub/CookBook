import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  localRecipeIngredients,
  localRecipesByIngredient,
  unifyLocalIngredients
} from '@/lib/localData';
import CatalogueModal from '@/components/CatalogueModal';

interface Row {
  name: string;
  usageCount: number;
}

/* --------------------------------------------------- merge-suggestion logic */

function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[.,;:]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/(en|er|e|n|s)$/,''); // crude German plural/inflection stripping
}
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}
function computeSuggestions(rows: Row[]): [Row, Row][] {
  const pairs: [Row, Row][] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      const na = normalize(a.name), nb = normalize(b.name);
      if (!na || !nb) continue;
      const similar = na === nb || (Math.min(na.length, nb.length) >= 4 && levenshtein(na, nb) <= 1);
      if (similar) pairs.push(a.usageCount >= b.usageCount ? [a, b] : [b, a]);
    }
  }
  return pairs;
}

/* -------------------------------------------------------------------- page */

export default function IngredientsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['recipe-ingredients'], queryFn: localRecipeIngredients });
  const [q, setQ] = useState('');
  const [rename, setRename] = useState<Row | null>(null);
  const [unify, setUnify] = useState<Row | null>(null);
  const [recipesFor, setRecipesFor] = useState<Row | null>(null);
  const [catalogueFor, setCatalogueFor] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Match the website's alphabetical order (/api/ingredients?all=true).
  const all = useMemo(() => [...(data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'de')), [data]);
  const ingredients = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((i) => i.name.toLowerCase().includes(needle)) : all;
  }, [all, q]);

  const refresh = () => queryClient.invalidateQueries();

  if (isLoading) return <p className="text-gray-500 dark:text-gray-400">Lade Zutaten …</p>;
  if (isError) return <p className="text-red-600 dark:text-red-400">Fehler: {(error as Error).message}</p>;

  return (
    <div>
      <div className="mb-6 flex flex-col gap-2 not-mobile:flex-row not-mobile:items-center not-mobile:justify-between">
        <div className="min-w-0">
          <h1 className="mb-1 text-2xl font-bold text-gray-900 not-mobile:mb-2 not-mobile:text-3xl dark:text-white">Zutaten</h1>
          <p className="text-sm text-gray-600 not-mobile:text-base dark:text-gray-400">Verwalten und vereinheitlichen Sie Zutaten aus allen Rezepten</p>
        </div>
        <div className="text-sm text-gray-500 not-mobile:flex-shrink-0 dark:text-gray-400">
          {all.length} {all.length === 1 ? 'Zutat' : 'Zutaten'}
        </div>
      </div>

      <div className="mb-6 flex flex-col gap-2 not-mobile:flex-row not-mobile:items-center not-mobile:gap-3">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Zutaten suchen..."
          className="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 not-mobile:flex-1 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
        <button
          type="button"
          onClick={() => setShowSuggestions(true)}
          title="Zusammenführungsvorschläge"
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-purple-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-600 not-mobile:w-auto not-mobile:whitespace-nowrap"
        >
          <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
          <span className="not-mobile:hidden">Vorschläge</span>
          <span className="hidden not-mobile:inline">Zusammenführungsvorschläge</span>
        </button>
      </div>

      {ingredients.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-gray-500 dark:text-gray-400">Keine Zutaten gefunden.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {ingredients.map((i) => (
            <div key={i.name} className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3 transition-shadow hover:shadow-md not-mobile:flex-row not-mobile:items-center not-mobile:justify-between not-mobile:p-4 dark:border-gray-700 dark:bg-gray-800">
              <div className="min-w-0">
                <span className="break-words font-medium text-gray-900 dark:text-white">{i.name}</span>
                <span className="ml-1.5 text-sm text-gray-500 dark:text-gray-400">({i.usageCount} {i.usageCount === 1 ? 'Rezept' : 'Rezepte'})</span>
              </div>
              <div className="grid grid-cols-2 gap-2 not-mobile:flex not-mobile:flex-wrap not-mobile:items-center not-mobile:shrink-0">
                <RowBtn color="emerald" onClick={() => setCatalogueFor(i.name)} title="Nährwerte, Dichte, Gramm pro Einheit" label="Nährwerte" path="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                <RowBtn color="green" onClick={() => setRecipesFor(i)} title="Rezepte mit dieser Zutat" label="Rezepte" path="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                <RowBtn color="blue" onClick={() => setRename(i)} title="Zutat umbenennen" label="Umbenennen" path="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                <RowBtn color="orange" onClick={() => setUnify(i)} title="Mit einer anderen Zutat vereinheitlichen" label="Vereinheitlichen" path="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </div>
            </div>
          ))}
        </div>
      )}

      {rename && (
        <RenameModal
          row={rename}
          onClose={() => setRename(null)}
          onDone={() => {
            setRename(null);
            refresh();
          }}
        />
      )}
      {unify && (
        <UnifyModal
          row={unify}
          all={all}
          onClose={() => setUnify(null)}
          onDone={() => {
            setUnify(null);
            refresh();
          }}
        />
      )}
      {recipesFor && <RecipesModal row={recipesFor} onClose={() => setRecipesFor(null)} />}
      {catalogueFor && <CatalogueModal name={catalogueFor} onClose={() => setCatalogueFor(null)} onSaved={refresh} />}
      {showSuggestions && (
        <SuggestionsModal
          suggestions={computeSuggestions(all)}
          onClose={() => setShowSuggestions(false)}
          onMerged={refresh}
        />
      )}
    </div>
  );
}

function RowBtn({ color, onClick, title, label, path }: { color: string; onClick: () => void; title: string; label: string; path: string }) {
  const cls: Record<string, string> = {
    emerald: 'bg-emerald-500 hover:bg-emerald-600',
    green: 'bg-green-500 hover:bg-green-600',
    blue: 'bg-blue-500 hover:bg-blue-600',
    orange: 'bg-orange-500 hover:bg-orange-600'
  };
  return (
    <button type="button" onClick={onClick} title={title} className={`inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium text-white transition-colors not-mobile:text-sm ${cls[color]}`}>
      <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path} /></svg>
      <span className="truncate">{label}</span>
    </button>
  );
}

/* ---------------------------------------------------------------- modals */

function ModalShell({ title, onClose, children, maxW = 'max-w-md' }: { title: string; onClose: () => void; children: React.ReactNode; maxW?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={onClose}>
      <div className={`w-full ${maxW} rounded-lg bg-white p-6 shadow-2xl dark:bg-gray-800`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h2>
          <button onClick={onClose} className="text-2xl leading-none text-gray-500 hover:text-gray-800 dark:text-gray-300">&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RenameModal({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const [val, setVal] = useState(row.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    const nn = val.trim();
    if (!nn || nn === row.name) return onClose();
    setBusy(true);
    try {
      await unifyLocalIngredients(row.name, nn);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <ModalShell title="Zutat umbenennen" onClose={onClose}>
      <p className="mb-4 text-gray-600 dark:text-gray-400">
        Geben Sie den neuen Namen für "<span className="font-semibold">{row.name}</span>" ein:
      </p>
      <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="Neuer Zutatenname..." className="mb-4 w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white" />
      {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
      <div className="flex justify-end space-x-3">
        <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">Abbrechen</button>
        <button onClick={submit} disabled={busy} className="rounded-lg bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:opacity-50">Umbenennen</button>
      </div>
    </ModalShell>
  );
}

function UnifyModal({ row, all, onClose, onDone }: { row: Row; all: Row[]; onClose: () => void; onDone: () => void }) {
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const others = all.filter((r) => r.name !== row.name);
  const submit = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await unifyLocalIngredients(row.name, target);
      onDone();
    } catch {
      setBusy(false);
    }
  };
  return (
    <ModalShell title="Zutaten vereinheitlichen" onClose={onClose}>
      <p className="mb-4 text-gray-600 dark:text-gray-400">
        "<span className="font-semibold">{row.name}</span>" in eine andere Zutat überführen. Alle Rezepte werden aktualisiert.
      </p>
      <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Ziel-Zutat</label>
      <select value={target} onChange={(e) => setTarget(e.target.value)} className="mb-4 w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white">
        <option value="">Zutat wählen …</option>
        {others.map((r) => (
          <option key={r.name} value={r.name}>{r.name} ({r.usageCount})</option>
        ))}
      </select>
      <div className="flex justify-end space-x-3">
        <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">Abbrechen</button>
        <button onClick={submit} disabled={!target || busy} className="rounded-lg bg-orange-500 px-4 py-2 text-white hover:bg-orange-600 disabled:opacity-50">Vereinheitlichen</button>
      </div>
    </ModalShell>
  );
}

function RecipesModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['recipes-by-ingredient', row.name], queryFn: () => localRecipesByIngredient(row.name) });
  return (
    <ModalShell title={`Rezepte mit „${row.name}“`} onClose={onClose}>
      {isLoading ? (
        <p className="text-gray-500">Lade …</p>
      ) : (data ?? []).length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">Keine Rezepte gefunden.</p>
      ) : (
        <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
          {(data ?? []).map((r) => (
            <li key={r.id}>
              <Link to={`/rezept/${r.id}`} onClick={onClose} className="block rounded-lg px-3 py-2 text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700">
                {r.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ModalShell>
  );
}

function SuggestionsModal({ suggestions, onClose, onMerged }: { suggestions: [Row, Row][]; onClose: () => void; onMerged: () => void }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const merge = async (keep: Row, drop: Row) => {
    await unifyLocalIngredients(drop.name, keep.name);
    setDone((s) => new Set(s).add(drop.name + '→' + keep.name));
    onMerged();
  };
  return (
    <ModalShell title="Zusammenführungsvorschläge" onClose={onClose} maxW="max-w-lg">
      {suggestions.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">Keine ähnlichen Zutaten gefunden.</p>
      ) : (
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
          {suggestions.map(([keep, drop], i) => {
            const key = drop.name + '→' + keep.name;
            const merged = done.has(key);
            return (
              <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <div className="min-w-0 text-sm">
                  <span className="font-medium text-gray-900 dark:text-white">{drop.name}</span>
                  <span className="mx-2 text-gray-400">→</span>
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">{keep.name}</span>
                </div>
                {merged ? (
                  <span className="text-xs text-emerald-600">✓ zusammengeführt</span>
                ) : (
                  <button onClick={() => merge(keep, drop)} className="shrink-0 rounded bg-orange-500 px-3 py-1 text-xs text-white hover:bg-orange-600">Zusammenführen</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </ModalShell>
  );
}

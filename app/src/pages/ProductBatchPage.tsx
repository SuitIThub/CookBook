import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import BarcodeScanner from '@/components/BarcodeScanner';
import { lookupProductByEan, searchProducts } from '@/lib/products';
import { apiPost } from '@/lib/api';
import { getAiSettings } from '@/lib/settings';
import { localIngredients } from '@/lib/localData';
import { runSync } from '@/lib/syncRunner';
import { addItem, commitRequest, CONFIDENCE_LABEL, itemFromLookup, matchRequest, type BatchItem, type BatchMatch } from '@core/productBatch';

/** Website /produkte/import: scan/search several products, match them to ingredients, review, save. */
export default function ProductBatchPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<BatchItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BatchItem[]>([]);
  const [status, setStatus] = useState('');
  const [step, setStep] = useState<'collect' | 'review'>('collect');
  const [matches, setMatches] = useState<BatchMatch[] | null>(null);
  const [matchError, setMatchError] = useState('');
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [defaults, setDefaults] = useState<boolean[]>([]);
  const [catalogue, setCatalogue] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    localIngredients()
      .then((list) => setCatalogue(list.map((c) => c.name)))
      .catch(() => {});
  }, []);

  const add = (item: BatchItem | null): boolean => {
    if (!item) return false;
    let added = false;
    setItems((list) => {
      const r = addItem(list, item);
      added = r.added;
      return r.list;
    });
    return added;
  };

  const lookupEan = async (ean: string) => {
    setStatus(`EAN ${ean} wird gesucht …`);
    try {
      const r = await lookupProductByEan(ean);
      if (!r.product) {
        setStatus(`Kein Produkt zu EAN ${ean} gefunden — per Suche ergänzen.`);
        return;
      }
      const item = itemFromLookup({ ...r.product, ean: r.product.ean ?? ean }, r.source);
      add(item);
      setStatus(`Hinzugefügt: ${item?.name}`);
    } catch (e) {
      setStatus(`Suche fehlgeschlagen: ${(e as Error).message}`);
    }
  };

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    if (/^\d{8,14}$/.test(q)) return lookupEan(q);
    setStatus('Suche läuft …');
    setResults([]);
    try {
      const data = await searchProducts(q, 1, 20);
      const hits = [
        ...(data.local ?? []).map((p) => itemFromLookup(p, 'local')),
        ...(data.results ?? []).map((p) => itemFromLookup(p, 'openfoodfacts'))
      ].filter(Boolean) as BatchItem[];
      setResults(hits);
      setStatus(hits.length ? `${hits.length} Treffer — mit + hinzufügen.` : data.error ? `Online-Suche fehlgeschlagen: ${data.error}` : 'Keine Treffer.');
    } catch (e) {
      setStatus(`Suche fehlgeschlagen: ${(e as Error).message}`);
    }
  };

  const runMatch = async () => {
    setStep('review');
    setMatches(null);
    setMatchError('');
    setSaveMsg(null);
    try {
      const data = await apiPost<{ matches: BatchMatch[] }>('/api/products/batch/match', { items: matchRequest(items), ai: getAiSettings() }, { timeoutMs: 90000 });
      setMatches(data.matches);
      setIngredients(data.matches.map((m) => m.ingredient));
      setDefaults(data.matches.map(() => false));
    } catch (e) {
      setMatchError((e as Error).message);
    }
  };

  const commit = async () => {
    setSaving(true);
    setSaveMsg({ text: 'Speichere …', ok: true });
    try {
      const r = await apiPost<{ created: number; updated: number; ingredientsCreated: number }>('/api/products/batch/commit', { items: commitRequest(items, ingredients, defaults) }, { timeoutMs: 60000 });
      setSaveMsg({ text: `Fertig: ${r.created} Produkt(e) angelegt, ${r.updated} vorhandene verknüpft, ${r.ingredientsCreated} Zutat(en) neu.`, ok: true });
      await runSync().catch(() => {});
      setTimeout(() => navigate('/produkte'), 1500);
    } catch (e) {
      setSaveMsg({ text: `Speichern fehlgeschlagen: ${(e as Error).message}`, ok: false });
      setSaving(false);
    }
  };

  const thumb = (url?: string) => (
    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-gray-100 text-lg dark:bg-gray-700">
      {url ? <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" /> : '🥫'}
    </div>
  );
  const describe = (i: BatchItem) => [i.brand, i.packageLabel, i.ean ? `EAN ${i.ean}` : ''].filter(Boolean).join(' · ');
  const card = 'rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800';

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link to="/produkte" className="text-sm text-orange-600 hover:underline dark:text-orange-400">
          ← Produktregister
        </Link>
        <h1 className="mt-1 text-3xl font-bold text-gray-900 dark:text-white">Mehrere Produkte hinzufügen</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">Produkte nacheinander scannen oder suchen. Danach werden sie automatisch den Zutaten zugeordnet — du prüfst die Zuordnung vor dem Speichern.</p>
      </div>

      {step === 'collect' && (
        <>
          <div className={`${card} space-y-3`}>
            <button type="button" onClick={() => setScanning(true)} className="rounded bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600">
              Barcodes scannen
            </button>
            <div className="flex gap-2">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void search()}
                placeholder="Name, Marke oder EAN suchen …"
                className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
              />
              <button type="button" onClick={() => void search()} className="rounded bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600">
                Suchen
              </button>
            </div>
            {status && <p className="text-xs text-gray-500 dark:text-gray-400">{status}</p>}
            {results.length > 0 && (
              <div className="max-h-72 divide-y divide-gray-100 overflow-y-auto dark:divide-gray-700">
                {results.map((hit) => {
                  const inList = items.some((i) => i.key === hit.key || (hit.ean && i.ean === hit.ean));
                  return (
                    <div key={hit.key} className="flex items-center gap-3 py-2">
                      {thumb(hit.imageUrl)}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-gray-900 dark:text-white">{hit.name}</div>
                        <div className="truncate text-xs text-gray-500 dark:text-gray-400">{[hit.registered ? 'Register' : 'Open Food Facts', describe(hit)].filter(Boolean).join(' · ')}</div>
                      </div>
                      <button type="button" disabled={inList} onClick={() => add(hit)} aria-label={`${hit.name} hinzufügen`} className="rounded bg-orange-500 px-3 py-1 text-white hover:bg-orange-600 disabled:opacity-50">
                        {inList ? '✓' : '+'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className={card}>
            <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Erfasst ({items.length})</h2>
            {items.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">Noch nichts erfasst.</p>}
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {items.map((item) => (
                <div key={item.key} className="flex items-center gap-3 py-2">
                  {thumb(item.imageUrl)}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-gray-900 dark:text-white">{item.name}</div>
                    <div className="truncate text-xs text-gray-500 dark:text-gray-400">{describe(item)}</div>
                    {item.registered && <span className="mt-0.5 inline-block rounded bg-blue-100 px-1.5 text-[10px] text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">bereits im Register</span>}
                  </div>
                  <button type="button" onClick={() => setItems((l) => l.filter((x) => x !== item))} aria-label={`${item.name} entfernen`} className="px-2 text-lg text-red-500 hover:text-red-700">
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button type="button" disabled={items.length === 0} onClick={() => void runMatch()} className="rounded bg-orange-500 px-4 py-2 font-medium text-white hover:bg-orange-600 disabled:opacity-50">
              Weiter: Zutaten zuordnen
            </button>
          </div>
        </>
      )}

      {step === 'review' && (
        <>
          <div className={card}>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Zuordnung prüfen</h2>
            <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">Zutat ändern, leeren (= nur Produkt anlegen) oder einen neuen Namen eintippen (= neue Zutat). „Standard“ macht das Produkt zum Standardprodukt der Zutat.</p>
            {!matches && !matchError && <p className="py-3 text-sm text-gray-500">Zutaten werden zugeordnet …</p>}
            {matchError && <p className="py-3 text-sm text-red-600 dark:text-red-400">Zuordnung fehlgeschlagen: {matchError}</p>}
            {matches && (
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {items.map((item, i) => {
                  const m = matches[i];
                  const conf = CONFIDENCE_LABEL[m?.confidence ?? 'keine'];
                  const isNew = ingredients[i]?.trim() && !catalogue.some((c) => c.toLowerCase() === ingredients[i].trim().toLowerCase());
                  return (
                    <div key={item.key} className="flex items-start gap-3 py-3">
                      {thumb(item.imageUrl)}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="truncate text-sm font-medium text-gray-900 dark:text-white">{item.name}</div>
                        <div className="truncate text-xs text-gray-500 dark:text-gray-400">{describe(item)}</div>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            value={ingredients[i] ?? ''}
                            list="batch-catalogue"
                            placeholder="Zutat (leer = keine)"
                            aria-label={`Zutat für ${item.name}`}
                            onChange={(e) => setIngredients((l) => l.map((v, j) => (j === i ? e.target.value : v)))}
                            className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                          />
                          <span title={m?.reason} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${conf.cls}`}>
                            {conf.label}
                          </span>
                          <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                            <input type="checkbox" checked={!!defaults[i]} onChange={(e) => setDefaults((l) => l.map((v, j) => (j === i ? e.target.checked : v)))} />
                            Standard
                          </label>
                        </div>
                        {isNew && <div className="text-[11px] text-indigo-600 dark:text-indigo-400">Zutat wird neu angelegt.</div>}
                      </div>
                    </div>
                  );
                })}
                <datalist id="batch-catalogue">
                  {catalogue.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
            )}
          </div>
          {saveMsg && <p className={`text-sm ${saveMsg.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{saveMsg.text}</p>}
          <div className="flex justify-between gap-2">
            <button type="button" onClick={() => setStep('collect')} disabled={saving} className="rounded border border-gray-300 px-4 py-2 text-gray-700 dark:border-gray-600 dark:text-gray-200">
              Zurück
            </button>
            <button type="button" onClick={() => void commit()} disabled={saving || !matches} className="rounded bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-700 disabled:opacity-50">
              Übernehmen
            </button>
          </div>
        </>
      )}

      {scanning && <BarcodeScanner continuous onDetected={(ean) => void lookupEan(ean)} onClose={() => setScanning(false)} />}
    </div>
  );
}

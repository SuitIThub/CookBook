import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiGet, apiPost, apiUpload } from '@/lib/api';
import { getAiSettings } from '@/lib/settings';
import { localProducts, localSupermarkets } from '@/lib/localData';
import { onSyncDataChanged, runSync } from '@/lib/syncRunner';
import type { Product, Supermarket } from '@shared/tracker';
import {
  CHANGE_CLS,
  commitLines,
  currentPrice,
  euro,
  initialChoice,
  LINE_CONFIDENCE,
  packPrice,
  priceChange,
  suggestName,
  type LineChoice,
  type ReceiptResult
} from '@core/receiptReview';

/** Website /produkte/kassenbon: read a receipt (photo/PDF), match lines to products, review, save prices. */
interface Job {
  stage: string;
  message: string;
  result?: ReceiptResult;
  error?: string;
}

export default function ReceiptImportPage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [markets, setMarkets] = useState<Supermarket[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [presetMarket, setPresetMarket] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ReceiptResult | null>(null);
  // review state
  const [marketId, setMarketId] = useState(''); // '' = new
  const [newMarket, setNewMarket] = useState('');
  const [date, setDate] = useState('');
  const [choices, setChoices] = useState<LineChoice[]>([]);
  const [newNames, setNewNames] = useState<string[]>([]);
  const [prices, setPrices] = useState<number[]>([]);
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean; changes?: { product: string; before: number | null; after: number }[] } | null>(null);

  // Prices shown as "bisher" come from the local replica → refresh when a sync brings news.
  const reloadLists = () => {
    localSupermarkets().then(setMarkets).catch(() => {});
    localProducts().then(setProducts).catch(() => {});
  };
  useEffect(() => {
    reloadLists();
    return onSyncDataChanged(reloadLists);
  }, []);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const sortedProducts = useMemo(() => [...products].sort((a, b) => a.name.localeCompare(b.name, 'de')), [products]);
  const label = (p: Product) => (p.brand ? `${p.brand} – ${p.name}` : p.name);

  const analyze = async () => {
    setBusy(true);
    setError('');
    setProgress('Beleg wird hochgeladen …');
    try {
      const form = new FormData();
      files.forEach((f) => form.append('file', f, f.name));
      if (presetMarket) form.append('supermarketId', presetMarket);
      form.append('ai', JSON.stringify(getAiSettings()));
      const started = await apiUpload<{ jobId: string; message: string }>('/api/receipts/analyze', form);
      setProgress(started.message);
      let job: Job = { stage: 'read', message: started.message };
      while (job.stage !== 'done' && job.stage !== 'error') {
        await new Promise((r) => setTimeout(r, 2000));
        job = await apiGet<Job>(`/api/receipts/analyze?job=${encodeURIComponent(started.jobId)}`);
        setProgress(job.message);
      }
      if (job.stage === 'error' || !job.result) throw new Error(job.error || 'Auswertung fehlgeschlagen.');
      // Current prices for the "bisher → neu" hints: catch up with the server first.
      await runSync().catch(() => {});
      const [m, p] = await Promise.all([localSupermarkets(), localProducts()]);
      setMarkets(m);
      setProducts(p);
      const r = job.result;
      setResult(r);
      setMarketId(r.supermarketId ?? '');
      setNewMarket(r.supermarketId ? '' : r.store);
      setDate(r.date);
      setChoices(r.lines.map(initialChoice));
      setNewNames(r.lines.map((l) => suggestName(l.text)));
      setPrices(r.lines.map((l) => l.unitPrice));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!result) return;
    setBusy(true);
    setSaveMsg({ text: 'Speichere …', ok: true });
    try {
      const r = await apiPost<{ prices: number; productsCreated: number; ignored: number; learned: number; changes: { product: string; before: number | null; after: number }[] }>(
        '/api/receipts/commit',
        { supermarketId: marketId || undefined, newSupermarket: marketId ? undefined : newMarket, date, lines: commitLines(result.lines, choices, newNames, prices) },
        { timeoutMs: 60000 }
      );
      setSaveMsg({ text: `Gespeichert: ${r.prices} Preis(e), ${r.productsCreated} Produkt(e) neu, ${r.ignored} ignoriert, ${r.learned} Posten gemerkt.`, ok: true, changes: r.changes });
      await runSync().catch(() => {});
    } catch (e) {
      setSaveMsg({ text: `Speichern fehlgeschlagen: ${(e as Error).message}`, ok: false });
    } finally {
      setBusy(false);
    }
  };

  const card = 'rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800';
  const field = 'rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white';

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link to="/produkte" className="text-sm text-orange-600 hover:underline dark:text-orange-400">
          ← Produktregister
        </Link>
        <h1 className="mt-1 text-3xl font-bold text-gray-900 dark:text-white">Kassenbon einlesen</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">Foto oder PDF eines Kassenbons bzw. einer Rechnung hochladen. Die Posten werden Produkten zugeordnet; du prüfst alles, bevor Preise gespeichert werden. Die Bilder werden nach der Auswertung gelöscht.</p>
      </div>

      {!result && (
        <div className={`${card} space-y-3`}>
          <label className="block text-sm text-gray-700 dark:text-gray-200">
            Supermarkt
            <select value={presetMarket} onChange={(e) => setPresetMarket(e.target.value)} className={`mt-1 block w-full ${field}`}>
              <option value="">automatisch erkennen</option>
              {markets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <label className="cursor-pointer rounded bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600">
              Foto aufnehmen
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setFiles((f) => [...f, ...Array.from(e.target.files ?? [])])} />
            </label>
            <label className="cursor-pointer rounded bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600">
              Bilder/PDF wählen
              <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => setFiles((f) => [...f, ...Array.from(e.target.files ?? [])])} />
            </label>
          </div>
          {files.length > 0 && (
            <ul className="text-sm text-gray-700 dark:text-gray-200">
              {files.map((f, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span className="truncate">{f.name}</span>
                  <button type="button" onClick={() => setFiles((l) => l.filter((_, j) => j !== i))} aria-label={`${f.name} entfernen`} className="px-2 text-red-500">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400">Lange Bons gern in mehreren Fotos. Ausgewertet mit dem Modell „Bilder lesen“ aus den KI-Einstellungen.</p>
          {(busy || progress) && !error && <p className="text-sm text-gray-600 dark:text-gray-300">{progress}</p>}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end">
            <button type="button" disabled={busy || files.length === 0} onClick={() => void analyze()} className="rounded bg-orange-500 px-4 py-2 font-medium text-white hover:bg-orange-600 disabled:opacity-50">
              Auswerten
            </button>
          </div>
        </div>
      )}

      {result && (
        <>
          <div className={`${card} grid grid-cols-1 gap-3 sm:grid-cols-2`}>
            <label className="block text-sm text-gray-700 dark:text-gray-200">
              Supermarkt
              <select value={marketId} onChange={(e) => setMarketId(e.target.value)} className={`mt-1 block w-full ${field}`}>
                <option value="">+ Neuer Supermarkt …</option>
                {markets.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              {!marketId && <input value={newMarket} onChange={(e) => setNewMarket(e.target.value)} placeholder="Name des Supermarkts" className={`mt-1 block w-full ${field}`} />}
            </label>
            <label className="block text-sm text-gray-700 dark:text-gray-200">
              Datum
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`mt-1 block w-full ${field}`} />
              {result.total != null && <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">Summe laut Beleg: {euro(result.total)}</span>}
            </label>
          </div>

          <div className={`${card} divide-y divide-gray-100 dark:divide-gray-700`}>
            {result.lines.map((line, i) => {
              const choice = choices[i] ?? '';
              const product = choice && choice !== 'new' && choice !== 'ignore' ? byId.get(choice) : undefined;
              const after = packPrice(line.unit, prices[i] ?? line.unitPrice, product);
              const change = choice && choice !== 'ignore' ? priceChange(currentPrice(product, marketId || null), after) : null;
              const conf = LINE_CONFIDENCE[line.confidence];
              const candidateIds = new Set(line.candidates.map((c) => c.id));
              return (
                <div key={i} className="space-y-1 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-sm text-gray-900 dark:text-white">{line.text}</span>
                    <span title={line.reason} className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${conf.cls}`}>
                      {conf.label}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                    <span>{line.unit === 'kg' ? `${line.quantity.toLocaleString('de-DE')} kg ×` : `${line.quantity} ×`}</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={prices[i] ?? ''}
                      aria-label={`Regulärer Preis für ${line.text}`}
                      onChange={(e) => setPrices((l) => l.map((v, j) => (j === i ? Number(e.target.value) : v)))}
                      className={`w-20 ${field}`}
                    />
                    <span>{line.unit === 'kg' ? '€/kg' : '€'} regulär</span>
                    {line.discount > 0 && <span className="text-green-700 dark:text-green-400">−{euro(line.discount)} Rabatt (bezahlt {euro(line.total)})</span>}
                  </div>
                  <select
                    value={choice}
                    aria-label={`Produkt für ${line.text}`}
                    onChange={(e) => setChoices((l) => l.map((v, j) => (j === i ? e.target.value : v)))}
                    className={`block w-full ${field}`}
                  >
                    <option value="">— nicht übernehmen —</option>
                    <option value="ignore">Ignorieren (immer)</option>
                    <option value="new">+ Neues Produkt anlegen …</option>
                    {line.candidates.length > 0 && (
                      <optgroup label="Passende Produkte">
                        {line.candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Alle Produkte">
                      {sortedProducts
                        .filter((p) => !candidateIds.has(p.id))
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {label(p)}
                          </option>
                        ))}
                    </optgroup>
                  </select>
                  {choice === 'new' && (
                    <input
                      value={newNames[i] ?? ''}
                      onChange={(e) => setNewNames((l) => l.map((v, j) => (j === i ? e.target.value : v)))}
                      placeholder="Name des neuen Produkts"
                      aria-label={`Name für neues Produkt aus ${line.text}`}
                      className={`block w-full ${field}`}
                    />
                  )}
                  {change && <p className={`text-xs ${CHANGE_CLS[change.tone]}`}>{change.text}</p>}
                </div>
              );
            })}
          </div>

          {saveMsg && (
            <div className={`text-sm ${saveMsg.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              <p>{saveMsg.text}</p>
              {saveMsg.changes && saveMsg.changes.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs text-gray-700 dark:text-gray-300">
                  {saveMsg.changes.map((c, i) => (
                    <li key={i}>
                      {c.product}: {priceChange(c.before, c.after).text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="flex justify-between gap-2">
            <button type="button" onClick={() => (saveMsg?.ok && !busy ? navigate('/produkte') : setResult(null))} disabled={busy} className="rounded border border-gray-300 px-4 py-2 text-gray-700 dark:border-gray-600 dark:text-gray-200">
              {saveMsg?.ok && !busy ? 'Zum Produktregister' : 'Zurück'}
            </button>
            <button type="button" onClick={() => void save()} disabled={busy || !!(saveMsg?.ok && saveMsg.changes)} className="rounded bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-700 disabled:opacity-50">
              Übernehmen
            </button>
          </div>
        </>
      )}
    </div>
  );
}

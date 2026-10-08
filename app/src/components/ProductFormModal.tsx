import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Product, Supermarket, CatalogueIngredient } from '@shared/tracker';
import type { NutritionData } from '@shared/recipe';
import {
  saveLocalProduct,
  deleteLocalProduct,
  localSupermarkets,
  localIngredients,
  ensureLocalCatalogueIngredient,
  type ProductInput
} from '@/lib/localData';
import {
  lookupProductByEan,
  searchProducts,
  type LookedUpProduct,
  type GbuSuggestion
} from '@/lib/products';
import { uploadProductImage } from '@/lib/productImages';
import { assetUrl } from '@/lib/api';
import { getAvailableUnits, findUnit, servingUnitName } from '@core/units';
import BarcodeScanner from './BarcodeScanner';

interface Props {
  product: Product | null; // null = new
  onClose: () => void;
  onSaved: () => void;
  /** Pre-link this ingredient name after opening (from /zutaten "assign product"). */
  prelinkIngredientName?: string;
  /** Open the barcode scanner immediately (from the "Barcode scannen" button). */
  autoScan?: boolean;
}

const NUTRIENTS: { key: keyof NutritionData; label: string; step: string }[] = [
  { key: 'calories', label: 'kcal', step: '1' },
  { key: 'carbohydrates', label: 'KH (g)', step: '0.1' },
  { key: 'sugar', label: 'Zucker (g)', step: '0.1' },
  { key: 'protein', label: 'Eiweiß (g)', step: '0.1' },
  { key: 'fat', label: 'Fett (g)', step: '0.1' },
  { key: 'saturatedFat', label: 'ges. Fett (g)', step: '0.1' },
  { key: 'fiber', label: 'Ballaststoffe (g)', step: '0.1' },
  { key: 'salt', label: 'Salz (g)', step: '0.01' }
];

const numOrUndef = (s: string): number | undefined => {
  const n = Number(s.replace(',', '.'));
  return s.trim() === '' || Number.isNaN(n) ? undefined : n;
};

const inputCls =
  'mt-1 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-white';

function canonicalUnitLabel(unit: string): string {
  const found = findUnit(unit.trim());
  return found?.displayName || found?.name || unit.trim();
}

export default function ProductFormModal({ product, onClose, onSaved, prelinkIngredientName, autoScan }: Props) {
  const [name, setName] = useState(product?.name ?? '');
  const [brand, setBrand] = useState(product?.brand ?? '');
  const [ean, setEan] = useState(product?.ean ?? '');
  const [netGrams, setNetGrams] = useState(product?.netGrams != null ? String(product.netGrams) : '');
  const [packageLabel, setPackageLabel] = useState(product?.packageLabel ?? '');
  const [price, setPrice] = useState(product?.defaultPrice != null ? String(product.defaultPrice) : '');
  const [imageUrl, setImageUrl] = useState(product?.imageUrl ?? '');
  const [source, setSource] = useState<'manual' | 'openfoodfacts'>(product?.source ?? 'manual');
  const [offCode, setOffCode] = useState(product?.offCode ?? '');
  const [nutrition, setNutrition] = useState<Record<string, string>>(() => {
    const n = product?.nutritionPer100g ?? {};
    const out: Record<string, string> = {};
    for (const { key } of NUTRIENTS) {
      const v = (n as any)[key];
      out[key] = v != null ? String(v) : '';
    }
    return out;
  });
  const [gramsByUnit, setGramsByUnit] = useState<Record<string, number>>(product?.gramsByUnit ?? {});
  const [gbuSuggestions, setGbuSuggestions] = useState<GbuSuggestion[]>([]);
  const [marketPrices, setMarketPrices] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const s of product?.supermarkets ?? []) out[s.supermarketId] = String(s.price);
    return out;
  });
  const [ingredientIds, setIngredientIds] = useState<string[]>(product?.ingredientIds ?? []);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(!!autoScan);
  const [imgStatus, setImgStatus] = useState<string | null>(null);

  // OFF search state
  const [offQuery, setOffQuery] = useState('');
  const [offStatus, setOffStatus] = useState('');
  const [offLocal, setOffLocal] = useState<Product[]>([]);
  const [offResults, setOffResults] = useState<LookedUpProduct[]>([]);
  const [offPage, setOffPage] = useState(0);
  const [offHasMore, setOffHasMore] = useState(false);
  const [offLoading, setOffLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const { data: supermarkets = [] } = useQuery({ queryKey: ['supermarkets'], queryFn: localSupermarkets });
  const { data: catalogue = [] } = useQuery({ queryKey: ['catalogue'], queryFn: localIngredients });

  const [gbuUnit, setGbuUnit] = useState('');
  const [gbuGrams, setGbuGrams] = useState('');
  const [ingInput, setIngInput] = useState('');

  // Pre-link an ingredient by name once the catalogue is loaded.
  const prelinkDone = useRef(false);
  useEffect(() => {
    if (prelinkDone.current || !prelinkIngredientName) return;
    prelinkDone.current = true;
    void addIngredientByName(prelinkIngredientName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogue]);

  const catalogueById = useMemo(() => {
    const m = new Map<string, CatalogueIngredient>();
    for (const c of catalogue) m.set(c.id, c);
    return m;
  }, [catalogue]);

  const applyLookup = (p: LookedUpProduct, opts: { fromOff?: boolean } = {}) => {
    setName(p.name ?? '');
    setBrand(p.brand ?? '');
    setEan(p.ean ?? '');
    setNetGrams(p.netGrams != null ? String(p.netGrams) : '');
    setPackageLabel(p.packageLabel ?? '');
    setImageUrl(p.imageUrl ?? '');
    if (opts.fromOff) {
      setSource('openfoodfacts');
      setOffCode(p.offCode ?? p.ean ?? '');
    }
    const n = p.nutritionPer100g ?? {};
    setNutrition(() => {
      const out: Record<string, string> = {};
      for (const { key } of NUTRIENTS) {
        const v = (n as any)[key];
        out[key] = v != null ? String(v) : '';
      }
      return out;
    });
    // Offer derived unit conversions as confirmable chips (do not write silently).
    const suggestions = Array.isArray(p.gramsByUnitSuggestions) ? [...p.gramsByUnitSuggestions] : [];
    if (suggestions.length === 0 && p.servingGrams && p.servingGrams > 0 && p.servingLabel) {
      const unit = servingUnitName(p.servingLabel);
      if (unit !== 'Portion') suggestions.push({ unit, gramsPerUnit: p.servingGrams, source: 'serving', confidence: 'medium' });
    }
    setGramsByUnit({});
    setGbuSuggestions(suggestions);
  };

  const runOffSearch = async (append = false) => {
    const query = offQuery.trim();
    if (!query) return;
    setOffLoading(true);
    setOffStatus(append ? 'Weitere Ergebnisse werden geladen …' : 'Suche läuft …');
    try {
      if (/^\d{6,14}$/.test(query)) {
        const res = await lookupProductByEan(query);
        const local = res.source === 'local' && res.product ? [res.product as unknown as Product] : [];
        const remote = res.source === 'openfoodfacts' && res.product ? [res.product] : [];
        setOffLocal(local);
        setOffResults(remote);
        setOffHasMore(false);
        setOffPage(1);
        setOffStatus(local.length + remote.length === 0 ? 'Keine Treffer.' : `${local.length + remote.length} Treffer angezeigt.`);
        return;
      }
      const nextPage = append ? offPage + 1 : 1;
      const data = await searchProducts(query, nextPage, 20);
      if (data.error) {
        setOffStatus(`Online-Suche fehlgeschlagen: ${data.error}`);
        return;
      }
      const local = append ? offLocal : data.local ?? [];
      const results = append ? [...offResults, ...(data.results ?? [])] : data.results ?? [];
      setOffLocal(local);
      setOffResults(results);
      setOffPage(data.page || nextPage);
      setOffHasMore(Boolean(data.hasMore) && (data.results?.length ?? 0) > 0);
      const shown = local.length + results.length;
      const totalPart = data.count != null ? ` von ${data.count}` : '';
      setOffStatus(shown === 0 ? 'Keine Treffer.' : `${shown} Treffer angezeigt${totalPart}${local.length ? ` (${local.length} lokal)` : ''}.`);
    } catch (err) {
      setOffStatus(`Suche fehlgeschlagen: ${(err as Error).message}`);
    } finally {
      setOffLoading(false);
    }
  };

  const acceptSuggestion = (s: GbuSuggestion) => {
    setGramsByUnit((g) => ({ ...g, [canonicalUnitLabel(s.unit)]: s.gramsPerUnit }));
    setGbuSuggestions((prev) => prev.filter((x) => x.unit !== s.unit));
  };
  const dismissSuggestion = (s: GbuSuggestion) => setGbuSuggestions((prev) => prev.filter((x) => x.unit !== s.unit));

  const addGbu = () => {
    const unit = canonicalUnitLabel(gbuUnit);
    const grams = numOrUndef(gbuGrams);
    if (!unit || grams == null || grams <= 0) return;
    setGramsByUnit((g) => ({ ...g, [unit]: grams }));
    setGbuUnit('');
    setGbuGrams('');
  };

  const addIngredientByName = async (raw: string) => {
    const nm = raw.trim();
    if (!nm) return;
    const existing = catalogue.find((c) => c.name.trim().toLowerCase() === nm.toLowerCase());
    let id = existing?.id;
    if (!id) {
      try {
        const created = await ensureLocalCatalogueIngredient(nm);
        id = created.id;
      } catch {
        setError('Zutat konnte nicht angelegt werden.');
        return;
      }
    }
    setIngredientIds((prev) => (id && !prev.includes(id) ? [...prev, id] : prev));
    setIngInput('');
  };

  const doImageFile = async (file: File) => {
    setImgStatus('Bild wird hochgeladen …');
    try {
      const res = await uploadProductImage(file);
      setImageUrl(res.url);
      setImgStatus(null);
    } catch (e) {
      setImgStatus('Upload fehlgeschlagen (offline?). Bild-URL nutzen: ' + (e as Error).message);
    }
  };

  const save = async () => {
    if (!name.trim()) {
      setError('Name ist erforderlich.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const nutr: NutritionData = {};
      let any = false;
      for (const { key } of NUTRIENTS) {
        const v = numOrUndef(nutrition[key]);
        if (v != null) {
          (nutr as any)[key] = v;
          any = true;
        }
      }
      const smPrices = Object.entries(marketPrices)
        .map(([supermarketId, v]) => ({ supermarketId, price: numOrUndef(v) }))
        .filter((r): r is { supermarketId: string; price: number } => r.price != null);

      const input: ProductInput = {
        id: product?.id,
        name: name.trim(),
        brand: brand.trim() || undefined,
        ean: ean.trim() || undefined,
        netGrams: numOrUndef(netGrams),
        packageLabel: packageLabel.trim() || undefined,
        defaultPrice: numOrUndef(price),
        nutritionPer100g: any ? nutr : null,
        gramsByUnit: Object.keys(gramsByUnit).length > 0 ? gramsByUnit : null,
        imageUrl: imageUrl.trim() || null,
        offCode: offCode.trim() || null,
        supermarkets: smPrices,
        ingredientIds,
        source
      };
      await saveLocalProduct(input);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!product) return;
    if (!confirm(`Produkt "${product.name}" löschen?`)) return;
    setBusy(true);
    try {
      await deleteLocalProduct(product.id);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const openSuggestions = gbuSuggestions.filter((s) => gramsByUnit[canonicalUnitLabel(s.unit)] == null);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-60 p-3" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-2xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 sm:p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 sm:text-xl dark:text-white">
              {product ? 'Produkt bearbeiten' : 'Neues Produkt'}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-2xl leading-none text-gray-500 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white"
              aria-label="Schließen"
            >
              &times;
            </button>
          </div>

          <div className="space-y-3">
            {/* Open Food Facts search */}
            <fieldset className="rounded border border-blue-200 bg-blue-50/40 p-3 dark:border-blue-900/60 dark:bg-blue-950/20">
              <legend className="px-1 text-sm font-medium text-gray-700 dark:text-gray-200">Open Food Facts durchsuchen</legend>
              <div className="flex flex-wrap gap-2">
                <input
                  type="search"
                  value={offQuery}
                  onChange={(e) => setOffQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), runOffSearch(false))}
                  placeholder="Produktname, Marke oder EAN …"
                  className="min-w-[12rem] flex-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                />
                <button type="button" onClick={() => runOffSearch(false)} className="rounded bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-600">
                  Suchen
                </button>
                <button type="button" onClick={() => setScanning(true)} className="rounded bg-orange-500 px-3 py-1.5 text-sm text-white hover:bg-orange-600">
                  Barcode
                </button>
              </div>
              {offStatus && <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{offStatus}</div>}
              <div className="mt-2 max-h-[min(24rem,50vh)] space-y-1 overflow-y-auto">
                {offLocal.map((p) => (
                  <div key={'l' + p.id} className="flex flex-col gap-2 rounded border border-gray-200 bg-emerald-50/50 p-2 dark:border-gray-700 dark:bg-emerald-900/10">
                    <div className="flex min-w-0 items-start gap-2">
                      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-gray-100 dark:bg-gray-700">
                        {assetUrl(p.imageUrl) ? <img src={assetUrl(p.imageUrl)} alt="" className="h-full w-full object-cover" /> : <span className="text-lg">🥫</span>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="break-words text-sm font-medium text-gray-900 dark:text-white">{p.name}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-gray-500">
                          <span className="shrink-0 font-semibold uppercase text-emerald-600 dark:text-emerald-400">lokal</span>
                          {(p.brand || p.ean) && <span className="break-all">{[p.brand, p.ean ? `EAN ${p.ean}` : ''].filter(Boolean).join(' · ')}</span>}
                        </div>
                      </div>
                    </div>
                    <button type="button" onClick={() => applyLookup(p as unknown as LookedUpProduct)} className="w-full rounded bg-emerald-500 px-2 py-1.5 text-xs text-white hover:bg-emerald-600 not-mobile:w-auto">
                      Öffnen
                    </button>
                  </div>
                ))}
                {offResults.map((p, i) => {
                  const kcal = p.nutritionPer100g?.calories;
                  const meta = [p.brand, p.packageLabel || (p.netGrams ? `${p.netGrams} g` : '')].filter(Boolean).join(' · ');
                  return (
                    <div key={'r' + (p.ean || i)} className="flex flex-col gap-2 rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
                      <div className="flex min-w-0 items-start gap-2">
                        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-gray-100 dark:bg-gray-700">
                          {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-full w-full object-cover" /> : <span className="text-lg">🥫</span>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="break-words text-sm font-medium text-gray-900 dark:text-white">{p.name || '(ohne Name)'}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-gray-500">
                            <span className="shrink-0 font-semibold uppercase text-blue-600 dark:text-blue-400">OFF</span>
                            {meta && <span className="min-w-0 break-words">{meta}</span>}
                            {p.ean && <span className="font-mono text-gray-400">EAN {p.ean}</span>}
                          </div>
                          <div className="mt-0.5 text-[11px] text-gray-600 dark:text-gray-300">
                            {kcal != null ? `${Math.round(kcal)} kcal / 100 g` : <span className="italic text-gray-400">keine Nährwerte</span>}
                          </div>
                        </div>
                      </div>
                      <button type="button" onClick={() => applyLookup(p, { fromOff: true })} className="w-full rounded bg-blue-500 px-2 py-1.5 text-xs text-white hover:bg-blue-600 not-mobile:w-auto">
                        Übernehmen
                      </button>
                    </div>
                  );
                })}
              </div>
              {offHasMore && (
                <button
                  type="button"
                  onClick={() => runOffSearch(true)}
                  disabled={offLoading}
                  className="mt-2 w-full rounded border border-blue-300 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/30"
                >
                  {offLoading ? 'Weitere Ergebnisse werden geladen …' : 'Weitere Ergebnisse laden'}
                </button>
              )}
              <p className="mt-2 text-[11px] text-gray-500">
                Community-Daten (ODbL). „Übernehmen“ füllt das Formular – erst Speichern legt das Produkt an.
              </p>
            </fieldset>

            {/* Core fields */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-gray-700 dark:text-gray-200">Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required className={inputCls} />
              </label>
              <label className="block text-sm">
                <span className="text-gray-700 dark:text-gray-200">Marke</span>
                <input value={brand} onChange={(e) => setBrand(e.target.value)} className={inputCls} />
              </label>
              <label className="block text-sm">
                <span className="text-gray-700 dark:text-gray-200">EAN</span>
                <input value={ean} onChange={(e) => setEan(e.target.value)} inputMode="numeric" className={inputCls} />
              </label>
              <label className="block text-sm">
                <span className="text-gray-700 dark:text-gray-200">Netto (g)</span>
                <input value={netGrams} onChange={(e) => setNetGrams(e.target.value)} type="number" step="0.1" className={inputCls} />
              </label>
              <label className="block text-sm">
                <span className="text-gray-700 dark:text-gray-200">Packungslabel</span>
                <input value={packageLabel} onChange={(e) => setPackageLabel(e.target.value)} className={inputCls} />
              </label>
              <label className="block text-sm">
                <span className="text-gray-700 dark:text-gray-200">Standardpreis (€)</span>
                <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" step="0.01" className={inputCls} />
              </label>

              {/* Image */}
              <div className="col-span-full block text-sm">
                <span className="text-gray-700 dark:text-gray-200">Bild</span>
                <div className="mt-1 flex flex-col gap-3 sm:flex-row">
                  <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded border border-gray-200 bg-gray-100 dark:border-gray-600 dark:bg-gray-700">
                    {assetUrl(imageUrl) ? <img src={assetUrl(imageUrl)} alt="" className="h-full w-full object-cover" /> : <span className="text-2xl">🥫</span>}
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div
                      onClick={() => fileRef.current?.click()}
                      onDragOver={(e) => (e.preventDefault(), setDragOver(true))}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOver(false);
                        const f = e.dataTransfer.files?.[0];
                        if (f) void doImageFile(f);
                      }}
                      className={
                        'cursor-pointer rounded-lg border-2 border-dashed p-3 text-center transition-colors ' +
                        (dragOver ? 'border-orange-400 dark:border-orange-500' : 'border-gray-300 hover:border-orange-400 dark:border-gray-600 dark:hover:border-orange-500')
                      }
                    >
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        <span className="font-medium">Klicken</span> oder Datei hierher ziehen
                      </p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">PNG, JPG oder WEBP (max. 10 MB)</p>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void doImageFile(f);
                        }}
                      />
                    </div>
                    {imgStatus && <p className="text-xs text-gray-500 dark:text-gray-400">{imgStatus}</p>}
                    <label className="block">
                      <span className="text-xs text-gray-500 dark:text-gray-400">oder Bild-URL</span>
                      <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} type="url" placeholder="https://…" className={inputCls} />
                    </label>
                    {imageUrl && (
                      <button type="button" onClick={() => setImageUrl('')} className="text-xs text-red-500 hover:text-red-700">
                        Bild entfernen
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Nutrition */}
            <fieldset className="rounded border border-gray-200 p-3 dark:border-gray-700">
              <legend className="px-1 text-sm font-medium text-gray-700 dark:text-gray-200">Nährwerte (pro 100 g)</legend>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {NUTRIENTS.map(({ key, label, step }) => (
                  <label key={key} className="block">
                    <span className="block text-gray-500">{label}</span>
                    <input
                      type="number"
                      step={step}
                      value={nutrition[key]}
                      onChange={(e) => setNutrition((n) => ({ ...n, [key]: e.target.value }))}
                      className="mt-0.5 w-full rounded border px-2 py-1 dark:border-gray-600 dark:bg-gray-900"
                    />
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Grams per unit */}
            <fieldset className="rounded border border-gray-200 p-3 dark:border-gray-700">
              <legend className="px-1 text-sm font-medium text-gray-700 dark:text-gray-200">Gramm pro Einheit</legend>
              {openSuggestions.length > 0 && (
                <div className="mb-2 space-y-1">
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">Aus Open Food Facts erkannt – bitte prüfen und übernehmen:</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {openSuggestions.map((s) => (
                      <span key={s.unit} className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 py-0.5 pl-2 pr-1 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
                        <span>
                          {s.unit} ≈ {s.gramsPerUnit} g{s.confidence !== 'high' && <span className="opacity-60"> (unsicher)</span>}
                        </span>
                        <button type="button" onClick={() => acceptSuggestion(s)} title="Übernehmen" className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-emerald-500 hover:text-white">✓</button>
                        <button type="button" onClick={() => dismissSuggestion(s)} title="Verwerfen" className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-red-500 hover:text-white">×</button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-2 text-sm">
                {Object.keys(gramsByUnit).length === 0 ? (
                  <p className="text-xs text-gray-500">Noch keine Einträge.</p>
                ) : (
                  Object.entries(gramsByUnit).map(([unit, grams]) => (
                    <div key={unit} className="flex items-center gap-2">
                      <span className="flex-1 text-gray-800 dark:text-gray-100">{unit}</span>
                      <span className="text-gray-600 dark:text-gray-300">{grams} g</span>
                      <button
                        type="button"
                        onClick={() => setGramsByUnit((g) => { const c = { ...g }; delete c[unit]; return c; })}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Entfernen
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  list="pf-gbu-units"
                  value={gbuUnit}
                  onChange={(e) => setGbuUnit(e.target.value)}
                  placeholder="Einheit (z.B. Scheibe, Stück, EL)"
                  className="flex-1 rounded border px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900"
                />
                <datalist id="pf-gbu-units">
                  {getAvailableUnits().map((u) => (
                    <option key={u.name} value={u.name} label={u.displayName && u.displayName !== u.name ? u.displayName : undefined} />
                  ))}
                </datalist>
                <input value={gbuGrams} onChange={(e) => setGbuGrams(e.target.value)} type="number" step="0.1" placeholder="Gramm" className="w-28 rounded border px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900" />
                <button type="button" onClick={addGbu} className="rounded bg-emerald-500 px-3 py-1 text-sm text-white hover:bg-emerald-600">Hinzufügen</button>
              </div>
              <p className="mt-2 text-[11px] text-gray-500">
                Produkt-spezifisch, z.&nbsp;B. „Scheibe“ 30 bei diesem Brot. Hat Vorrang vor der Zutaten-Umrechnung in Nährwertberechnungen.
              </p>
            </fieldset>

            {/* Supermarket prices */}
            <fieldset className="rounded border border-gray-200 p-3 dark:border-gray-700">
              <legend className="px-1 text-sm font-medium text-gray-700 dark:text-gray-200">Preise pro Supermarkt</legend>
              <div className="space-y-2">
                {supermarkets.length === 0 ? (
                  <p className="text-xs text-gray-500">Noch keine Supermärkte. Über „Supermärkte“ anlegen.</p>
                ) : (
                  supermarkets.map((s: Supermarket) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 text-gray-700 dark:text-gray-200">{s.name}</span>
                      <input
                        type="number"
                        step="0.01"
                        value={marketPrices[s.id] ?? ''}
                        onChange={(e) => setMarketPrices((m) => ({ ...m, [s.id]: e.target.value }))}
                        placeholder="€"
                        className="w-28 rounded border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-900"
                      />
                    </label>
                  ))
                )}
              </div>
              <p className="mt-1 text-[11px] text-gray-500">Leer lassen, um einen Marktpreis zu entfernen.</p>
            </fieldset>

            {/* Linked ingredients */}
            <fieldset className="rounded border border-gray-200 p-3 dark:border-gray-700">
              <legend className="px-1 text-sm font-medium text-gray-700 dark:text-gray-200">Verknüpfte Zutaten</legend>
              <div className="mb-2 flex min-h-[1.5rem] flex-wrap gap-1">
                {ingredientIds.length === 0 ? (
                  <span className="text-xs text-gray-500">Noch keine Zutaten verknüpft.</span>
                ) : (
                  ingredientIds.map((id) => (
                    <span key={id} className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                      <span>{catalogueById.get(id)?.name ?? id}</span>
                      <button type="button" onClick={() => setIngredientIds((prev) => prev.filter((x) => x !== id))} title="Entfernen" className="text-red-500 hover:text-red-700">×</button>
                    </span>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <input
                  list="pf-ing-list"
                  value={ingInput}
                  onChange={(e) => setIngInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addIngredientByName(ingInput))}
                  placeholder="Zutat suchen oder neu eingeben …"
                  className="flex-1 rounded border px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900"
                />
                <datalist id="pf-ing-list">
                  {catalogue.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
                <button type="button" onClick={() => addIngredientByName(ingInput)} className="rounded bg-emerald-500 px-3 py-1 text-sm text-white hover:bg-emerald-600">Hinzufügen</button>
              </div>
              <p className="mt-1 text-[11px] text-gray-500">Unbekannte Namen werden neu angelegt.</p>
            </fieldset>
          </div>

          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="mt-5 flex items-center justify-between gap-2">
            {product ? (
              <button
                onClick={remove}
                disabled={busy}
                className="rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                Löschen
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button onClick={onClose} disabled={busy} className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-200">
                Abbrechen
              </button>
              <button onClick={save} disabled={busy} className="rounded bg-orange-500 px-3 py-2 text-sm text-white hover:bg-orange-600 disabled:opacity-50">
                Speichern
              </button>
            </div>
          </div>
        </div>
      </div>

      {scanning && (
        <BarcodeScanner
          onDetected={(code) => {
            setScanning(false);
            setOffQuery(code);
            void (async () => {
              try {
                const res = await lookupProductByEan(code);
                if (res.product) applyLookup(res.product, { fromOff: res.source === 'openfoodfacts' });
                else setOffStatus(`Kein Treffer für Barcode ${code}.`);
              } catch (err) {
                setOffStatus(`Barcode-Lookup fehlgeschlagen: ${(err as Error).message}`);
              }
            })();
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}

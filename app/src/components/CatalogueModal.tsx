import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NutritionData } from '@shared/recipe';
import type { Product } from '@shared/tracker';
import {
  localCatalogueIngredient,
  ensureLocalCatalogueIngredient,
  saveLocalCatalogueIngredient,
  localProducts,
  setProductIngredientLink
} from '@/lib/localData';
import { getIngredientDefault, setIngredientDefault } from '@core/ingredientDefaults';
import ProductFormModal from '@/components/ProductFormModal';

/**
 * Nährwerte & Umrechnung editor for a catalogue ingredient — mirrors the
 * website's IngredientCatalogueModal: nutrition per 100 g, density, grams per
 * unit, and linked products with a per-alias default (⭐). OFF search + barcode
 * for a *new* product is reached via "Neues Produkt anlegen", which opens the
 * full product editor (with its own OFF search) pre-linked to this ingredient.
 */

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

export default function CatalogueModal({ name, onClose, onSaved }: { name: string; onClose: () => void; onSaved: () => void }) {
  const [ingId, setIngId] = useState<string | null>(null);
  const [nutrition, setNutrition] = useState<Record<string, string>>({});
  const [density, setDensity] = useState('');
  const [gbu, setGbu] = useState<Record<string, number>>({});
  const [gbuUnit, setGbuUnit] = useState('');
  const [gbuGrams, setGbuGrams] = useState('');
  const [defaultProductId, setDefaultProductId] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [newProduct, setNewProduct] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const { data: products = [], refetch: refetchProducts } = useQuery({ queryKey: ['products'], queryFn: localProducts });

  // Ensure the catalogue entry exists, then hydrate the form from it.
  useEffect(() => {
    (async () => {
      let cat = await localCatalogueIngredient(name);
      if (!cat) cat = await ensureLocalCatalogueIngredient(name);
      setIngId(cat.id);
      const n = cat.nutritionPer100g ?? {};
      const out: Record<string, string> = {};
      for (const { key } of NUTRIENTS) {
        const v = (n as any)[key];
        out[key] = v != null ? String(v) : '';
      }
      setNutrition(out);
      setDensity(cat.densityGPerMl != null ? String(cat.densityGPerMl) : '');
      setGbu(cat.gramsByUnit ?? {});
      setDefaultProductId(getIngredientDefault(cat.id, ''));
      setLoaded(true);
    })();
  }, [name]);

  const linkedProducts = useMemo(() => (ingId ? products.filter((p) => (p.ingredientIds ?? []).includes(ingId)) : []), [products, ingId]);
  const linkableMatches = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return [];
    return products.filter((p) => p.name.toLowerCase().includes(q) && !(ingId && (p.ingredientIds ?? []).includes(ingId))).slice(0, 8);
  }, [products, productQuery, ingId]);

  const link = async (p: Product) => {
    if (!ingId) return;
    await setProductIngredientLink(p.id, ingId, true);
    setProductQuery('');
    refetchProducts();
  };
  const unlink = async (p: Product) => {
    if (!ingId) return;
    await setProductIngredientLink(p.id, ingId, false);
    if (defaultProductId === p.id) {
      setIngredientDefault(ingId, '');
      setDefaultProductId('');
    }
    refetchProducts();
  };
  const makeDefault = (p: Product) => {
    if (!ingId) return;
    const next = defaultProductId === p.id ? '' : p.id;
    setIngredientDefault(ingId, next);
    setDefaultProductId(next);
  };

  const addGbu = () => {
    const unit = gbuUnit.trim();
    const grams = numOrUndef(gbuGrams);
    if (!unit || grams == null || grams <= 0) return;
    setGbu((g) => ({ ...g, [unit]: grams }));
    setGbuUnit('');
    setGbuGrams('');
  };

  const save = async () => {
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
      await saveLocalCatalogueIngredient({
        name,
        nutritionPer100g: any ? nutr : null,
        densityGPerMl: numOrUndef(density) ?? null,
        gramsByUnit: Object.keys(gbu).length > 0 ? gbu : null
      });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const inputSm = 'mt-0.5 w-full rounded border px-2 py-1 dark:border-gray-600 dark:bg-gray-900';

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black bg-opacity-60 p-3" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 sm:p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 sm:text-xl dark:text-white">
              Nährwerte &amp; Umrechnung: <span className="font-bold">{name}</span>
            </h2>
            <button onClick={onClose} className="text-2xl leading-none text-gray-500 hover:text-gray-800 dark:text-gray-300">&times;</button>
          </div>
          <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
            Werte pro 100 g. Gramm pro Einheit wird für Stück-/Löffel-/Tassen-Zutaten benötigt (z.&nbsp;B. 1 Zehe = 5&nbsp;g). Dichte in g/ml wird für Flüssigkeiten wie Öl (~0,91) benötigt.
          </p>

          {!loaded ? (
            <p className="text-gray-500">Lade …</p>
          ) : (
            <div className="space-y-3">
              <fieldset className="rounded border border-gray-200 p-3 dark:border-gray-700">
                <legend className="px-1 text-sm font-medium text-gray-700 dark:text-gray-200">Nährwerte (pro 100 g)</legend>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  {NUTRIENTS.map(({ key, label, step }) => (
                    <label key={key}>
                      <span className="block text-gray-500">{label}</span>
                      <input type="number" step={step} value={nutrition[key] ?? ''} onChange={(e) => setNutrition((n) => ({ ...n, [key]: e.target.value }))} className={inputSm} />
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="block text-sm">
                <span className="text-gray-700 dark:text-gray-200">Dichte (g/ml)</span>
                <input type="number" step="0.001" value={density} onChange={(e) => setDensity(e.target.value)} placeholder="z.B. 0.91" className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white sm:w-1/2" />
                <span className="mt-1 block text-[11px] text-gray-500">Nur wenn die Zutat in ml, TL, EL oder Tasse benutzt wird.</span>
              </label>

              {/* Linked products */}
              <fieldset className="rounded border border-gray-200 p-3 dark:border-gray-700">
                <legend className="px-1 text-sm font-medium text-gray-700 dark:text-gray-200">Verknüpfte Produkte</legend>
                <div className="mb-3 space-y-1 text-sm">
                  {linkedProducts.length === 0 ? (
                    <p className="text-xs text-gray-500">Noch keine Produkte verknüpft.</p>
                  ) : (
                    linkedProducts.map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2 rounded border border-gray-200 px-2 py-1 dark:border-gray-700">
                        <button type="button" onClick={() => makeDefault(p)} title="Als Standard (⭐) setzen" className={defaultProductId === p.id ? 'text-yellow-500' : 'text-gray-400 hover:text-yellow-500'}>★</button>
                        <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-100">{p.name}{p.brand ? ` · ${p.brand}` : ''}</span>
                        <button type="button" onClick={() => unlink(p)} className="text-xs text-red-500 hover:text-red-700">Entfernen</button>
                      </div>
                    ))
                  )}
                </div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Aus lokalem Register verknüpfen</div>
                <div className="relative flex flex-wrap gap-2">
                  <input value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Produkt suchen …" className="flex-1 rounded border px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900" />
                  <button type="button" onClick={() => setNewProduct(true)} className="rounded bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600">Neues Produkt anlegen</button>
                  {linkableMatches.length > 0 && (
                    <div className="absolute left-0 top-full z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-gray-300 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
                      {linkableMatches.map((p) => (
                        <button key={p.id} type="button" onClick={() => link(p)} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700">
                          {p.name}
                          {p.brand ? <span className="text-gray-400"> · {p.brand}</span> : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-gray-500">Ein Standardprodukt (⭐) gilt für deinen Alias — in jedem Rezept, das diese Zutat verwendet.</p>
              </fieldset>

              {/* Grams per unit */}
              <fieldset className="rounded border border-gray-200 p-3 dark:border-gray-700">
                <legend className="px-1 text-sm font-medium text-gray-700 dark:text-gray-200">Gramm pro Einheit</legend>
                <div className="space-y-2 text-sm">
                  {Object.keys(gbu).length === 0 ? (
                    <p className="text-xs text-gray-500">Noch keine Einträge.</p>
                  ) : (
                    Object.entries(gbu).map(([unit, grams]) => (
                      <div key={unit} className="flex items-center gap-2">
                        <span className="flex-1 text-gray-800 dark:text-gray-100">{unit}</span>
                        <span className="text-gray-600 dark:text-gray-300">{grams} g</span>
                        <button type="button" onClick={() => setGbu((g) => { const c = { ...g }; delete c[unit]; return c; })} className="text-xs text-red-500 hover:text-red-700">Entfernen</button>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <input value={gbuUnit} onChange={(e) => setGbuUnit(e.target.value)} placeholder="Einheit (z.B. Stück, Zehe, EL)" className="flex-1 rounded border px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900" />
                  <input value={gbuGrams} onChange={(e) => setGbuGrams(e.target.value)} type="number" step="0.1" placeholder="Gramm" className="w-28 rounded border px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900" />
                  <button type="button" onClick={addGbu} className="rounded bg-emerald-500 px-3 py-1 text-sm text-white hover:bg-emerald-600">Hinzufügen</button>
                </div>
                <p className="mt-2 text-[11px] text-gray-500">Beispiele: „Stück“ 110, „Zehe“ 5, „Kopf“ 800, „EL“ 15, „Tasse“ 120. Werte sind Schätzungen → Rezeptnährwerte werden mit „~“ markiert.</p>
              </fieldset>

              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={onClose} className="rounded border border-gray-300 px-3 py-2 text-gray-700 dark:border-gray-600 dark:text-gray-200">Abbrechen</button>
                <button type="button" onClick={save} disabled={busy} className="rounded bg-emerald-500 px-3 py-2 text-white hover:bg-emerald-600 disabled:opacity-50">Speichern</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {newProduct && (
        <ProductFormModal
          product={null}
          prelinkIngredientName={name}
          onClose={() => setNewProduct(false)}
          onSaved={() => {
            setNewProduct(false);
            refetchProducts();
          }}
        />
      )}
    </div>
  );
}

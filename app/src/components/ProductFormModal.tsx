import { useState } from 'react';
import type { Product } from '@shared/tracker';
import type { NutritionData } from '@shared/recipe';
import { saveLocalProduct, deleteLocalProduct, type ProductInput } from '@/lib/localData';

interface Props {
  product: Product | null; // null = new
  onClose: () => void;
  onSaved: () => void;
}

const NUTRIENTS: { key: keyof NutritionData; label: string }[] = [
  { key: 'calories', label: 'kcal' },
  { key: 'carbohydrates', label: 'Kohlenhydrate g' },
  { key: 'sugar', label: 'davon Zucker g' },
  { key: 'protein', label: 'Eiweiß g' },
  { key: 'fat', label: 'Fett g' },
  { key: 'saturatedFat', label: 'ges. Fettsäuren g' },
  { key: 'fiber', label: 'Ballaststoffe g' },
  { key: 'salt', label: 'Salz g' }
];

const numOrUndef = (s: string): number | undefined => {
  const n = Number(s.replace(',', '.'));
  return s.trim() === '' || Number.isNaN(n) ? undefined : n;
};

export default function ProductFormModal({ product, onClose, onSaved }: Props) {
  const [name, setName] = useState(product?.name ?? '');
  const [brand, setBrand] = useState(product?.brand ?? '');
  const [ean, setEan] = useState(product?.ean ?? '');
  const [netGrams, setNetGrams] = useState(product?.netGrams != null ? String(product.netGrams) : '');
  const [packageLabel, setPackageLabel] = useState(product?.packageLabel ?? '');
  const [price, setPrice] = useState(product?.defaultPrice != null ? String(product.defaultPrice) : '');
  const [nutrition, setNutrition] = useState<Record<string, string>>(() => {
    const n = product?.nutritionPer100g ?? {};
    const out: Record<string, string> = {};
    for (const { key } of NUTRIENTS) {
      const v = (n as any)[key];
      out[key] = v != null ? String(v) : '';
    }
    return out;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const input: ProductInput = {
        id: product?.id,
        name: name.trim(),
        brand: brand.trim() || undefined,
        ean: ean.trim() || undefined,
        netGrams: numOrUndef(netGrams),
        packageLabel: packageLabel.trim() || undefined,
        defaultPrice: numOrUndef(price),
        nutritionPer100g: any ? nutr : null,
        source: product?.source ?? 'manual'
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

  const field =
    'w-full rounded-lg border border-secondary-300 bg-white px-3 py-2 text-sm text-secondary-900 outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-600 dark:bg-secondary-700 dark:text-white';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-2xl dark:bg-secondary-800"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold">
          {product ? 'Produkt bearbeiten' : 'Neues Produkt'}
        </h2>

        <div className="space-y-3">
          <input className={field} placeholder="Name *" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <input className={field} placeholder="Marke" value={brand} onChange={(e) => setBrand(e.target.value)} />
            <input className={field} placeholder="EAN" value={ean} onChange={(e) => setEan(e.target.value)} inputMode="numeric" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <input className={field} placeholder="Netto g" value={netGrams} onChange={(e) => setNetGrams(e.target.value)} inputMode="decimal" />
            <input className={field} placeholder="Gebinde" value={packageLabel} onChange={(e) => setPackageLabel(e.target.value)} />
            <input className={field} placeholder="Preis €" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
          </div>

          <p className="pt-2 text-sm font-medium text-secondary-500">Nährwerte pro 100 g</p>
          <div className="grid grid-cols-2 gap-2">
            {NUTRIENTS.map(({ key, label }) => (
              <input
                key={key}
                className={field}
                placeholder={label}
                value={nutrition[key]}
                onChange={(e) => setNutrition((n) => ({ ...n, [key]: e.target.value }))}
                inputMode="decimal"
              />
            ))}
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-5 flex items-center justify-between gap-2">
          {product ? (
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              Löschen
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} disabled={busy} className="rounded-lg border border-secondary-300 px-4 py-2 text-sm dark:border-secondary-600">
              Abbrechen
            </button>
            <button onClick={save} disabled={busy} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
              Speichern
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

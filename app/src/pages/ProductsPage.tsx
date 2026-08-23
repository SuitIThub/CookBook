import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { assetUrl } from '@/lib/api';
import { localProducts } from '@/lib/localData';
import type { Product } from '@shared/tracker';
import ProductFormModal from '@/components/ProductFormModal';
import SupermarketsModal from '@/components/SupermarketsModal';
import { deleteLocalProduct } from '@/lib/localData';

function euro(v: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(v);
}

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['products'],
    queryFn: localProducts
  });
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [scanNew, setScanNew] = useState(false);
  const [showMarkets, setShowMarkets] = useState(false);

  const refresh = () => queryClient.invalidateQueries();
  const closeEditor = () => {
    setEditing(null);
    setScanNew(false);
  };
  const onSaved = () => {
    refresh();
    closeEditor();
  };

  const products = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = data ?? [];
    if (!needle) return all;
    return all.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        (p.brand ?? '').toLowerCase().includes(needle) ||
        (p.ean ?? '').includes(needle)
    );
  }, [data, q]);

  const del = async (p: Product) => {
    if (!confirm('Produkt wirklich löschen?')) return;
    await deleteLocalProduct(p.id);
    refresh();
  };

  if (isLoading) return <p className="text-gray-500 dark:text-gray-400">Lade Produkte …</p>;
  if (isError) return <p className="text-red-600 dark:text-red-400">Fehler: {(error as Error).message}</p>;

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="mb-1 text-3xl font-bold text-gray-900 dark:text-white">Produktregister</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Produkte mit EAN, Nährwerten und Supermarktpreisen. Barcode scannen für schnellen Import aus Open Food
            Facts (ODbL, community-basiert).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setScanNew(true);
              setEditing('new');
            }}
            className="rounded bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600"
          >
            Barcode scannen
          </button>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="rounded bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600"
          >
            Neues Produkt
          </button>
          <button
            type="button"
            onClick={() => setShowMarkets(true)}
            className="rounded bg-purple-500 px-3 py-2 text-sm font-medium text-white hover:bg-purple-600"
          >
            Supermärkte …
          </button>
        </div>
      </div>

      <div className="mb-4">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Produkte, Marken oder EAN suchen …"
          className="w-full rounded border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
      </div>

      {products.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-gray-500 dark:text-gray-400">Noch keine Produkte. Barcode scannen oder manuell anlegen.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {products.map((p) => {
            const nut = p.nutritionPer100g ?? {};
            const needsConversion =
              p.source === 'openfoodfacts' && (!p.gramsByUnit || Object.keys(p.gramsByUnit).length === 0);
            return (
              <div
                key={p.id}
                className="rounded border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-gray-100 dark:bg-gray-700">
                    {assetUrl(p.imageUrl) ? (
                      <img src={assetUrl(p.imageUrl)} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-2xl">🥫</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-gray-900 dark:text-white">{p.name}</div>
                        {p.brand && <div className="truncate text-xs text-gray-500 dark:text-gray-400">{p.brand}</div>}
                        <div className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                          {p.ean ? `EAN ${p.ean}` : 'ohne EAN'}
                          {p.packageLabel ? ` · ${p.packageLabel}` : ''}
                          {p.netGrams ? ` · ${p.netGrams} g` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => del(p)}
                        className="text-xs text-red-500 hover:text-red-700"
                        title="Löschen"
                      >
                        Löschen
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
                      {nut.calories != null && <span>{Math.round(nut.calories)} kcal/100 g</span>}
                      {nut.protein != null && <span>Eiweiß {nut.protein} g</span>}
                      {nut.fat != null && <span>Fett {nut.fat} g</span>}
                      {nut.carbohydrates != null && <span>KH {nut.carbohydrates} g</span>}
                    </div>
                    <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      Preise: {p.defaultPrice != null ? `${euro(p.defaultPrice)} (Standard)` : 'kein Standardpreis'}
                      {p.supermarkets.length > 0 &&
                        ` · ${p.supermarkets.length} Markt${p.supermarkets.length === 1 ? '' : 'e'}`}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing(p)}
                        className="rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600"
                      >
                        Bearbeiten
                      </button>
                      {needsConversion && (
                        <button
                          type="button"
                          onClick={() => setEditing(p)}
                          title="Mengen-Umrechnung ergänzen (z.B. 1 Scheibe = 30 g)"
                          className="rounded border border-amber-400 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-900/20"
                        >
                          Umrechnung ergänzen
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing !== null && (
        <ProductFormModal
          product={editing === 'new' ? null : editing}
          autoScan={scanNew}
          onClose={closeEditor}
          onSaved={onSaved}
        />
      )}
      {showMarkets && <SupermarketsModal onClose={() => setShowMarkets(false)} onChanged={refresh} />}
    </div>
  );
}

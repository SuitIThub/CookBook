import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { assetUrl } from '@/lib/api';
import { localProducts } from '@/lib/localData';
import type { Product } from '@shared/tracker';
import ProductFormModal from '@/components/ProductFormModal';
import SupermarketsModal from '@/components/SupermarketsModal';

function euro(v?: number): string | null {
  if (v == null) return null;
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
  const [showMarkets, setShowMarkets] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['products'] });
  const closeEditor = () => setEditing(null);
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

  if (isLoading) return <p className="text-secondary-500">Lade Produkte …</p>;
  if (isError)
    return <p className="text-red-600 dark:text-red-400">Fehler: {(error as Error).message}</p>;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Produkte <span className="text-sm font-normal text-secondary-500">{products.length}</span></h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowMarkets(true)}
            className="rounded-lg border border-secondary-300 px-3 py-1.5 text-sm font-medium hover:bg-secondary-100 dark:border-secondary-600 dark:hover:bg-secondary-800"
          >
            Supermärkte
          </button>
          <button
            onClick={() => setEditing('new')}
            className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
          >
            Neues Produkt
          </button>
        </div>
      </div>

      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Produkte, Marken oder EAN suchen …"
        className="mb-6 w-full rounded-lg border border-secondary-300 bg-white px-4 py-2 text-secondary-900 outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-600 dark:bg-secondary-800 dark:text-white"
      />

      {products.length === 0 ? (
        <p className="text-secondary-500">Keine Produkte gefunden.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {products.map((p) => {
            const kcal = p.nutritionPer100g?.calories;
            const price = euro(p.defaultPrice);
            return (
              <li
                key={p.id}
                onClick={() => setEditing(p)}
                className="flex cursor-pointer gap-3 rounded-xl border border-secondary-200 bg-white p-3 transition hover:shadow-md dark:border-secondary-700 dark:bg-secondary-800"
              >
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-secondary-100 dark:bg-secondary-700">
                  {assetUrl(p.imageUrl) ? (
                    <img src={assetUrl(p.imageUrl)} alt={p.name} loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-2xl">🛒</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-semibold leading-tight">{p.name}</h2>
                  {p.brand && <p className="truncate text-sm text-secondary-500">{p.brand}</p>}
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-secondary-500">
                    {p.ean && <span>EAN {p.ean}</span>}
                    {price && <span>{price}</span>}
                    {kcal != null && <span>{Math.round(kcal)} kcal/100 g</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing !== null && (
        <ProductFormModal
          product={editing === 'new' ? null : editing}
          onClose={closeEditor}
          onSaved={onSaved}
        />
      )}
      {showMarkets && (
        <SupermarketsModal onClose={() => setShowMarkets(false)} onChanged={refresh} />
      )}
    </div>
  );
}

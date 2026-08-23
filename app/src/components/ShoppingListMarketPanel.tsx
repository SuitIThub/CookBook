import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Product } from '@shared/tracker';
import type { ShoppingList, ShoppingListItem } from '@/types';
import { localSupermarkets, localProducts, updateLocalShoppingList } from '@/lib/localData';

/**
 * Supermarket price-estimation panel for a shopping list — mirrors the
 * website's ShoppingListMarketPanel. Prices come from product assignments
 * (a product's supermarket-specific price, else its default price), scaled by
 * grams when the item is in g/kg/mg and the product has a net weight. The
 * chosen market is persisted on the list (preferredSupermarketId).
 */

function euro(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '–';
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(v);
}

function grams(item: ShoppingListItem): number | null {
  const amount = item.quantity?.amount ?? 0;
  if (!amount) return null;
  const unit = (item.quantity?.unit ?? '').toLowerCase();
  if (unit === 'g') return amount;
  if (unit === 'kg') return amount * 1000;
  if (unit === 'mg') return amount / 1000;
  return null;
}

function priceForProduct(product: Product | undefined, supermarketId: string | null): number | null {
  if (!product) return null;
  if (supermarketId) {
    const entry = (product.supermarkets ?? []).find((s) => s.supermarketId === supermarketId);
    if (entry && entry.price != null) return entry.price;
  }
  return product.defaultPrice ?? null;
}

export default function ShoppingListMarketPanel({ list, onChanged }: { list: ShoppingList; onChanged: () => void }) {
  const { data: supermarkets = [] } = useQuery({ queryKey: ['supermarkets'], queryFn: localSupermarkets });
  const { data: products = [] } = useQuery({ queryKey: ['products'], queryFn: localProducts });
  const [marketId, setMarketId] = useState<string>(list.preferredSupermarketId ?? '');

  const productMap = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const summary = useMemo(() => {
    let total = 0;
    let priced = 0;
    let unpriced = 0;
    for (const item of list.items) {
      const product = item.productId ? productMap.get(item.productId) : undefined;
      const perUnit = priceForProduct(product, marketId || null);
      if (perUnit == null) {
        unpriced++;
        continue;
      }
      const g = grams(item);
      if (g != null && product && Number(product.netGrams) > 0) {
        total += (g / Number(product.netGrams)) * perUnit;
      } else {
        total += perUnit;
      }
      priced++;
    }
    return { total, priced, unpriced };
  }, [list.items, productMap, marketId]);

  const onChange = async (value: string) => {
    setMarketId(value);
    await updateLocalShoppingList(list.id, { preferredSupermarketId: value || undefined });
    onChanged();
  };

  const marketName = marketId ? supermarkets.find((s) => s.id === marketId)?.name ?? '' : '';

  return (
    <div className="card">
      <div className="card-content space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex-1">
            <label htmlFor="sl-market" className="text-sm font-medium text-gray-700 dark:text-gray-300">Supermarkt für Preisschätzung</label>
            <div className="text-muted mt-0.5 text-xs">Preise basieren auf Produktzuordnungen (Standardprodukt der Zutat oder explizite Wahl).</div>
          </div>
          <div className="flex items-center gap-2">
            <select id="sl-market" value={marketId} onChange={(e) => onChange(e.target.value)} className="form-select">
              <option value="">Kein Markt</option>
              {supermarkets.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <Link to="/produkte" className="text-sm text-gray-500 hover:underline dark:text-gray-400" title="Produkte & Supermärkte verwalten">Verwalten</Link>
          </div>
        </div>

        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300">
          Geschätzte Summe ({marketName || 'Kein Markt'}): <strong>{euro(summary.total)}</strong> · {summary.priced} Positionen mit Preis, {summary.unpriced} ohne.
        </div>
      </div>
    </div>
  );
}

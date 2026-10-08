/**
 * Receipt review (website /produkte/kassenbon + app ReceiptImportPage):
 * price math and labels shared by both UIs. Pure, browser-safe.
 */
export type LineConfidence = 'gelernt' | 'sicher' | 'vorschlag' | 'ki' | 'keine' | 'ignoriert';

export interface ReviewLine {
  text: string;
  quantity: number;
  unit: 'stk' | 'kg';
  unitPrice: number;
  discount: number;
  total: number;
  deposit: boolean;
  productId: string | null;
  ignore: boolean;
  confidence: LineConfidence;
  reason: string;
  candidates: { id: string; name: string; score: number }[];
}

export interface ReceiptResult {
  store: string;
  date: string;
  supermarketId: string | null;
  lines: ReviewLine[];
  total: number | null;
}

/** What the user decided for a line: a product id, "new:<name>", "ignore" or "" (skip). */
export type LineChoice = string;

export interface PricedProduct {
  id: string;
  name: string;
  brand?: string | null;
  netGrams?: number | null;
  supermarkets?: { supermarketId: string; price: number }[];
}

export function initialChoice(line: ReviewLine): LineChoice {
  if (line.ignore) return 'ignore';
  return line.productId ?? '';
}

/** Price the product would get (per pack): €/kg lines are converted via the pack size (loose goods: 1 kg). */
export function packPrice(unit: 'stk' | 'kg', unitPrice: number, product?: PricedProduct | null): number {
  if (unit !== 'kg') return unitPrice;
  const grams = product?.netGrams && product.netGrams > 0 ? product.netGrams : 1000;
  return Math.round(unitPrice * grams * 100 / 1000) / 100;
}

export const euro = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

/** "bisher 1,99 € → 2,19 € (+10 %)" / "erster Preis" / "unverändert". */
export function priceChange(before: number | null | undefined, after: number): { text: string; tone: 'up' | 'down' | 'same' | 'new' } {
  if (before == null) return { text: `erster Preis: ${euro(after)}`, tone: 'new' };
  const diff = Math.round((after - before) * 100) / 100;
  if (Math.abs(diff) < 0.005) return { text: `unverändert ${euro(after)}`, tone: 'same' };
  const pct = before > 0 ? Math.round((diff / before) * 100) : null;
  return {
    text: `${euro(before)} → ${euro(after)} (${diff > 0 ? '+' : '−'}${euro(Math.abs(diff))}${pct != null ? `, ${diff > 0 ? '+' : '−'}${Math.abs(pct)} %` : ''})`,
    tone: diff > 0 ? 'up' : 'down'
  };
}

export function currentPrice(product: PricedProduct | undefined, supermarketId: string | null): number | null {
  if (!product || !supermarketId) return null;
  return product.supermarkets?.find((s) => s.supermarketId === supermarketId)?.price ?? null;
}

/** Title-case a receipt text as a starting name for a new product ("GOUDA JG" → "Gouda Jg"). */
export function suggestName(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+\d+([.,]\d+)?\s*(kg|g|gr|l|ml)\b/g, '')
    .replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase())
    .trim();
}

export function commitLines(lines: ReviewLine[], choices: LineChoice[], newNames: string[], prices: number[]) {
  return lines.map((l, i) => {
    const c = choices[i] ?? '';
    if (c === 'ignore') return { text: l.text, action: 'ignore' as const };
    if (!c) return { text: l.text, action: 'skip' as const };
    const isNew = c === 'new';
    const paid = l.quantity > 0 ? Math.round((l.total / l.quantity) * 100) / 100 : null;
    return {
      text: l.text,
      action: 'price' as const,
      productId: isNew ? undefined : c,
      newProductName: isNew ? newNames[i] : undefined,
      unit: l.unit,
      unitPrice: prices[i] ?? l.unitPrice,
      paidUnitPrice: paid
    };
  });
}

export const LINE_CONFIDENCE: Record<LineConfidence, { label: string; cls: string }> = {
  gelernt: { label: 'gelernt', cls: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  sicher: { label: 'sicher', cls: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  vorschlag: { label: 'Vorschlag', cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
  ki: { label: 'KI-Vorschlag', cls: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300' },
  keine: { label: 'offen', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
  ignoriert: { label: 'ignoriert', cls: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400' }
};

export const CHANGE_CLS: Record<'up' | 'down' | 'same' | 'new', string> = {
  up: 'text-red-600 dark:text-red-400',
  down: 'text-green-600 dark:text-green-400',
  same: 'text-gray-500 dark:text-gray-400',
  new: 'text-blue-600 dark:text-blue-400'
};

/**
 * Fuzzy matching of abbreviated receipt lines ("GOUDA JG 400G", "BIO TMTN
 * PASS.") against the product register. Receipt printers truncate words and
 * drop vowels, so a receipt token matches a product word when it is a prefix
 * of it, or its consonant skeleton is a subsequence of the product word.
 * A weight on the receipt ("400G", "1,5KG") must agree with the pack size.
 */

export function fold(s: string): string {
  return s
    .toUpperCase()
    .replace(/Ä/g, 'AE')
    .replace(/Ö/g, 'OE')
    .replace(/Ü/g, 'UE')
    .replace(/ß/g, 'SS')
    .replace(/[^A-Z0-9,.]+/g, ' ')
    .trim();
}

/** Pack size on the receipt line in grams/ml ("400G", "1,5KG", "0.5L"), else null. */
export function lineWeight(text: string): number | null {
  const m = fold(text).match(/(\d+(?:[.,]\d+)?)\s*(KG|G|GR|L|ML)\b/);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return m[2] === 'KG' || m[2] === 'L' ? n * 1000 : n;
}

const NOISE = new Set(['BIO', 'ST', 'STK', 'STUECK', 'X', 'EUR', 'KG', 'G', 'GR', 'L', 'ML', 'A', 'B', 'PCK', 'PACK', 'PKG']);

function tokens(text: string): string[] {
  return fold(text)
    .split(/[\s.,]+/)
    .filter((t) => t.length >= 2 && !/^\d/.test(t) && !NOISE.has(t));
}

function skeleton(w: string): string {
  return w[0] + w.slice(1).replace(/[AEIOU]/g, '');
}

function isSubsequence(small: string, big: string): boolean {
  let i = 0;
  for (const c of big) if (c === small[i]) i++;
  return i === small.length;
}

/** How well one receipt token matches one product word (0..1). */
function tokenScore(rt: string, pw: string): number {
  if (rt === pw) return 1;
  if (pw.startsWith(rt)) return rt.length >= 3 ? 0.9 : 0.5;
  if (rt.length >= 3 && rt[0] === pw[0] && isSubsequence(skeleton(rt), skeleton(pw))) return 0.7;
  // two-letter abbreviations are common on receipts ("JG" = jung, "TK" = Tiefkühl)
  if (rt.length === 2 && rt[0] === pw[0] && isSubsequence(rt, pw)) return 0.6;
  // compound product words: "GOUDA" inside "GOUDAKAESE"
  if (rt.length >= 4 && pw.includes(rt)) return 0.75;
  return 0;
}

export interface ScorableProduct {
  id: string;
  name: string;
  brand?: string | null;
  netGrams?: number | null;
}

/** 0..1 — share of receipt words found in the product (name + brand), weight-checked. */
export function scoreProduct(lineText: string, p: ScorableProduct): number {
  const rts = tokens(lineText);
  if (!rts.length) return 0;
  const pws = tokens(`${p.name} ${p.brand ?? ''}`);
  if (!pws.length) return 0;
  let sum = 0;
  for (const rt of rts) sum += Math.max(0, ...pws.map((pw) => tokenScore(rt, pw)));
  let score = sum / rts.length;
  const w = lineWeight(lineText);
  if (w && p.netGrams) {
    const ratio = w / p.netGrams;
    score = ratio > 0.95 && ratio < 1.05 ? Math.min(1, score + 0.15) : score * 0.6;
  }
  return Math.round(score * 100) / 100;
}

export function rankProducts<P extends ScorableProduct>(lineText: string, products: P[], n = 6): { product: P; score: number }[] {
  return products
    .map((product) => ({ product, score: scoreProduct(lineText, product) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

/** A confident fuzzy match: good score and clearly ahead of the runner-up. */
export function confidentMatch<P extends ScorableProduct>(ranked: { product: P; score: number }[]): P | null {
  const [best, second] = ranked;
  if (!best || best.score < 0.75) return null;
  if (second && best.score - second.score < 0.15) return null;
  return best.product;
}

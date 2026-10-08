/**
 * Batch product import: which catalogue ingredient is a product?
 *
 *  1. product already in the register and linked → keep that ingredient (sicher)
 *  2. rules: generic name = catalogue ingredient (sicher), or the product
 *     name/generic name mention one (vorschlag; the most specific, i.e.
 *     longest, catalogue name wins: "gehackte Tomaten" over "Tomaten").
 *     OFF categories are too broad/unreliable for a rule ("Ritter Sport
 *     Marzipan" → "Weiße Schokoladen") — they only inform the AI.
 *  3. everything left → one AI call with the "Zuordnen" task model, which may
 *     also propose a new, short generic ingredient name
 * The user reviews and corrects every row before anything is saved.
 */
import { db } from './database.server';
import { aiStructured, type AIRequestConfig } from './ai';
import { catalogueCandidates, matchCatalogue, mentions, usableCatalogueNames } from './recipeEnrich';

export interface BatchProductInput {
  ean?: string | null;
  name: string;
  brand?: string | null;
  genericName?: string | null;
  categories?: string | null;
}

export type MatchConfidence = 'sicher' | 'vorschlag' | 'ki' | 'keine';

export interface ProductMatch {
  /** Proposed ingredient name ('' = none). */
  ingredient: string;
  /** The ingredient already exists in the catalogue (otherwise it would be created). */
  existing: boolean;
  confidence: MatchConfidence;
  /** Why (shown as tooltip in the review). */
  reason: string;
  /** Product already in the register (by EAN). */
  existingProductId?: string;
}

function foldLen(s: string) {
  return s.replace(/[^\p{L}]/gu, '').length;
}

/** Most specific catalogue ingredient mentioned in the text. */
function bestMention(text: string, catalogue: string[]): string | null {
  const hits = catalogue.filter((c) => mentions(text, c));
  if (!hits.length) return null;
  return hits.sort((a, b) => foldLen(b) - foldLen(a))[0];
}

export async function matchProducts(items: BatchProductInput[], ai: AIRequestConfig | null): Promise<ProductMatch[]> {
  const catalogue = usableCatalogueNames(db.getAllCatalogueIngredients().map((c) => c.name));
  const byId = new Map(db.getAllCatalogueIngredients().map((c) => [c.id, c.name]));
  const results: ProductMatch[] = items.map((item) => {
    const existingProduct = item.ean ? db.getProductByEan(item.ean) : null;
    const linked = existingProduct?.ingredientIds?.map((id) => byId.get(id)).find(Boolean);
    if (existingProduct && linked) {
      return { ingredient: linked, existing: true, confidence: 'sicher', reason: 'Produkt ist bereits mit dieser Zutat verknüpft.', existingProductId: existingProduct.id };
    }
    const base = { existingProductId: existingProduct?.id };
    const generic = item.genericName ? matchCatalogue(item.genericName, catalogue) : null;
    if (generic) return { ...base, ingredient: generic.name, existing: true, confidence: 'sicher', reason: `Gattungsbezeichnung „${item.genericName}“.` };
    const fromName = bestMention([item.name, item.genericName].filter(Boolean).join(' '), catalogue);
    if (fromName) return { ...base, ingredient: fromName, existing: true, confidence: 'vorschlag', reason: 'Im Produktnamen erkannt.' };
    return { ...base, ingredient: '', existing: false, confidence: 'keine', reason: '' };
  });

  const open = results.map((r, i) => (r.confidence === 'keine' ? i : -1)).filter((i) => i >= 0);
  if (open.length && ai) {
    const text = open.map((i) => [items[i].name, items[i].genericName, items[i].categories].filter(Boolean).join(' ')).join('\n');
    const candidates = catalogueCandidates(text, catalogue, 200);
    const prompt = `Ordne jedes Produkt der passenden Zutat aus einem Kochbuch zu (die Zutat, die man in einem Rezept dafür schreiben würde).
Bevorzuge eine VORHANDENE Zutat aus der Liste (exakt so geschrieben). Passt keine, schlage einen kurzen, allgemeinen deutschen Zutatennamen vor (z. B. "Gehackte Tomaten", "Haferflocken" — keine Marke, keine Menge) und setze existing=false. Ist das Produkt keine Zutat (z. B. Spülmittel), gib ingredient "" zurück.

VORHANDENE ZUTATEN: ${candidates.join(', ') || '(keine passenden)'}

PRODUKTE:
${open.map((i) => `${i}: ${items[i].name}${items[i].brand ? ` (Marke: ${items[i].brand})` : ''}${items[i].genericName ? ` — ${items[i].genericName}` : ''}${items[i].categories ? ` — Kategorien: ${String(items[i].categories).slice(0, 200)}` : ''}`).join('\n')}`;
    try {
      const answer = await aiStructured<{ matches?: { index: number; ingredient: string; existing: boolean }[] }>(
        prompt,
        {
          type: 'object',
          properties: {
            matches: {
              type: 'array',
              items: {
                type: 'object',
                properties: { index: { type: 'number' }, ingredient: { type: 'string' }, existing: { type: 'boolean' } },
                required: ['index', 'ingredient', 'existing']
              }
            }
          },
          required: ['matches']
        },
        ai
      );
      for (const m of answer.matches ?? []) {
        if (!open.includes(m.index) || typeof m.ingredient !== 'string' || !m.ingredient.trim()) continue;
        // Re-check against the catalogue: the model may misspell an existing name.
        const hit = matchCatalogue(m.ingredient, catalogue);
        results[m.index] = {
          ...results[m.index],
          ingredient: hit?.name ?? m.ingredient.trim(),
          existing: !!hit,
          confidence: 'ki',
          reason: hit ? 'KI-Vorschlag (vorhandene Zutat).' : 'KI-Vorschlag — Zutat wird neu angelegt.'
        };
      }
    } catch (error) {
      console.error('product matching AI failed:', error);
      for (const i of open) results[i].reason = `KI-Zuordnung fehlgeschlagen: ${(error as Error).message.slice(0, 120)}`;
    }
  }
  return results;
}

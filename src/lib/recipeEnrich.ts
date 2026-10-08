/**
 * Deterministic clean-up of AI-generated recipes (reel import, AI variants,
 * URL imports): language models rarely reuse the catalogue's ingredient names
 * and almost never link ingredients to the preparation steps.
 *
 *  - Ingredient names are mapped onto existing catalogue ingredients when they
 *    only differ in case, singular/plural or leading adjectives
 *    ("gehackte Tomaten" → "Tomaten", "gehackte" moves to the description).
 *  - Steps without (valid) ingredient links get them from the step text.
 *
 * Pure functions; the callers pass the catalogue names.
 */

type AnyRecord = Record<string, any>;

/** "Salz &amp; Pfeffer", "1&#32;Zwiebel" (HTML entities from scraped pages) → plain text. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lowercase, umlaut-folded, letters only. */
function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Crude German singular/plural stem: "Zwiebeln" ≈ "Zwiebel", "Tomaten" ≈ "Tomate", "Eier" ≈ "Ei". */
/** Irregular/short plurals the suffix rule can't handle safely. */
const IRREGULAR: Record<string, string> = { eier: 'ei', eiern: 'ei', nuesse: 'nuss', nuessen: 'nuss', blaetter: 'blatt' };

export function stem(word: string): string {
  let w = fold(word).replace(/\s+/g, '');
  if (IRREGULAR[w]) return IRREGULAR[w];
  for (const suffix of ['nen', 'en', 'er', 'n', 'e', 's']) {
    // "Reis", "Mais", "Eis" are not plurals.
    if (suffix === 's' && /(ei|ai)s$/.test(w)) continue;
    if (w.length - suffix.length >= 3 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w;
}

const STOP = new Set(
  'und oder mit ohne etwas eine einen einem einer ein der die das den dem des zum zur in im an am auf aus bei fuer von vom bis nach dann noch nun alles alle gut sehr'
    .split(' ')
);

/** Lookup keys of a name: the whole name and its last word (the head noun of German compounds/phrases). */
function nameKeys(name: string): { full: string; head: string } {
  const words = fold(name)
    .split(' ')
    .filter((w) => w && !STOP.has(w));
  return { full: stem(words.join('')), head: words.length ? stem(words[words.length - 1]) : '' };
}

/**
 * Catalogue entries that are real ingredient names — the catalogue may hold
 * import debris ("16px)", "2) - (", "1&#32;kleine&#32;rote Zwiebel") that must
 * never be suggested to the model or used as a mapping target.
 */
export function usableCatalogueNames(names: string[]): string[] {
  return names.filter(
    (n) =>
      typeof n === 'string' &&
      /^\p{L}/u.test(n.trim()) &&
      (n.match(/\p{L}/gu) || []).length >= 2 &&
      !/&#|[(){};:<>=]|\d+(px|em|rem|deg|vh|vw)/i.test(n) &&
      !NOT_INGREDIENTS.has(stem(n.split(/\s+/).pop() || '')) &&
      n.length <= 60
  );
}

/** Preparation/size/temperature words: dropping them keeps the same catalogue ingredient. */
const DROPPABLE = new Set(
  [
    'gehackt', 'gehackte', 'gerieben', 'geriebene', 'geriebener', 'geriebenen', 'gewuerfelt', 'gewuerfelte', 'geschnitten', 'geschnittene',
    'geschaelt', 'geschaelte', 'gepresst', 'gepresste', 'gemahlen', 'gemahlene', 'gemahlener', 'zerlassen', 'zerlassene', 'geschmolzen', 'geschmolzene',
    'fein', 'grob', 'frisch', 'frische', 'frischer', 'frisches', 'gross', 'grosse', 'grosser', 'grossen', 'klein', 'kleine', 'kleiner', 'kleinen',
    'mittelgross', 'mittelgrosse', 'mittelgrosser', 'mittelgrossen', 'kalt', 'kalte', 'kalter', 'warm', 'warme', 'warmer', 'lauwarm', 'lauwarme',
    'heiss', 'heisse', 'heisses', 'weich', 'weiche', 'zimmerwarm', 'zimmerwarme', 'reif', 'reife', 'gestr', 'gehaeuft', 'etwas', 'prise'
  ].map(stem)
);

/** Catalogue entries that are not ingredients (import debris, units). */
const NOT_INGREDIENTS = new Set(['portion', 'portionen', 'zutat', 'zutaten', 'rezept', 'rezepte', 'style', 'test', 'stunde', 'stunden', 'minute', 'minuten'].map(stem));

export interface CatalogueMatch {
  name: string;
  /** Leading words of the original name that were dropped (e.g. "gehackte"). */
  qualifier?: string;
}

/**
 * Find the catalogue ingredient an AI ingredient name refers to.
 * Only safe matches: same name modulo case/plural, or a qualified name whose
 * remaining words are a catalogue ingredient ("gehackte Tomaten" → "Tomaten").
 */
export function matchCatalogue(name: string, catalogue: string[]): CatalogueMatch | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const exact = catalogue.find((c) => c.toLowerCase() === trimmed.toLowerCase());
  if (exact) return { name: exact };
  const { full } = nameKeys(trimmed);
  const byStem = catalogue.find((c) => nameKeys(c).full === full);
  if (byStem) return { name: byStem };
  // Drop leading qualifiers one word at a time: "fein gehackte Zwiebeln" → "Zwiebeln".
  const words = trimmed.split(/\s+/);
  // Only preparation/size words may be dropped ("gehackte", "große", "frisch") —
  // never words that name another product ("saure Sahne", "passierte Tomaten",
  // "brauner Zucker") or other ingredients ("Salz und Pfeffer").
  const isQualifier = (w: string) => DROPPABLE.has(stem(w.replace(/\.$/, '')));
  for (let i = 1; i < words.length; i++) {
    if (!isQualifier(words[i - 1])) break;
    const rest = words.slice(i).join(' ');
    const k = nameKeys(rest).full;
    const hit = catalogue.find((c) => nameKeys(c).full === k);
    if (hit) return { name: hit, qualifier: words.slice(0, i).join(' ') };
  }
  return null;
}

/** Catalogue names that plausibly occur in a text (to give the model a short candidate list). */
export function catalogueCandidates(text: string, catalogueRaw: string[], limit = 150): string[] {
  const catalogue = usableCatalogueNames(catalogueRaw);
  const tokens = new Set(
    fold(text)
      .split(' ')
      .filter((w) => w.length >= 3)
      .map(stem)
  );
  const folded = fold(text).replace(/\s+/g, '');
  const out: string[] = [];
  for (const c of catalogue) {
    const { full, head } = nameKeys(c);
    if (!full) continue;
    if (tokens.has(full) || (head && tokens.has(head)) || (full.length >= 5 && folded.includes(full))) out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Form words of an ingredient: the text names the base ("Knoblauch",
 * "Paprika", "Hähnchen"), the ingredient line its form ("Knoblauchzehen",
 * "Paprikaschoten", "Hähnchenbrustfilet").
 */
const FORMS = new Set(
  ['zehe', 'schote', 'filet', 'brustfilet', 'brust', 'keule', 'stange', 'knolle', 'blatt', 'zweig', 'stiel', 'scheibe', 'wuerfel', 'stueck', 'streifen', 'roeschen', 'kopf', 'bund'].map(stem)
);

/** Compounds that look like "base + form" but are ingredients of their own. */
const NOT_FORMS = new Set(['zuckerschoten', 'zuckerschote', 'kohlkopf', 'salatkopf'].map((w) => w));

/** Alternatives in one ingredient line: "Guanciale oder Pancetta", "Butter/Margarine". */
function alternatives(name: string): string[] {
  return name
    .split(/\s+oder\s+|\s*\/\s*|\s*,\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Does the step text mention this ingredient? Word-based, plural- and compound-tolerant. */
export function mentions(stepText: string, ingredientName: string): boolean {
  const words = fold(stepText)
    .split(' ')
    .filter((w) => w.length >= 2)
    .map(stem);
  const joined = fold(stepText).replace(/\s+/g, '');
  const rawWords = fold(stepText).split(' ').filter((w) => w.length >= 4);
  return alternatives(ingredientName).some((alt) => {
    const { full, head } = nameKeys(alt);
    if (!full) return false;
    const headRaw = fold(alt).split(' ').filter((w) => w && !STOP.has(w)).pop() || '';
    if (!NOT_FORMS.has(headRaw) && rawWords.some((w) => headRaw.length > w.length && headRaw.startsWith(w) && FORMS.has(stem(headRaw.slice(w.length))))) return true;
    return (
      words.some(
        (s) =>
          s === full ||
          (head && s === head) ||
          // Compound in the text: "Knoblauchzehen" mentions "Knoblauch".
          (full.length >= 4 && s.startsWith(full)) ||
          (head.length >= 4 && s.endsWith(head)) ||
          // Compound ingredient, base word in the text: "Bergkäse" ← "Käse", "Staudensellerie" ← "Sellerie".
          (s.length >= 4 && head.length > s.length && head.endsWith(s))
      ) || (full.length >= 6 && joined.includes(full))
    );
  });
}

function walkIngredients(groups: AnyRecord[], fn: (ing: AnyRecord) => void) {
  for (const g of groups ?? []) {
    for (const item of g?.ingredients ?? []) {
      if (Array.isArray(item?.ingredients)) walkIngredients([item], fn);
      else if (item) fn(item);
    }
  }
}

function walkSteps(groups: AnyRecord[], fn: (step: AnyRecord) => void) {
  for (const g of groups ?? []) {
    for (const s of g?.steps ?? []) {
      if (Array.isArray(s?.steps)) walkSteps([s], fn);
      else if (s) fn(s);
    }
  }
}

/**
 * "Salz und Pfeffer", "Öl & Essig", "Salz, Pfeffer" → separate ingredients, when
 * every part is a catalogue ingredient or a single word. A shared trailing
 * phrase goes to every part's description: "Salz und Pfeffer aus der Mühle" →
 * Salz + Pfeffer, each "aus der Mühle". Alternatives ("A oder B") are not split.
 */
export function splitCombined(name: string, catalogue: string[]): { parts: string[]; description?: string } | null {
  if (/\s+oder\s+/i.test(name)) return null;
  const parts = name
    .split(/\s+und\s+|\s*&\s*|\s*,\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  let description: string | undefined;
  const tail = parts[parts.length - 1].match(/^([\p{L}-]+)\s+((?:aus|nach|zum|zur|fuer|für|vom|von|im|in|je)\s.+)$/iu);
  if (tail) {
    parts[parts.length - 1] = tail[1];
    description = tail[2];
  }
  const ok = parts.every((p) => matchCatalogue(p, catalogue) || /^[\p{L}-]+$/u.test(p));
  return ok ? { parts, description } : null;
}

/** Split combined ingredient lines in place; returns old id → new sibling ids. */
function splitIngredients(groups: AnyRecord[], catalogue: string[], newId: () => string): Map<string, string[]> {
  const added = new Map<string, string[]>();
  for (const g of groups ?? []) {
    const out: AnyRecord[] = [];
    for (const item of g?.ingredients ?? []) {
      if (Array.isArray(item?.ingredients)) {
        splitIngredients([item], catalogue, newId).forEach((v, k) => added.set(k, v));
        out.push(item);
        continue;
      }
      if (typeof item?.name === 'string') item.name = decodeEntities(item.name);
      const split = typeof item?.name === 'string' ? splitCombined(item.name, catalogue) : null;
      if (!split) {
        out.push(item);
        continue;
      }
      const description = [split.description, item.description].filter(Boolean).join(', ') || undefined;
      const siblings: string[] = [];
      split.parts.forEach((part, i) => {
        if (i === 0) out.push({ ...item, name: part, description });
        else {
          const id = newId();
          siblings.push(id);
          out.push({ ...item, id, name: part, description, quantities: JSON.parse(JSON.stringify(item.quantities ?? [])) });
        }
      });
      added.set(item.id, siblings);
    }
    g.ingredients = out;
  }
  return added;
}

export interface EnrichStats {
  /** Ingredients renamed to their catalogue spelling. */
  matched: number;
  /** Steps that got ingredient links filled in. */
  linkedSteps: number;
  /** Combined lines ("Salz und Pfeffer") split into separate ingredients. */
  split: number;
}

/**
 * Map ingredient names onto the catalogue and fill missing step links.
 * Mutates and returns `data` (a sanitised recipeData).
 */
export function enrichRecipeData<T extends AnyRecord>(data: T, catalogueRaw: string[]): { data: T; stats: EnrichStats } {
  const stats: EnrichStats = { matched: 0, linkedSteps: 0, split: 0 };
  const catalogue = usableCatalogueNames(catalogueRaw);
  let n = 0;
  const split = splitIngredients(data.ingredientGroups, catalogue, () => `split-${Date.now().toString(36)}-${n++}`);
  stats.split = split.size;
  // Steps linked to a split line are linked to every part.
  if (split.size) {
    walkSteps(data.preparationGroups, (step) => {
      if (!Array.isArray(step.linkedIngredients)) return;
      const extra = step.linkedIngredients.flatMap((l: any) =>
        (split.get(l?.ingredientId) ?? []).map((id) => ({ ingredientId: id, selectedQuantityIndex: Number(l.selectedQuantityIndex) || 0 }))
      );
      step.linkedIngredients.push(...extra);
    });
  }
  const ingredients: AnyRecord[] = [];
  walkIngredients(data.ingredientGroups, (ing) => {
    ingredients.push(ing);
    if (typeof ing.name !== 'string') return;
    const m = matchCatalogue(ing.name, catalogue);
    if (m && m.name !== ing.name) {
      if (m.qualifier) ing.description = [m.qualifier, ing.description].filter(Boolean).join(', ');
      ing.name = m.name;
      stats.matched++;
    }
  });
  const ids = new Set(ingredients.map((i) => i.id));
  walkSteps(data.preparationGroups, (step) => {
    const valid = (Array.isArray(step.linkedIngredients) ? step.linkedIngredients : [])
      .map((l: any) => (typeof l === 'string' ? { ingredientId: l } : l))
      .filter((l: any) => l && (ids.has(l.ingredientId) || l.isIntermediate))
      .map((l: any) => ({ ingredientId: l.ingredientId, selectedQuantityIndex: Number(l.selectedQuantityIndex) || 0, ...(l.isIntermediate ? { isIntermediate: true } : {}) }));
    if (valid.length === 0 && typeof step.text === 'string') {
      for (const ing of ingredients) {
        if (mentions(step.text, ing.name)) valid.push({ ingredientId: ing.id, selectedQuantityIndex: 0 });
      }
      if (valid.length) stats.linkedSteps++;
    }
    step.linkedIngredients = valid;
  });
  return { data, stats };
}

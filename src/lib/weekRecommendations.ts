/**
 * "Für nächste Woche empfohlen" — pure scoring of recipe candidates for the
 * dashboard widget. Each criterion can be switched off in the widget's
 * settings. Shared by the server (api/tracker/recommendations) and the app,
 * which runs it on its local replica via trackerService.
 */

export interface RecommendationCriteria {
  /** Prefer favorites. */
  favorites: boolean;
  /** Prefer recipes not eaten/planned for a long time; skip the last week's. */
  longNotEaten: boolean;
  /** Prefer portions close to the per-meal calorie target. */
  calorieGoal: boolean;
  /** Spread categories / main ingredients over the week. */
  variety: boolean;
}

export const DEFAULT_CRITERIA: RecommendationCriteria = {
  favorites: true,
  longNotEaten: true,
  calorieGoal: true,
  variety: true
};

export interface RecommendationCandidate {
  id: string;
  title: string;
  imageUrl?: string;
  category?: string;
  /** Normalised main ingredient names (no staples like salt or oil). */
  mainIngredients: string[];
  kcal?: number;
  protein?: number;
  estimated?: boolean;
}

export interface RecommendationInput {
  candidates: RecommendationCandidate[];
  criteria: RecommendationCriteria;
  favoriteIds: Set<string>;
  /** When each recipe was last eaten or cooked (epoch ms). */
  lastEaten: Map<string, number>;
  /** Recipes already planned for the coming days — not recommended again. */
  plannedIds: Set<string>;
  /** kcal of one main meal (e.g. 40 % of the daily goal); 0 = unknown. */
  targetMealKcal: number;
  now: number;
  count: number;
  /** Changes the tie-breaking jitter ("Neu mischen"); same seed → same list. */
  seed: number;
}

export interface Recommendation {
  id: string;
  title: string;
  imageUrl?: string;
  category?: string;
  kcal?: number;
  protein?: number;
  estimated?: boolean;
  reasons: string[];
}

const DAY = 86_400_000;
/** Eaten within this many days → skipped when "long not eaten" is on. */
const RECENT_DAYS = 7;

/** Deterministic 0..1 jitter per (seed, id) so the list is stable within a week. */
function jitter(seed: number, id: string): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

/** Seed that changes once per ISO-ish week (Monday-based). */
export function weekSeed(now: number): number {
  const d = new Date(now);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return Math.floor(monday.getTime() / DAY);
}

const STAPLES = new Set([
  'salz', 'pfeffer', 'öl', 'olivenöl', 'rapsöl', 'sonnenblumenöl', 'wasser', 'zucker', 'mehl', 'butter',
  'essig', 'knoblauch', 'zwiebel', 'zwiebeln', 'paprikapulver', 'muskat', 'oregano', 'basilikum', 'petersilie',
  'gemüsebrühe', 'brühe', 'backpulver', 'vanillezucker', 'zimt', 'chili', 'chiliflocken', 'kreuzkümmel'
]);

/** Up to `limit` distinctive ingredient names of a recipe (staples skipped). */
export function mainIngredientNames(names: string[], limit = 3): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const n = raw.trim().toLowerCase();
    if (!n || STAPLES.has(n) || out.includes(n)) continue;
    out.push(n);
    if (out.length >= limit) break;
  }
  return out;
}

function weeksText(days: number): string {
  if (days >= 60) return 'seit über 2 Monaten nicht gegessen';
  if (days >= 14) return `seit ${Math.floor(days / 7)} Wochen nicht gegessen`;
  return `seit ${days} Tagen nicht gegessen`;
}

export function recommendRecipes(input: RecommendationInput): Recommendation[] {
  const { criteria, favoriteIds, lastEaten, plannedIds, targetMealKcal, now, seed } = input;

  interface Scored { c: RecommendationCandidate; base: number; reasons: string[] }
  const pool: Scored[] = [];
  for (const c of input.candidates) {
    if (plannedIds.has(c.id)) continue;
    const reasons: string[] = [];
    let score = jitter(seed, c.id); // 0..1 tie-breaker

    if (criteria.favorites && favoriteIds.has(c.id)) {
      score += 3;
      reasons.push('Favorit');
    }

    if (criteria.longNotEaten) {
      const last = lastEaten.get(c.id);
      if (last != null) {
        const days = Math.floor((now - last) / DAY);
        if (days < RECENT_DAYS) continue;
        score += Math.min(days, 60) / 20; // up to +3 after two months
        if (days >= 14) reasons.push(weeksText(days));
      } else {
        score += 1.5;
        // Only worth a note for favorites; for other never-eaten recipes it would be noise.
        if (lastEaten.size > 0 && favoriteIds.has(c.id)) reasons.push('lange nicht gegessen');
      }
    }

    if (criteria.calorieGoal && targetMealKcal > 0) {
      if (c.kcal != null && c.kcal > 0) {
        const closeness = 1 - Math.abs(c.kcal - targetMealKcal) / targetMealKcal;
        score += 2.5 * Math.max(0, closeness);
        if (closeness >= 0.75) reasons.push('passt zum Kalorienziel');
      } else {
        score -= 0.5; // unknown nutrition: slightly behind known matches
      }
    }

    pool.push({ c, base: score, reasons });
  }

  // Greedy pick: with "variety" every pick lowers same-category / same-ingredient candidates.
  const picked: Recommendation[] = [];
  const usedCategories = new Map<string, number>();
  const usedIngredients = new Map<string, number>();
  while (picked.length < input.count && pool.length) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i];
      let score = s.base;
      if (criteria.variety) {
        if (s.c.category) score -= 1.5 * (usedCategories.get(s.c.category) ?? 0);
        for (const ing of s.c.mainIngredients) score -= 0.6 * (usedIngredients.get(ing) ?? 0);
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    const [best] = pool.splice(bestIdx, 1);
    const reasons = [...best.reasons];
    if (criteria.variety && picked.length > 0 && best.c.category && !usedCategories.has(best.c.category)) {
      reasons.push(`Abwechslung: ${best.c.category}`);
    }
    if (best.c.category) usedCategories.set(best.c.category, (usedCategories.get(best.c.category) ?? 0) + 1);
    for (const ing of best.c.mainIngredients) usedIngredients.set(ing, (usedIngredients.get(ing) ?? 0) + 1);
    picked.push({
      id: best.c.id,
      title: best.c.title,
      imageUrl: best.c.imageUrl,
      category: best.c.category,
      kcal: best.c.kcal != null ? Math.round(best.c.kcal) : undefined,
      protein: best.c.protein != null ? Math.round(best.c.protein) : undefined,
      estimated: best.c.estimated,
      reasons
    });
  }
  return picked;
}

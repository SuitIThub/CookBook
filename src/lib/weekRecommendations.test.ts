import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CRITERIA, mainIngredientNames, recommendRecipes, weekSeed, type RecommendationCandidate, type RecommendationInput } from './weekRecommendations';

const DAY = 86_400_000;
const NOW = new Date('2026-10-12T12:00:00').getTime();

function c(id: string, extra: Partial<RecommendationCandidate> = {}): RecommendationCandidate {
  return { id, title: id, mainIngredients: [], ...extra };
}

function input(extra: Partial<RecommendationInput>): RecommendationInput {
  return {
    candidates: [],
    criteria: { favorites: false, longNotEaten: false, calorieGoal: false, variety: false },
    favoriteIds: new Set(),
    lastEaten: new Map(),
    plannedIds: new Set(),
    targetMealKcal: 0,
    now: NOW,
    count: 5,
    seed: 1,
    ...extra
  };
}

test('favorites come first when enabled', () => {
  const res = recommendRecipes(
    input({ candidates: [c('a'), c('b'), c('fav')], criteria: { ...DEFAULT_CRITERIA, longNotEaten: false, calorieGoal: false, variety: false }, favoriteIds: new Set(['fav']), count: 1 })
  );
  assert.equal(res[0].id, 'fav');
  assert.ok(res[0].reasons.includes('Favorit'));
});

test('recently eaten recipes are skipped, long-not-eaten ones preferred', () => {
  const res = recommendRecipes(
    input({
      candidates: [c('recent'), c('old'), c('mid')],
      criteria: { favorites: false, longNotEaten: true, calorieGoal: false, variety: false },
      lastEaten: new Map([
        ['recent', NOW - 2 * DAY],
        ['old', NOW - 50 * DAY],
        ['mid', NOW - 10 * DAY]
      ])
    })
  );
  assert.deepEqual(res.map((r) => r.id).slice(0, 2), ['old', 'mid']);
  assert.ok(!res.some((r) => r.id === 'recent'));
  assert.match(res[0].reasons.join(), /7 Wochen/);
});

test('planned recipes are never recommended', () => {
  const res = recommendRecipes(input({ candidates: [c('a'), c('b')], plannedIds: new Set(['a']) }));
  assert.deepEqual(res.map((r) => r.id), ['b']);
});

test('calorie goal prefers portions close to the meal target', () => {
  const res = recommendRecipes(
    input({
      candidates: [c('light', { kcal: 200 }), c('fit', { kcal: 640 }), c('heavy', { kcal: 1400 }), c('unknown')],
      criteria: { favorites: false, longNotEaten: false, calorieGoal: true, variety: false },
      targetMealKcal: 650,
      count: 4
    })
  );
  assert.equal(res[0].id, 'fit');
  assert.equal(res[res.length - 1].id, 'unknown');
});

test('variety spreads categories', () => {
  const res = recommendRecipes(
    input({
      candidates: [c('p1', { category: 'Pasta' }), c('p2', { category: 'Pasta' }), c('s1', { category: 'Suppe' })],
      criteria: { favorites: false, longNotEaten: false, calorieGoal: false, variety: true },
      count: 2
    })
  );
  // The second pick must come from the other category.
  assert.equal(new Set(res.map((r) => r.category)).size, 2);
});

test('same seed gives the same list, another seed may reorder', () => {
  const candidates = Array.from({ length: 30 }, (_, i) => c(`r${i}`));
  const a = recommendRecipes(input({ candidates, seed: 7 })).map((r) => r.id);
  const b = recommendRecipes(input({ candidates, seed: 7 })).map((r) => r.id);
  const d = recommendRecipes(input({ candidates, seed: 8 })).map((r) => r.id);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, d);
});

test('weekSeed is constant within a week and changes on Monday', () => {
  const sun = new Date('2026-10-11T20:00:00').getTime();
  const mon = new Date('2026-10-12T08:00:00').getTime();
  const fri = new Date('2026-10-16T08:00:00').getTime();
  assert.equal(weekSeed(mon), weekSeed(fri));
  assert.notEqual(weekSeed(sun), weekSeed(mon));
});

test('mainIngredientNames skips staples and duplicates', () => {
  assert.deepEqual(mainIngredientNames(['Salz', 'Hähnchenbrust', 'Zwiebel', 'Reis', 'hähnchenbrust', 'Brokkoli', 'Möhre']), ['hähnchenbrust', 'reis', 'brokkoli']);
});

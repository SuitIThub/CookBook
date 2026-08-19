import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeWeightTrend,
  estimateLearnedTdee,
  calculateCalorieGoal,
} from './calorieGoal';
import type { BodyProfile } from '../types/tracker';

// Run with: npx tsx --test src/lib/calorieGoal.test.ts

const NOW = Date.UTC(2026, 0, 29); // fixed "today"
const DAY = 86400000;

/** Daily weigh-ins for the last `days` days, changing by `slopePerDay` kg/day. */
function weighIns(days: number, startKg: number, slopePerDay: number) {
  const logs = [];
  for (let i = days - 1; i >= 0; i--) {
    logs.push({ loggedAt: new Date(NOW - i * DAY).toISOString(), weightKg: startKg - slopePerDay * (days - 1 - i) });
  }
  return logs;
}

test('computeWeightTrend recovers a clean linear slope', () => {
  const t = computeWeightTrend(weighIns(15, 80, 0.1), { now: NOW });
  assert.equal(t.count, 15);
  assert.ok(Math.abs(t.slopeKgPerDay - -0.1) < 1e-6); // losing 0.1 kg/day
  assert.ok(t.spanDays >= 14);
  assert.ok(t.r2 > 0.99);
});

test('computeWeightTrend needs at least two points', () => {
  const t = computeWeightTrend(weighIns(1, 80, 0), { now: NOW });
  assert.equal(t.slopeKgPerDay, 0);
  assert.equal(t.count, 1);
});

test('estimateLearnedTdee: enough data → learned maintenance', () => {
  const r = estimateLearnedTdee({
    dailyIntakeKcal: Array(12).fill(2000),
    weightLogs: weighIns(15, 80, 0.1), // -0.1 kg/day
    now: NOW,
  });
  assert.equal(r.confidence, 'ok');
  // 2000 intake while losing 0.1 kg/day ⇒ maintenance ≈ 2000 + 0.1*7700 = 2770
  assert.equal(r.tdee, 2770);
});

test('estimateLearnedTdee: too few weigh-ins → learning, no value', () => {
  const r = estimateLearnedTdee({
    dailyIntakeKcal: Array(12).fill(2000),
    weightLogs: weighIns(3, 80, 0.1),
    now: NOW,
  });
  assert.equal(r.tdee, null);
  assert.equal(r.confidence, 'learning');
});

test('estimateLearnedTdee: partial days are excluded from the average', () => {
  const r = estimateLearnedTdee({
    // 10 full days + 5 clearly-incomplete days (should be dropped, not averaged in)
    dailyIntakeKcal: [...Array(10).fill(2200), ...Array(5).fill(300)],
    weightLogs: weighIns(15, 80, 0),
    now: NOW,
  });
  assert.equal(r.completeLogDays, 10);
  assert.equal(r.avgIntakeKcal, 2200);
  assert.equal(r.confidence, 'ok');
  assert.equal(r.tdee, 2200); // weight stable ⇒ maintenance = intake
});

test('estimateLearnedTdee: nothing logged → insufficient', () => {
  const r = estimateLearnedTdee({ dailyIntakeKcal: [], weightLogs: [], now: NOW });
  assert.equal(r.confidence, 'insufficient');
  assert.equal(r.tdee, null);
});

test('calculateCalorieGoal marks the tdee source', () => {
  const profile: BodyProfile = { heightCm: 180, ageYears: 30, gender: 'male', activity: 1.5, weeklyChangeKg: -0.5 };
  const formula = calculateCalorieGoal(profile, 80);
  assert.equal(formula.tdeeSource, 'formula');
  const learned = calculateCalorieGoal(profile, 80, 2800);
  assert.equal(learned.tdeeSource, 'learned');
  assert.equal(learned.tdee, 2800);
  // target follows the learned maintenance (2800 − 0.5 kg/wk deficit ≈ 2800 − 550)
  assert.equal(learned.targetKcal, 2250);
});

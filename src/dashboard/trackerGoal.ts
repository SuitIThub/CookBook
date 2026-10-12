/**
 * Calorie goal for the dashboard — computed exactly like the tracker page:
 * body profile + latest weight, with the learned TDEE (28 days of diary and
 * weigh-ins) once it is reliable. Shared by several widgets; one load per
 * host is cached briefly so a dashboard with five tracker widgets asks once.
 */
import { calculateCalorieGoal, estimateLearnedTdee } from '../lib/calorieGoal';
import type { CalorieGoal, WeightLog } from '../types/tracker';
import type { DashboardData } from './data';
import { startOfDay } from './ui';

export interface GoalInfo {
  goal: CalorieGoal;
  weightLogs: WeightLog[];
  /** Profile has the fields needed for a real goal (else targetKcal is a guess). */
  profileComplete: boolean;
}

const cache = new WeakMap<DashboardData, { at: number; promise: Promise<GoalInfo> }>();
const TTL_MS = 30_000;

export function invalidateGoal(host: DashboardData): void {
  cache.delete(host);
}

export function loadGoal(host: DashboardData): Promise<GoalInfo> {
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = (async () => {
    const profile = host.profile();
    const weightLogs = await host.weightLogs();
    const now = Date.now();
    const entries = await host.diary(new Date(now - 28 * 86_400_000).toISOString(), new Date(now).toISOString());
    const byDay = new Map<number, number>();
    for (const e of entries) {
      const kcal = Number(e.nutrition?.calories);
      if (!Number.isFinite(kcal)) continue;
      const key = startOfDay(new Date(e.eatenAt)).getTime();
      byDay.set(key, (byDay.get(key) || 0) + kcal);
    }
    const learned = estimateLearnedTdee({ dailyIntakeKcal: [...byDay.values()], weightLogs, windowDays: 28, now });
    const override = learned?.confidence === 'ok' && learned.tdee ? learned.tdee : undefined;
    const currentWeight = weightLogs[0]?.weightKg || 0;
    const goal = calculateCalorieGoal(profile, currentWeight || profile.targetWeightKg || 70, override);
    const profileComplete = !!(profile.heightCm && profile.ageYears && (currentWeight || profile.targetWeightKg));
    return { goal, weightLogs, profileComplete };
  })();
  cache.set(host, { at: Date.now(), promise });
  promise.catch(() => cache.delete(host));
  return promise;
}

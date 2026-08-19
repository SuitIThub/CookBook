import type { BodyProfile, CalorieGoal } from '../types/tracker';

/** Wishnofsky / 3500 kcal per lb — first-order planning only; Hall et al. show it overestimates long-term loss. */
export const KCAL_PER_KG_CHANGE = 7700;
export const MAX_WEEKLY_LOSS_KG = 1;
export const MAX_WEEKLY_GAIN_KG = 0.5;
const FAT_TARGET_FRACTION = 0.3;
const FAT_MIN_FRACTION = 0.2;
const FAT_MAX_FRACTION = 0.35;
const PROTEIN_DGE_MIN_G_PER_KG = 0.8;
const FIBER_DGE_G = 30;
const SALT_WHO_G = 5;

/**
 * Compute BMR using Mifflin-St Jeor (best general starting estimate).
 * male: 10*kg + 6.25*cm - 5*age + 5
 * female / other: 10*kg + 6.25*cm - 5*age - 161
 * This is an RMR estimate, not a measurement (gold standard: indirect calorimetry).
 */
export function calculateBmr(weightKg: number, heightCm: number, ageYears: number, gender: BodyProfile['gender']): number {
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm) || !Number.isFinite(ageYears)) return 0;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return gender === 'male' ? base + 5 : base - 161;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function defaultProteinGPerKg(profile: BodyProfile, weeklyChangeKg: number): number {
  if (profile.proteinGramsPerKg && profile.proteinGramsPerKg > 0) return profile.proteinGramsPerKg;
  const age = profile.ageYears && profile.ageYears > 0 ? profile.ageYears : 0;
  // Deficit: ISSN-style higher protein to protect fat-free mass (1.4–2.0).
  if (weeklyChangeKg < 0) return 1.6;
  // DGE: 0.8 g/kg <65, 1.0 g/kg ≥65 — tracker default sits slightly above for mixed activity.
  if (age >= 65) return 1.2;
  return 1.2;
}

/**
 * Daily calorie/macro target from a BodyProfile.
 *
 * - BMR: Mifflin-St Jeor.
 * - Maintenance (TDEE/Erhalt) = BMR × PAL. Do not add TEF on top of PAL.
 * - Weekly change uses 7700 kcal/kg as a first-week estimate (static rule).
 * - Unsupervised floor is estimated BMR, not a universal 1200/1500 kcal cut-off.
 * - 1200 (women/other) / 1500 (men) are warning thresholds (NICE LED is medically supervised).
 * - Macros: protein and fat first (AMDR fat 20–35 E%), carbs as remainder. Fibre DGE 30 g, salt WHO 5 g.
 */
export function calculateCalorieGoal(profile: BodyProfile, currentWeightKg: number): CalorieGoal {
  const activity = profile.activity && profile.activity > 0 ? profile.activity : 1.4;
  const weight = Number.isFinite(currentWeightKg) && currentWeightKg > 0 ? currentWeightKg : 0;
  const height = profile.heightCm && profile.heightCm > 0 ? profile.heightCm : 0;
  const age = profile.ageYears && profile.ageYears > 0 ? profile.ageYears : 0;

  const bmr = calculateBmr(weight, height, age, profile.gender);
  const tdee = bmr * activity;

  const requestedWeekly = Number.isFinite(profile.weeklyChangeKg ?? 0) ? profile.weeklyChangeKg ?? 0 : 0;
  const weeklyChange = clamp(requestedWeekly, -MAX_WEEKLY_LOSS_KG, MAX_WEEKLY_GAIN_KG);
  const deltaPerDay = (weeklyChange * KCAL_PER_KG_CHANGE) / 7;
  const rawTarget = tdee + deltaPerDay;

  const minKcal = bmr > 0 ? Math.round(bmr) : 0;
  const warningLowKcal = profile.gender === 'male' ? 1500 : 1200;
  const clampedToBmr = minKcal > 0 && rawTarget < minKcal;
  const targetKcal = Math.round(clampedToBmr ? minKcal : Math.max(0, rawTarget));
  const lowEnergyWarning = targetKcal > 0 && warningLowKcal > 0 && targetKcal < warningLowKcal;

  const proteinGperKg = defaultProteinGPerKg(profile, weeklyChange);
  let targetProteinG = weight > 0 ? Math.round(weight * proteinGperKg) : 0;
  const proteinMinG = weight > 0 ? Math.round(weight * PROTEIN_DGE_MIN_G_PER_KG) : 0;
  targetProteinG = Math.max(targetProteinG, proteinMinG);

  const fatFromFraction = (frac: number) => Math.round((targetKcal * frac) / 9);
  let targetFatG = fatFromFraction(FAT_TARGET_FRACTION);
  const fatMinG = Math.max(fatFromFraction(FAT_MIN_FRACTION), weight > 0 ? Math.round(weight * 0.8) : 0);
  const fatMaxG = fatFromFraction(FAT_MAX_FRACTION);
  targetFatG = clamp(targetFatG, fatMinG, Math.max(fatMinG, fatMaxG));

  let remainingKcal = targetKcal - targetProteinG * 4 - targetFatG * 9;
  if (remainingKcal < 0 && targetProteinG > proteinMinG) {
    const extraProteinKcal = (targetProteinG - proteinMinG) * 4;
    const reduce = Math.min(-remainingKcal, extraProteinKcal);
    targetProteinG = Math.max(proteinMinG, Math.round(targetProteinG - reduce / 4));
    remainingKcal = targetKcal - targetProteinG * 4 - targetFatG * 9;
  }
  const targetCarbsG = Math.max(0, Math.round(remainingKcal / 4));

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    targetKcal,
    minKcal,
    warningLowKcal,
    targetProteinG,
    targetFatG,
    targetCarbsG,
    targetFiberG: FIBER_DGE_G,
    targetSaltG: SALT_WHO_G,
    clampedToBmr,
    lowEnergyWarning,
  };
}

/** WHO adult BMI category boundaries (kg/m²). */
export const BMI_BOUNDARIES = [
  { bmi: 18.5, label: 'Untergewicht' },
  { bmi: 25, label: 'Normalgewicht' },
  { bmi: 30, label: 'Übergewicht' },
  { bmi: 35, label: 'Adipositas I' },
  { bmi: 40, label: 'Adipositas II' },
] as const;

/** Colored bands between WHO BMI cut-offs. `to` is exclusive; last band is open-ended. */
export const BMI_BANDS = [
  { from: 0, to: 18.5, label: 'Untergewicht', fill: 'rgba(56, 189, 248, 0.16)', darkFill: 'rgba(56, 189, 248, 0.12)' },
  { from: 18.5, to: 25, label: 'Normalgewicht', fill: 'rgba(16, 185, 129, 0.18)', darkFill: 'rgba(16, 185, 129, 0.14)' },
  { from: 25, to: 30, label: 'Übergewicht', fill: 'rgba(234, 179, 8, 0.18)', darkFill: 'rgba(234, 179, 8, 0.14)' },
  { from: 30, to: 35, label: 'Adipositas I', fill: 'rgba(249, 115, 22, 0.16)', darkFill: 'rgba(249, 115, 22, 0.12)' },
  { from: 35, to: 40, label: 'Adipositas II', fill: 'rgba(239, 68, 68, 0.16)', darkFill: 'rgba(239, 68, 68, 0.12)' },
  { from: 40, to: Infinity, label: 'Adipositas III', fill: 'rgba(185, 28, 28, 0.18)', darkFill: 'rgba(185, 28, 28, 0.14)' },
] as const;

export function calculateBmi(weightKg: number, heightCm: number): number | null {
  if (!Number.isFinite(weightKg) || weightKg <= 0 || !Number.isFinite(heightCm) || heightCm <= 0) return null;
  const meters = heightCm / 100;
  const bmi = weightKg / (meters * meters);
  return Number.isFinite(bmi) ? Math.round(bmi * 10) / 10 : null;
}

export function weightForBmi(bmi: number, heightCm: number): number | null {
  if (!Number.isFinite(bmi) || bmi <= 0 || !Number.isFinite(heightCm) || heightCm <= 0) return null;
  const meters = heightCm / 100;
  const kg = bmi * meters * meters;
  return Number.isFinite(kg) ? Math.round(kg * 10) / 10 : null;
}

export function bmiCategoryLabel(bmi: number): string {
  if (!Number.isFinite(bmi) || bmi <= 0) return '';
  if (bmi < 18.5) return 'Untergewicht';
  if (bmi < 25) return 'Normalgewicht';
  if (bmi < 30) return 'Übergewicht';
  if (bmi < 35) return 'Adipositas I';
  if (bmi < 40) return 'Adipositas II';
  return 'Adipositas III';
}

/** Sum two NutritionData objects, treating missing values as zero. */
export function addNutrition(a: import('../types/recipe').NutritionData, b: import('../types/recipe').NutritionData): import('../types/recipe').NutritionData {
  const keys: (keyof import('../types/recipe').NutritionData)[] = [
    'calories',
    'carbohydrates',
    'protein',
    'fat',
    'saturatedFat',
    'sugar',
    'fiber',
    'salt',
  ];
  const result: import('../types/recipe').NutritionData = {};
  for (const key of keys) {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) continue;
    result[key] = (av ?? 0) + (bv ?? 0);
  }
  return result;
}

/** Scale NutritionData by a factor (e.g. servings consumed). */
export function scaleNutrition(nutrition: import('../types/recipe').NutritionData, factor: number): import('../types/recipe').NutritionData {
  if (!Number.isFinite(factor)) return { ...nutrition };
  const result: import('../types/recipe').NutritionData = {};
  for (const key of Object.keys(nutrition) as (keyof import('../types/recipe').NutritionData)[]) {
    const v = nutrition[key];
    if (v == null) continue;
    result[key] = v * factor;
  }
  return result;
}

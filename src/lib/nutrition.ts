import type { NutritionData } from '../types/recipe';

export type NutritionFieldKey = keyof NutritionData;

export interface NutritionFieldDef {
  key: NutritionFieldKey;
  label: string;
  editLabel: string;
  unit: string;
  inputId: string;
  placeholder: string;
  step: string;
  valueClass: string;
  group: 'primary' | 'detail';
}

/** Canonical nutrition fields (EU LMIV Big 7 + fiber), per serving. */
export const NUTRITION_FIELDS: NutritionFieldDef[] = [
  {
    key: 'calories',
    label: 'kcal',
    editLabel: 'Kalorien (kcal)',
    unit: 'kcal',
    inputId: 'edit-calories',
    placeholder: 'z.B. 350',
    step: '1',
    valueClass: 'text-orange-600 dark:text-orange-400',
    group: 'primary',
  },
  {
    key: 'carbohydrates',
    label: 'Kohlenhydrate',
    editLabel: 'Kohlenhydrate (g)',
    unit: 'g',
    inputId: 'edit-carbohydrates',
    placeholder: 'z.B. 45',
    step: '0.1',
    valueClass: 'text-blue-600 dark:text-blue-400',
    group: 'primary',
  },
  {
    key: 'protein',
    label: 'Eiweiß',
    editLabel: 'Eiweiß (g)',
    unit: 'g',
    inputId: 'edit-protein',
    placeholder: 'z.B. 25',
    step: '0.1',
    valueClass: 'text-purple-600 dark:text-purple-400',
    group: 'primary',
  },
  {
    key: 'fat',
    label: 'Fett',
    editLabel: 'Fett (g)',
    unit: 'g',
    inputId: 'edit-fat',
    placeholder: 'z.B. 12',
    step: '0.1',
    valueClass: 'text-yellow-600 dark:text-yellow-400',
    group: 'primary',
  },
  {
    key: 'saturatedFat',
    label: 'gesätt. Fett',
    editLabel: 'davon gesättigte Fettsäuren (g)',
    unit: 'g',
    inputId: 'edit-saturated-fat',
    placeholder: 'z.B. 4',
    step: '0.1',
    valueClass: 'text-amber-700 dark:text-amber-400',
    group: 'detail',
  },
  {
    key: 'sugar',
    label: 'Zucker',
    editLabel: 'davon Zucker (g)',
    unit: 'g',
    inputId: 'edit-sugar',
    placeholder: 'z.B. 8',
    step: '0.1',
    valueClass: 'text-pink-600 dark:text-pink-400',
    group: 'detail',
  },
  {
    key: 'fiber',
    label: 'Ballaststoffe',
    editLabel: 'Ballaststoffe (g)',
    unit: 'g',
    inputId: 'edit-fiber',
    placeholder: 'z.B. 5',
    step: '0.1',
    valueClass: 'text-lime-600 dark:text-lime-400',
    group: 'detail',
  },
  {
    key: 'salt',
    label: 'Salz',
    editLabel: 'Salz (g)',
    unit: 'g',
    inputId: 'edit-salt',
    placeholder: 'z.B. 1,2',
    step: '0.01',
    valueClass: 'text-slate-600 dark:text-slate-300',
    group: 'detail',
  },
];

export const NUTRITION_INPUT_IDS = NUTRITION_FIELDS.map((field) => field.inputId);

export function hasNutritionValues(nutrition?: NutritionData | null): boolean {
  if (!nutrition) return false;
  return NUTRITION_FIELDS.some((field) => nutrition[field.key] != null);
}

function parseNumeric(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = value.match(/(\d+(?:[.,]\d+)?)/);
    if (!match) return undefined;
    const parsed = Number.parseFloat(match[1].replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (value && typeof value === 'object' && 'value' in (value as object)) {
    return parseNumeric((value as { value: unknown }).value);
  }
  return undefined;
}

function roundNutrition(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Convert schema.org sodiumContent (typically mg sodium) to grams of salt. */
function saltFromSodium(value: unknown): number | undefined {
  const asString = typeof value === 'string' ? value : '';
  const amount = parseNumeric(value);
  if (amount == null) return undefined;
  const isMg = /mg/i.test(asString) || (!/[gk]g/i.test(asString) && amount > 20);
  if (isMg) return roundNutrition((amount * 2.5) / 1000);
  return roundNutrition(amount);
}

const JSON_LD_KEYS: Record<NutritionFieldKey, string[]> = {
  calories: ['calories', 'energyContent'],
  carbohydrates: ['carbohydrateContent'],
  protein: ['proteinContent'],
  fat: ['fatContent'],
  saturatedFat: ['saturatedFatContent'],
  sugar: ['sugarContent'],
  fiber: ['fiberContent'],
  salt: ['saltContent'],
};

export function nutritionFromJsonLd(nutrition: unknown): NutritionData | undefined {
  if (!nutrition || typeof nutrition !== 'object') return undefined;

  if (Array.isArray(nutrition)) {
    const merged: NutritionData = {};
    for (const item of nutrition) {
      const extracted = nutritionFromJsonLd(item);
      if (extracted) Object.assign(merged, extracted);
    }
    return hasNutritionValues(merged) ? merged : undefined;
  }

  const obj = nutrition as Record<string, unknown>;
  const source =
    obj['@type'] === 'NutritionInformation' || obj.nutrition == null
      ? obj
      : (obj.nutrition as Record<string, unknown>);

  if (!source || typeof source !== 'object') return undefined;

  const result: NutritionData = {};
  for (const field of NUTRITION_FIELDS) {
    for (const key of JSON_LD_KEYS[field.key]) {
      if (source[key] == null) continue;
      const parsed = parseNumeric(source[key]);
      if (parsed != null) {
        result[field.key] = parsed;
        break;
      }
    }
  }

  if (result.salt == null && source.sodiumContent != null) {
    const salt = saltFromSodium(source.sodiumContent);
    if (salt != null) result.salt = salt;
  }

  return hasNutritionValues(result) ? result : undefined;
}

/** Port of components/recipe/details/NutritionInfo.astro (per-serving card with assessment). */
import type { NutritionData } from '@/types';
import { NUTRITION_FIELDS, hasNutritionValues } from '@core/nutrition';

type Assessment = { symbol: string; color: string; title: string };
const scale = (v: number, [a, b, c]: [number, number, number]): Assessment => {
  if (v < a) return { symbol: '⬇️', color: 'text-blue-500', title: 'Niedrig' };
  if (v <= b) return { symbol: '✅', color: 'text-green-500', title: 'Optimal' };
  if (v <= c) return { symbol: '⚠️', color: 'text-yellow-500', title: 'Hoch' };
  return { symbol: '⬆️', color: 'text-red-500', title: 'Sehr hoch' };
};
function assessPrimary(key: string, v: number): Assessment | null {
  if (key === 'calories') return scale(v, [200, 500, 700]);
  if (key === 'carbohydrates') return scale(v, [20, 60, 80]);
  if (key === 'protein') return scale(v, [10, 35, 50]);
  if (key === 'fat') return scale(v, [5, 25, 35]);
  return null;
}

export default function NutritionInfo({ nutrition, isEstimated = false, sourceLabel }: { nutrition: NutritionData; isEstimated?: boolean; sourceLabel?: string }) {
  if (!hasNutritionValues(nutrition)) return null;
  const primary = NUTRITION_FIELDS.filter((f) => f.group === 'primary');
  const detail = NUTRITION_FIELDS.filter((f) => f.group === 'detail');
  const n = nutrition as Record<string, number | undefined>;
  const fmt = (key: string, v: number, unit: string) => {
    const r = key === 'calories' ? Math.round(v) : Math.round(v * 10) / 10;
    return `${isEstimated ? '~' : ''}${r}${key === 'calories' ? '' : unit}`;
  };
  return (
    <div className="mb-4 rounded-lg border border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-4 dark:border-green-700 dark:from-green-900/20 dark:to-emerald-900/20">
      <h3 className="mb-3 flex flex-wrap items-center justify-between gap-2 text-lg font-semibold text-green-800 dark:text-green-200">
        <span className="flex items-center">
          <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
          Nährwerte pro Portion
          {isEstimated && <span className="ml-2 text-xs font-normal text-yellow-700 dark:text-yellow-300" title="mind. eine Zutat geschätzt">~ geschätzt</span>}
        </span>
        {sourceLabel && <span className="text-xs font-normal text-gray-600 dark:text-gray-300">{sourceLabel}</span>}
      </h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {primary.map((f) => {
          const v = n[f.key];
          if (v == null) return null;
          const a = assessPrimary(f.key, v);
          return (
            <div key={f.key} className="text-center">
              <div className="mb-1 flex items-center justify-center">
                <div className={`mr-2 text-2xl font-bold ${f.valueClass}`}>{fmt(f.key, v, f.unit)}</div>
                {a && <span className={`text-lg ${a.color}`} title={a.title}>{a.symbol}</span>}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">{f.label}</div>
            </div>
          );
        })}
      </div>
      {detail.some((f) => n[f.key] != null) && (
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-green-200 pt-3 dark:border-green-700 sm:grid-cols-4">
          {detail.map((f) => {
            const v = n[f.key];
            if (v == null) return null;
            return (
              <div key={f.key} className="text-center">
                <div className={`text-lg font-semibold ${f.valueClass}`}>{isEstimated ? '~' : ''}{Math.round(v * 100) / 100}{f.unit}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400">{f.label}</div>
              </div>
            );
          })}
        </div>
      )}
      {primary.some((f) => n[f.key] != null) && (
        <div className="mt-4 border-t border-green-200 pt-3 dark:border-green-700">
          <div className="flex flex-wrap justify-center gap-4 text-xs text-gray-500 dark:text-gray-400">
            <span className="flex items-center"><span className="mr-1 text-blue-500">⬇️</span> Niedrig</span>
            <span className="flex items-center"><span className="mr-1 text-green-500">✅</span> Optimal</span>
            <span className="flex items-center"><span className="mr-1 text-yellow-500">⚠️</span> Hoch</span>
            <span className="flex items-center"><span className="mr-1 text-red-500">⬆️</span> Sehr hoch</span>
          </div>
        </div>
      )}
    </div>
  );
}

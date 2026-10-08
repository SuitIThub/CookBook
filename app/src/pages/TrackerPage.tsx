import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  calculateCalorieGoal,
  addNutrition,
  scaleNutrition,
  calculateBmi,
  weightForBmi,
  bmiCategoryLabel,
  BMI_BANDS,
  BMI_BOUNDARIES,
  estimateLearnedTdee,
  computeWeightTrend,
  TDEE_MIN_SPAN_DAYS,
  TDEE_MIN_WEIGH_INS,
} from '@core/calorieGoal';
import { lookupGramsPerUnit, servingUnitName } from '@core/units';
import type { NutritionData } from '@shared/recipe';
import type {
  BodyProfile,
  CalorieGoal,
  DiaryComponent,
  DiaryComposition,
  DiaryEntry,
  LearnedTdee,
  MealPlan,
  WeightLog,
} from '@shared/tracker';
import { getAlias } from '../lib/settings';
import { onAliasSettingsChanged } from '../lib/aliasSync';
import { onSyncDataChanged } from '../lib/syncRunner';
import { openAliasSettings } from '../components/settings/headerActions';
import { searchProducts as offSearch, lookupProductByEan } from '../lib/products';
import * as tracker from '../lib/tracker';
import type { DiaryEntryDetail, RecipeSuggestion } from '../lib/tracker';
import BarcodeScanner from '../components/BarcodeScanner';

// ============================================================ date helpers ===
function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function toDateInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toDateTimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${toDateInputValue(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ============================================================ misc helpers ===
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function formatPortions(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}
function formatEuro(value: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
}
function formatMacroLine(nutrition: NutritionData | undefined): string {
  const kcal = Math.round(Number(nutrition?.calories || 0));
  const protein = Number(nutrition?.protein || 0);
  const carbs = Number(nutrition?.carbohydrates || 0);
  const fat = Number(nutrition?.fat || 0);
  return [kcal ? `${kcal} kcal` : '', protein ? `E ${Math.round(protein)} g` : '', carbs ? `KH ${Math.round(carbs)} g` : '', fat ? `F ${Math.round(fat)} g` : '']
    .filter(Boolean)
    .join(' · ');
}
function parseNumOr(v: string): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ========================================================= product picks ===
type PickedProduct = {
  id?: string;
  ean?: string;
  name: string;
  brand?: string;
  netGrams?: number;
  servingGrams?: number;
  servingLabel?: string;
  packageLabel?: string;
  nutritionPer100g?: NutritionData;
  gramsByUnit?: Record<string, number>;
  source: 'local' | 'openfoodfacts';
  offCode?: string;
  imageUrl?: string;
};
type ProductPick = PickedProduct & { pickKind: 'product' };
type IngredientPick = {
  pickKind: 'ingredient';
  id: string;
  name: string;
  nutritionPer100g?: NutritionData;
  gramsByUnit?: Record<string, number>;
};
type Pick = ProductPick | IngredientPick;

function gramsByUnitFromOff(p: any): Record<string, number> | undefined {
  if (p.gramsByUnit && typeof p.gramsByUnit === 'object') return { ...p.gramsByUnit };
  const serving = Number(p.servingGrams);
  if (!Number.isFinite(serving) || serving <= 0) return undefined;
  return { [servingUnitName(p.servingLabel)]: serving };
}
function asLocalPick(p: any): PickedProduct {
  return {
    id: p.id,
    ean: p.ean || undefined,
    name: p.name || (p.ean ? `Produkt ${p.ean}` : 'Produkt'),
    brand: p.brand || undefined,
    netGrams: Number.isFinite(Number(p.netGrams)) ? Number(p.netGrams) : undefined,
    packageLabel: p.packageLabel || undefined,
    servingGrams: Number.isFinite(Number(p.servingGrams)) ? Number(p.servingGrams) : undefined,
    servingLabel: p.servingLabel || undefined,
    nutritionPer100g: p.nutritionPer100g || undefined,
    gramsByUnit: p.gramsByUnit && typeof p.gramsByUnit === 'object' ? { ...p.gramsByUnit } : undefined,
    source: 'local',
    offCode: p.offCode || undefined,
    imageUrl: p.imageUrl || undefined,
  };
}
function asOffPick(p: any): PickedProduct {
  return {
    ean: p.ean || undefined,
    name: p.name || (p.ean ? `Produkt ${p.ean}` : 'Produkt'),
    brand: p.brand || undefined,
    netGrams: Number.isFinite(Number(p.netGrams)) ? Number(p.netGrams) : undefined,
    packageLabel: p.packageLabel || undefined,
    servingGrams: Number.isFinite(Number(p.servingGrams)) ? Number(p.servingGrams) : undefined,
    servingLabel: p.servingLabel || undefined,
    nutritionPer100g: p.nutritionPer100g || undefined,
    gramsByUnit: gramsByUnitFromOff(p),
    source: 'openfoodfacts',
    offCode: p.offCode || undefined,
    imageUrl: p.imageUrl || undefined,
  };
}
function displayProductName(p: PickedProduct): string {
  return p.brand ? `${p.brand} – ${p.name}` : p.name;
}
function pickLabel(pick: Pick): string {
  return pick.pickKind === 'ingredient' ? pick.name : displayProductName(pick);
}
function productMetaLine(p: PickedProduct): string {
  const parts: string[] = [];
  if (p.brand) parts.push(p.brand);
  if (p.packageLabel) parts.push(p.packageLabel);
  else if (p.netGrams) parts.push(`${p.netGrams} g Packung`);
  if (p.servingGrams) parts.push(p.servingLabel ? `${p.servingLabel}` : `Portion ${p.servingGrams} g`);
  const kcal = p.nutritionPer100g?.calories;
  if (kcal != null) parts.push(`${Math.round(kcal)} kcal / 100 g`);
  return parts.join(' · ');
}

interface UnitOption {
  value: string;
  label: string;
}
function buildUnitOptions(pick: Pick): { options: UnitOption[]; defaultValue: string; defaultAmount: string } {
  const gramsByUnit = pick.gramsByUnit;
  const netGrams = pick.pickKind === 'product' ? pick.netGrams : undefined;
  const servingGrams = pick.pickKind === 'product' ? pick.servingGrams : undefined;
  const servingLabel = pick.pickKind === 'product' ? pick.servingLabel : undefined;
  const packageLabel = pick.pickKind === 'product' ? pick.packageLabel : undefined;
  const options: UnitOption[] = [{ value: 'g', label: 'Gramm' }];
  if (netGrams && netGrams > 0) {
    options.push({ value: 'pack', label: packageLabel ? `Packung (${packageLabel})` : `Packung (${netGrams} g)` });
  }
  if (gramsByUnit) {
    for (const [unit, grams] of Object.entries(gramsByUnit)) {
      if (!Number.isFinite(grams) || grams <= 0) continue;
      options.push({ value: `u:${unit}`, label: `${unit} (${grams} g)` });
    }
  }
  const servingAlreadyMapped =
    lookupGramsPerUnit(gramsByUnit, servingUnitName(servingLabel)) != null || lookupGramsPerUnit(gramsByUnit, 'Portion') != null;
  if (servingGrams && servingGrams > 0 && !servingAlreadyMapped) {
    options.push({ value: 'serving', label: servingLabel ? `Portion (${servingLabel})` : `Portion (${servingGrams} g)` });
  }
  // Preferred default unit
  let pickedUnit = 'g';
  if (gramsByUnit) {
    for (const name of ['Scheibe', 'Stück', 'Portion']) {
      const key = Object.keys(gramsByUnit).find((k) => lookupGramsPerUnit({ [k]: gramsByUnit[k] }, name) != null);
      if (key) {
        pickedUnit = `u:${key}`;
        break;
      }
    }
  }
  if (pickedUnit === 'g' && servingGrams && !servingAlreadyMapped) pickedUnit = 'serving';
  const values = options.map((o) => o.value);
  const defaultValue = values.includes(pickedUnit) ? pickedUnit : 'g';
  return { options, defaultValue, defaultAmount: defaultValue === 'g' ? '100' : '1' };
}
function resolveGrams(pick: Pick, amountStr: string, unit: string): number | undefined {
  const amount = Number(amountStr);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  if (pick.pickKind === 'product') {
    if (unit === 'pack') return pick.netGrams && pick.netGrams > 0 ? amount * pick.netGrams : undefined;
    if (unit === 'serving') return pick.servingGrams && pick.servingGrams > 0 ? amount * pick.servingGrams : undefined;
  }
  if (unit.startsWith('u:')) {
    const key = unit.slice(2);
    const per = pick.gramsByUnit?.[key] ?? lookupGramsPerUnit(pick.gramsByUnit, key);
    return per && per > 0 ? amount * per : undefined;
  }
  return amount;
}

// ============================================================= dark mode ===
function useDarkMode(): boolean {
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

// ========================================================== donut ring svg ===
function ringColor(consumed: number, target: number, over: string, ok: string): string {
  if (target <= 0) return ok;
  const pct = consumed / target;
  if (pct > 1.1) return over;
  if (pct > 1) return '#eab308';
  return ok;
}
function donutSvg(opts: {
  size: number;
  consumed: number;
  target: number;
  label: string;
  unit: string;
  color: string;
  overlay?: { value: number; color: string; label: string };
  showOverlay: boolean;
  dark: boolean;
}): string {
  const { size, consumed, target, label, unit, color, dark } = opts;
  const cx = size / 2;
  const cy = size / 2;
  const showOverlay = opts.showOverlay && opts.overlay && opts.overlay.value > 0 && consumed > target + 1;
  const outerR = showOverlay ? size * 0.42 : size * 0.38;
  const innerR = showOverlay ? size * 0.32 : outerR;
  const track = dark ? '#374151' : '#e5e7eb';
  const text = dark ? '#f9fafb' : '#111827';
  const muted = dark ? '#9ca3af' : '#6b7280';
  const circ = (r: number) => 2 * Math.PI * r;
  const dash = (r: number, pct: number) => {
    const c = circ(r);
    const p = Math.max(0, Math.min(pct, 1));
    return `${(p * c).toFixed(2)} ${c.toFixed(2)}`;
  };
  const targetPct = target > 0 ? consumed / target : 0;
  const parts: string[] = [];
  parts.push(`<svg viewBox="0 0 ${size} ${size}" class="mx-auto" width="${size}" height="${size}" role="img" aria-label="${escapeHtml(label)}">`);
  if (showOverlay && opts.overlay) {
    const overPct = consumed / opts.overlay.value;
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${outerR}" fill="none" stroke="${track}" stroke-width="${size * 0.07}" />`);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${outerR}" fill="none" stroke="${opts.overlay.color}" stroke-width="${size * 0.07}" stroke-linecap="round" stroke-dasharray="${dash(outerR, overPct)}" transform="rotate(-90 ${cx} ${cy})" />`);
  }
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="none" stroke="${track}" stroke-width="${size * 0.09}" />`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="none" stroke="${color}" stroke-width="${size * 0.09}" stroke-linecap="round" stroke-dasharray="${dash(innerR, targetPct)}" transform="rotate(-90 ${cx} ${cy})" />`);
  const consumedLabel = Number.isInteger(consumed) ? String(Math.round(consumed)) : String(Math.round(consumed * 10) / 10);
  const targetLabel = String(Math.round(target));
  parts.push(`<text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="${text}" font-size="${size * 0.13}" font-weight="700">${escapeHtml(consumedLabel)}</text>`);
  parts.push(`<text x="${cx}" y="${cy + size * 0.09}" text-anchor="middle" fill="${muted}" font-size="${size * 0.07}">/ ${escapeHtml(targetLabel)}${escapeHtml(unit)}</text>`);
  parts.push('</svg>');
  return parts.join('');
}

function Html({ html, className }: { html: string; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function TrackerPage() {
  const [alias, setAliasState] = useState(getAlias);
  useEffect(() => onAliasSettingsChanged(() => setAliasState(getAlias())), []);
  const dark = useDarkMode();

  if (!alias) {
    return (
      <div className="mx-auto max-w-5xl">
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-6 text-center dark:border-yellow-700 dark:bg-yellow-900/20">
          <h1 className="mb-2 text-xl font-semibold text-yellow-900 dark:text-yellow-100">Tracker benötigt einen Alias</h1>
          <p className="mb-4 text-sm text-yellow-800 dark:text-yellow-200">
            Der Kalorien- und Nährwerttracker ist an einen Alias gebunden — Körperprofil, Gewichtsverlauf und Tagebuch werden
            zusammen mit deinen Geräte-Einstellungen synchronisiert.
          </p>
          <button type="button" onClick={openAliasSettings} className="rounded bg-orange-500 px-4 py-2 font-medium text-white hover:bg-orange-600">
            Alias einrichten
          </button>
        </div>
      </div>
    );
  }
  return <TrackerBody alias={alias} dark={dark} />;
}

// ===========================================================================
function TrackerBody({ alias, dark }: { alias: string; dark: boolean }) {
  const [profile, setProfile] = useState<BodyProfile>(() => tracker.readLocalProfile());
  const [weightLogs, setWeightLogs] = useState<WeightLog[]>([]);
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [plans, setPlans] = useState<MealPlan[]>([]);
  const [learnedTdee, setLearnedTdee] = useState<LearnedTdee | null>(null);
  const [selectedDay, setSelectedDay] = useState(() => startOfLocalDay(new Date()));
  const [suggestions, setSuggestions] = useState<RecipeSuggestion[]>([]);
  const [scanHandler, setScanHandler] = useState<((ean: string) => void) | null>(null);

  const currentWeight = weightLogs[0]?.weightKg || 0;
  const goal = useMemo<CalorieGoal>(() => {
    const override = learnedTdee?.confidence === 'ok' && learnedTdee.tdee ? learnedTdee.tdee : undefined;
    return calculateCalorieGoal(profile, currentWeight || profile.targetWeightKg || 70, override);
  }, [profile, currentWeight, learnedTdee]);

  const isSelectedToday = startOfLocalDay(selectedDay).getTime() === startOfLocalDay(new Date()).getTime();

  const total = useMemo(() => entries.reduce((sum, e) => addNutrition(sum, e.nutrition), {} as NutritionData), [entries]);

  const requestScan = useCallback((onEan: (ean: string) => void) => setScanHandler(() => onEan), []);

  // ----- data loads -----
  const refreshWeight = useCallback(async () => {
    setWeightLogs(await tracker.getWeightLogs());
  }, []);

  const refreshDiary = useCallback(async (day: Date) => {
    setEntries(await tracker.getDiary(startOfLocalDay(day).toISOString(), endOfLocalDay(day).toISOString()));
  }, []);

  const refreshPlans = useCallback(async (day: Date) => {
    setPlans(await tracker.getActivePlans(endOfLocalDay(day).toISOString()));
  }, []);

  const refreshLearnedTdee = useCallback(async (logs: WeightLog[]) => {
    const now = Date.now();
    const from = new Date(now - 28 * 86400000).toISOString();
    const to = new Date(now).toISOString();
    const windowEntries = await tracker.getDiary(from, to);
    const byDay = new Map<number, number>();
    for (const e of windowEntries) {
      const kcal = Number(e.nutrition?.calories);
      if (!Number.isFinite(kcal)) continue;
      const key = startOfLocalDay(new Date(e.eatenAt)).getTime();
      byDay.set(key, (byDay.get(key) || 0) + kcal);
    }
    setLearnedTdee(estimateLearnedTdee({ dailyIntakeKcal: [...byDay.values()], weightLogs: logs, windowDays: 28, now }));
  }, []);

  // initial load + profile from server
  useEffect(() => {
    let active = true;
    (async () => {
      const p = await tracker.fetchProfile();
      if (!active) return;
      setProfile(p);
      const logs = await tracker.getWeightLogs();
      if (!active) return;
      setWeightLogs(logs);
      await Promise.all([refreshDiary(selectedDay), refreshPlans(selectedDay)]);
      await refreshLearnedTdee(logs);
    })().catch(() => undefined);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // rows synced in from another device (same alias) → reload the visible day
  useEffect(
    () =>
      onSyncDataChanged(() => {
        refreshWeight().catch(() => undefined);
        refreshDiary(selectedDay).catch(() => undefined);
        refreshPlans(selectedDay).catch(() => undefined);
      }),
    [selectedDay, refreshWeight, refreshDiary, refreshPlans]
  );

  // recompute learned TDEE whenever weight changes
  useEffect(() => {
    refreshLearnedTdee(weightLogs).catch(() => undefined);
  }, [weightLogs, refreshLearnedTdee]);

  // suggestions for today
  useEffect(() => {
    (async () => {
      const remainingKcal = Math.round(goal.targetKcal - Number(total.calories || 0));
      const remainingProtein = Math.round(goal.targetProteinG - Number(total.protein || 0));
      if (!isSelectedToday || !(goal.targetKcal > 0) || remainingKcal < 200) {
        setSuggestions([]);
        return;
      }
      setSuggestions(await tracker.getSuggestions(remainingKcal, remainingProtein > 0 ? remainingProtein : undefined, 4));
    })().catch(() => setSuggestions([]));
  }, [goal, total, isSelectedToday]);

  const changeDay = useCallback(
    (day: Date) => {
      const today = startOfLocalDay(new Date());
      const clamped = day.getTime() > today.getTime() ? today : startOfLocalDay(day);
      setSelectedDay(clamped);
      Promise.all([refreshDiary(clamped), refreshPlans(clamped)]).catch(() => undefined);
    },
    [refreshDiary, refreshPlans]
  );

  const remainingKcal = Math.round(goal.targetKcal - Number(total.calories || 0));
  const remainingProtein = Math.round(goal.targetProteinG - Number(total.protein || 0));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Kalorien- &amp; Nährwerttracker</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Angemeldet als <strong className="text-orange-500">{alias}</strong>
          </p>
        </div>
        <div className="max-w-md text-xs text-yellow-700 dark:text-yellow-300">
          <strong>Datenschutz:</strong> Alle Tracker-Daten (Gewicht, Ziel, Tagebuch) hängen am Alias und sind{' '}
          <em>nicht passwortgeschützt</em>. Wer den Alias kennt, sieht auch diese Daten.
        </div>
      </div>

      {/* Day summary + food log */}
      <DaySection
        selectedDay={selectedDay}
        isSelectedToday={isSelectedToday}
        onChangeDay={changeDay}
        onPrev={() => {
          const d = startOfLocalDay(selectedDay);
          d.setDate(d.getDate() - 1);
          changeDay(d);
        }}
        onNext={() => {
          if (isSelectedToday) return;
          const d = startOfLocalDay(selectedDay);
          d.setDate(d.getDate() + 1);
          changeDay(d);
        }}
        onToday={() => changeDay(new Date())}
        goal={goal}
        total={total}
        entries={entries}
        dark={dark}
        suggestions={suggestions}
        remainingKcal={remainingKcal}
        remainingProtein={remainingProtein}
        onDeleteEntry={async (id) => {
          if (!confirm('Eintrag aus dem Tagebuch löschen?')) return;
          await tracker.deleteDiaryEntry(id);
          await Promise.all([refreshDiary(selectedDay), refreshPlans(selectedDay)]);
        }}
        onCompositionChanged={() => refreshDiary(selectedDay)}
        requestScan={requestScan}
      />

      {/* Meal-prep batches */}
      <MealPrepSection
        plans={plans}
        selectedDay={selectedDay}
        onMarkEaten={async (plan, eatenCount) => {
          const live = await tracker.getLiveNutrition(plan.recipeId, plan.productAssignments || {});
          const perServing = live?.nutrition?.perServing || {};
          const snapshot = scaleNutrition(perServing, eatenCount);
          const perServingPrice = live?.price?.hasAnyData ? Number(live.price.perServing) : NaN;
          const costSnapshot = Number.isFinite(perServingPrice) ? perServingPrice * eatenCount : undefined;
          const eatenAt = isSelectedToday ? new Date() : (() => { const d = startOfLocalDay(selectedDay); d.setHours(12, 0, 0, 0); return d; })();
          await tracker.addDiaryEntry({
            source: 'plan',
            planId: plan.id,
            recipeId: plan.recipeId,
            servings: eatenCount,
            nutrition: snapshot,
            eatenAt: eatenAt.toISOString(),
            costSnapshot,
          });
          await Promise.all([refreshPlans(selectedDay), refreshDiary(selectedDay)]);
        }}
      />

      {/* Free entry */}
      <FreeEntrySection
        selectedDay={selectedDay}
        isSelectedToday={isSelectedToday}
        requestScan={requestScan}
        onAdded={(eatenAtIso) => {
          const eaten = startOfLocalDay(new Date(eatenAtIso));
          const today = startOfLocalDay(new Date());
          const day = eaten.getTime() > today.getTime() ? today : eaten;
          setSelectedDay(day);
          refreshDiary(day).catch(() => undefined);
        }}
      />

      {/* Weight */}
      <WeightSection
        weightLogs={weightLogs}
        profile={profile}
        dark={dark}
        onAdd={async (weightKg, day) => {
          await tracker.addWeightLog(weightKg, new Date(`${day}T12:00:00`).toISOString());
          await refreshWeight();
        }}
        onDelete={async (id) => {
          if (!confirm('Gewichtseintrag löschen?')) return;
          await tracker.deleteWeightLog(id);
          await refreshWeight();
        }}
      />

      {/* Body profile & goal */}
      <ProfileSection
        profile={profile}
        goal={goal}
        learnedTdee={learnedTdee}
        onSave={async (p) => {
          setProfile(p);
          await tracker.saveProfile(p);
        }}
      />

      {scanHandler && (
        <BarcodeScanner
          onDetected={(ean) => {
            const h = scanHandler;
            setScanHandler(null);
            h(ean.trim());
          }}
          onClose={() => setScanHandler(null)}
        />
      )}
    </div>
  );
}

// ========================================================= Day section ===
function DaySection(props: {
  selectedDay: Date;
  isSelectedToday: boolean;
  onChangeDay: (d: Date) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  goal: CalorieGoal;
  total: NutritionData;
  entries: DiaryEntry[];
  dark: boolean;
  suggestions: RecipeSuggestion[];
  remainingKcal: number;
  remainingProtein: number;
  onDeleteEntry: (id: string) => void;
  onCompositionChanged: () => void;
  requestScan: (onEan: (ean: string) => void) => void;
}) {
  const { selectedDay, isSelectedToday, goal, total, entries, dark } = props;
  const dateLabel = selectedDay.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

  const costEntries = entries.filter((e) => Number.isFinite(Number(e.costSnapshot)) && Number(e.costSnapshot) > 0);
  const dayCost = costEntries.reduce((s, e) => s + Number(e.costSnapshot), 0);

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{isSelectedToday ? `Heute · ${dateLabel}` : dateLabel}</h2>
        <div className="flex items-center gap-1">
          <button type="button" onClick={props.onPrev} className="h-8 w-8 rounded border border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700" title="Vorheriger Tag">‹</button>
          <input
            type="date"
            value={toDateInputValue(selectedDay)}
            max={toDateInputValue(new Date())}
            onChange={(e) => props.onChangeDay(e.target.value ? new Date(`${e.target.value}T00:00:00`) : new Date())}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900"
          />
          <button type="button" onClick={props.onNext} disabled={isSelectedToday} className="h-8 w-8 rounded border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700" title="Nächster Tag">›</button>
          {!isSelectedToday && (
            <button type="button" onClick={props.onToday} className="rounded border border-orange-400 px-2 py-1 text-xs text-orange-600 hover:bg-orange-50 dark:text-orange-300 dark:hover:bg-orange-900/20">Heute</button>
          )}
        </div>
      </div>

      <DayRings goal={goal} total={total} dark={dark} dayCost={dayCost} costCount={costEntries.length} totalCount={entries.length} />

      <h3 className="mb-2 mt-4 text-sm font-medium text-gray-800 dark:text-gray-200">Gegessen an diesem Tag</h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-gray-500">
          Noch keine Einträge — streiche Meal-Prep-Portionen ab oder trage ein Produkt / etwas Freies ein.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 text-sm dark:divide-gray-700">
          {entries.map((entry) => (
            <DiaryRow key={entry.id} entry={entry} onDelete={() => props.onDeleteEntry(entry.id)} onCompositionChanged={props.onCompositionChanged} requestScan={props.requestScan} />
          ))}
        </ul>
      )}

      {props.suggestions.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-medium text-gray-800 dark:text-gray-200">
            Passt in dein Restbudget (noch ~{props.remainingKcal} kcal{props.remainingProtein > 0 ? `, ${props.remainingProtein} g Eiweiß` : ''})
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {props.suggestions.map((s) => (
              <Link key={s.id} to={`/rezept/${s.id}`} className="flex items-center gap-2 rounded border border-gray-200 p-2 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/40">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-gray-100 dark:bg-gray-700">
                  {s.imageUrl ? <img src={s.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span>🍽️</span>}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-gray-900 dark:text-white">{s.title}</div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">{s.estimated ? '~' : ''}{s.kcal} kcal · {s.protein} g Eiweiß / Portion</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function DayRings({ goal, total, dark, dayCost, costCount, totalCount }: { goal: CalorieGoal; total: NutritionData; dark: boolean; dayCost: number; costCount: number; totalCount: number }) {
  const kcal = Number(total.calories || 0);
  const overTarget = goal.targetKcal > 0 && kcal > goal.targetKcal + 1;
  const showMaintain = overTarget && goal.tdee > 0 && Math.abs(goal.tdee - goal.targetKcal) > 15;
  const kcalColor = ringColor(kcal, goal.targetKcal, '#ef4444', '#f97316');
  const macroFields = [
    { key: 'protein', label: 'Eiweiß', target: goal.targetProteinG, unit: ' g', ok: '#0ea5e9' },
    { key: 'carbohydrates', label: 'Kohlenhydrate', target: goal.targetCarbsG, unit: ' g', ok: '#eab308' },
    { key: 'fat', label: 'Fett', target: goal.targetFatG, unit: ' g', ok: '#f43f5e' },
  ] as const;
  const per100 = kcal > 0 ? (dayCost / kcal) * 100 : null;
  const partial = costCount < totalCount;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="text-center">
        <Html
          html={donutSvg({
            size: 196,
            consumed: kcal,
            target: goal.targetKcal,
            label: 'Kalorien',
            unit: ' kcal',
            color: kcalColor,
            overlay: { value: goal.tdee, color: '#6366f1', label: 'Erhalt' },
            showOverlay: showMaintain,
            dark,
          })}
        />
        <div className="-mt-1 text-sm font-medium text-gray-800 dark:text-gray-100">Kalorien</div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400">
          Ziel {goal.targetKcal} kcal
          {goal.tdee > 0 ? ` · Erhalt ${goal.tdee} kcal` : ''}
          {goal.minKcal > 0 ? ` · Min. ${goal.minKcal} kcal` : ''}
        </div>
        {showMaintain && <div className="mt-0.5 text-[11px] text-indigo-500">Ziel überschritten — äußerer Ring: Erhaltungsbedarf</div>}
      </div>

      <div className="grid w-full max-w-md grid-cols-3 gap-2">
        {macroFields.map((f) => {
          const consumed = Number((total as any)[f.key] || 0);
          return (
            <div key={f.key} className="text-center">
              <Html
                html={donutSvg({ size: 112, consumed, target: f.target, label: f.label, unit: f.unit, color: ringColor(consumed, f.target, '#ef4444', f.ok), showOverlay: false, dark })}
              />
              <div className="-mt-1 text-xs font-medium text-gray-800 dark:text-gray-100">{f.label}</div>
            </div>
          );
        })}
      </div>

      {dayCost > 0 && (
        <p className="max-w-md text-center text-xs text-gray-600 dark:text-gray-300">
          Kosten heute: <strong>~{formatEuro(dayCost)}</strong>
          {per100 != null ? ` · ${formatEuro(per100)} / 100 kcal` : ''}
          {partial ? <span className="text-gray-400"> ({costCount}/{totalCount} Einträge mit Preis)</span> : ''}
        </p>
      )}

      {(goal.lowEnergyWarning || goal.clampedToBmr) && (
        <p className="max-w-md text-center text-[11px] text-amber-700 dark:text-amber-300">
          {goal.clampedToBmr
            ? `Ziel liegt am geschätzten Grundumsatz (${goal.minKcal} kcal). Darunter nur mit ärztlicher Begleitung.`
            : `Kalorienziel unter ${goal.warningLowKcal} kcal — als Warnschwelle, nicht als individuelle Empfehlung.`}
        </p>
      )}
    </div>
  );
}

function diaryEntryTitle(entry: DiaryEntry): string {
  if (entry.source === 'product') return entry.productName || entry.label || 'Produkt';
  if (entry.source === 'free') return entry.label || 'Freier Eintrag';
  return entry.recipeTitle || entry.label || 'Rezept';
}
function diarySourceLabel(source: DiaryEntry['source']): string {
  if (source === 'plan') return 'Meal Prep';
  if (source === 'product') return 'Produkt';
  if (source === 'free') return 'Frei';
  return 'Rezept';
}
function diaryAmountLabel(entry: DiaryEntry): string {
  if (entry.servings != null && Number.isFinite(Number(entry.servings))) {
    return `${formatPortions(Number(entry.servings))} Portion${Number(entry.servings) === 1 ? '' : 'en'}`;
  }
  if (entry.grams != null && Number.isFinite(Number(entry.grams))) return `${Math.round(Number(entry.grams))} g`;
  return '';
}

function DiaryRow({ entry, onDelete, onCompositionChanged, requestScan }: { entry: DiaryEntry; onDelete: () => void; onCompositionChanged: () => void; requestScan: (onEan: (ean: string) => void) => void }) {
  const expandable = entry.source === 'plan';
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<DiaryEntryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<CompositionModalState | null>(null);

  const when = new Date(entry.eatenAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', hour12: false });
  const title = diaryEntryTitle(entry);
  const amount = diaryAmountLabel(entry);
  const macros = formatMacroLine(entry.nutrition);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    const d = await tracker.getDiaryEntry(entry.id);
    setDetail(d);
    setLoading(false);
  }, [entry.id]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !detail) loadDetail();
  };

  const afterChange = (updated: DiaryEntryDetail) => {
    setDetail(updated);
    setOpen(true);
    onCompositionChanged();
  };

  return (
    <li className="py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="w-10 flex-shrink-0 text-xs tabular-nums text-gray-500">{when}</span>
            {entry.recipeId ? (
              <Link to={`/rezept/${entry.recipeId}`} className="truncate font-medium text-gray-900 hover:underline dark:text-white">{title}</Link>
            ) : (
              <span className="truncate font-medium text-gray-900 dark:text-white">{title}</span>
            )}
            <span className="flex-shrink-0 text-[10px] uppercase tracking-wide text-gray-400">{diarySourceLabel(entry.source)}</span>
            {expandable && (
              <button type="button" onClick={toggle} className="inline-flex flex-shrink-0 items-center gap-0.5 text-[10px] uppercase tracking-wide text-orange-600 dark:text-orange-400" title="Zutaten anzeigen">
                Zutaten <span className={`inline-block text-[9px] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true">▼</span>
              </button>
            )}
          </div>
          <div className="ml-12 text-xs text-gray-500">{[amount, macros].filter(Boolean).join(' · ') || 'ohne Nährwerte'}</div>
          {expandable && open && (
            <div className="ml-0 mt-2 sm:ml-12">
              {loading && <p className="text-xs text-gray-500">Zutaten werden geladen …</p>}
              {!loading && detail && (
                <PlanDetails
                  entryId={entry.id}
                  composition={detail.composition || { components: [] }}
                  reconstructed={detail.compositionReconstructed}
                  onSwap={(c) => setModal({ mode: 'swap', entryId: entry.id, componentId: c.id, currentGrams: c.grams, catalogueIngredientId: c.catalogueIngredientId, slotName: c.name })}
                  onAdd={() => setModal({ mode: 'add', entryId: entry.id })}
                  onRemove={async (componentId) => {
                    if (!confirm('Extra-Produkt von diesem Eintrag entfernen?')) return;
                    const updated = await tracker.updateComposition({ id: entry.id, action: 'remove', componentId });
                    afterChange(updated);
                  }}
                />
              )}
            </div>
          )}
        </div>
        <button type="button" onClick={onDelete} className="flex-shrink-0 text-xs text-red-500" title="Eintrag löschen">×</button>
      </div>

      {modal && (
        <CompositionModal
          state={modal}
          requestScan={requestScan}
          onClose={() => setModal(null)}
          onApplied={(updated) => {
            setModal(null);
            afterChange(updated);
          }}
        />
      )}
    </li>
  );
}

function componentProductLabel(component: DiaryComponent): string {
  if (component.productBrand && component.productName) return `${component.productBrand} – ${component.productName}`;
  return component.productName || '';
}

function PlanDetails({ composition, reconstructed, onSwap, onAdd, onRemove }: { entryId: string; composition: DiaryComposition; reconstructed?: boolean; onSwap: (c: DiaryComponent) => void; onAdd: () => void; onRemove: (componentId: string) => void }) {
  if (!composition.components.length) {
    return (
      <div>
        <p className="text-xs text-gray-500">Keine Zutaten hinterlegt.</p>
        <button type="button" onClick={onAdd} className="mt-1 rounded border border-orange-400 px-2 py-1 text-xs text-orange-600 hover:bg-orange-50 dark:text-orange-300 dark:hover:bg-orange-900/20">+ Produkt hinzufügen</button>
      </div>
    );
  }
  return (
    <div>
      {reconstructed && <p className="mb-1 text-[11px] text-gray-400">Aus dem Rezept rekonstruiert — Änderungen gelten nur für diesen Eintrag.</p>}
      <div className="space-y-1">
        {composition.components.map((c) => {
          const product = componentProductLabel(c);
          const grams = Number.isFinite(c.grams) ? `${Math.round(c.grams * 10) / 10} g` : '';
          const macros = formatMacroLine(c.nutrition);
          return (
            <div key={c.id} className="flex flex-col gap-1.5 rounded bg-gray-50 px-2 py-1.5 dark:bg-gray-900/40 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-xs font-medium text-gray-900 dark:text-white">{c.name}</span>
                  {c.kind === 'extra' && <span className="text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400">extra</span>}
                </div>
                <div className="text-[11px] text-gray-500">{[product, grams].filter(Boolean).join(' · ')}</div>
                <div className="text-[11px] text-gray-500">{macros || 'ohne Nährwerte'}{c.isEstimated ? ' · ~' : ''}</div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                <button type="button" onClick={() => onSwap(c)} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">Tauschen</button>
                {c.kind === 'extra' && (
                  <button type="button" onClick={() => onRemove(c.id)} className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20">Entfernen</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={onAdd} className="mt-2 rounded border border-orange-400 px-2 py-1 text-xs text-orange-600 hover:bg-orange-50 dark:text-orange-300 dark:hover:bg-orange-900/20">+ Produkt / Zutat hinzufügen</button>
    </div>
  );
}

// ===================================================== Composition modal ===
interface CompositionModalState {
  mode: 'swap' | 'add';
  entryId: string;
  componentId?: string;
  currentGrams?: number;
  catalogueIngredientId?: string;
  slotName?: string;
}

function CompositionModal({ state, requestScan, onClose, onApplied }: { state: CompositionModalState; requestScan: (onEan: (ean: string) => void) => void; onClose: () => void; onApplied: (updated: DiaryEntryDetail) => void }) {
  const [picked, setPicked] = useState<Pick | null>(null);
  const [grams, setGrams] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const apply = async () => {
    if (!picked || grams == null || grams <= 0) {
      setError('Bitte eine Auswahl und eine Menge größer 0 angeben.');
      return;
    }
    setBusy(true);
    setError('');
    const body: Record<string, unknown> = { id: state.entryId, action: state.mode, grams };
    if (state.mode === 'swap') body.componentId = state.componentId;
    if (picked.pickKind === 'ingredient') body.catalogueIngredientId = picked.id;
    else if (picked.id) body.productId = picked.id;
    else
      body.product = {
        ean: picked.ean ?? null,
        name: picked.name,
        brand: picked.brand ?? null,
        netGrams: picked.netGrams ?? null,
        packageLabel: picked.packageLabel ?? null,
        imageUrl: picked.imageUrl ?? null,
        source: picked.source === 'openfoodfacts' ? 'openfoodfacts' : 'manual',
        offCode: picked.offCode ?? null,
        nutritionPer100g: picked.nutritionPer100g ?? null,
        gramsByUnit: picked.gramsByUnit ?? null,
      };
    try {
      const updated = await tracker.updateComposition(body);
      onApplied(updated);
    } catch (e) {
      setError((e as Error).message || 'Änderung konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-xl border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-800 sm:max-w-lg sm:rounded-xl">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{state.mode === 'swap' ? 'Zutat / Produkt tauschen' : 'Produkt hinzufügen'}</h3>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {state.mode === 'swap'
                ? `${state.slotName || 'Zutat'}${state.currentGrams ? ` · aktuell ${Math.round(state.currentGrams * 10) / 10} g` : ''}`
                : 'Menge nach der Auswahl angeben — z. B. ein Spiegelei extra.'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="px-1 text-xl leading-none text-gray-500 hover:text-gray-800 dark:hover:text-white" aria-label="Schließen">×</button>
        </div>

        <ProductSearchBox
          includeIngredients
          catalogueIngredientId={state.catalogueIngredientId}
          initialGrams={state.mode === 'swap' ? state.currentGrams : undefined}
          requestScan={requestScan}
          onChange={(p, g) => {
            setPicked(p);
            setGrams(g);
          }}
        />

        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">Abbrechen</button>
          <button type="button" onClick={apply} disabled={!picked || grams == null || busy} className="rounded bg-orange-500 px-3 py-1.5 text-sm text-white hover:bg-orange-600 disabled:opacity-40">
            {state.mode === 'swap' ? 'Tauschen' : 'Hinzufügen'}
          </button>
        </div>
      </div>
    </div>
  );
}

// =================================================== Reusable product box ===
/**
 * Search local register (+ optionally catalogue ingredients) and Open Food
 * Facts, pick one, choose an amount/unit; reports {pick, grams, scaled} up via
 * onChange. Mirrors the website's td-* / tcm-* product search flows.
 */
function ProductSearchBox({
  includeIngredients = false,
  catalogueIngredientId,
  initialGrams,
  requestScan,
  onChange,
}: {
  includeIngredients?: boolean;
  catalogueIngredientId?: string;
  initialGrams?: number;
  requestScan: (onEan: (ean: string) => void) => void;
  onChange: (pick: Pick | null, grams: number | undefined, scaled: NutritionData) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Pick[]>([]);
  const [status, setStatus] = useState('');
  const [picked, setPicked] = useState<Pick | null>(null);
  const [unitOptions, setUnitOptions] = useState<UnitOption[]>([]);
  const [unit, setUnit] = useState('g');
  const [amount, setAmount] = useState('100');
  const [moreVisible, setMoreVisible] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);

  const offState = useRef({ query: '', page: 0, hasMore: false });
  const localTimer = useRef<number | undefined>(undefined);
  // Latest search wins: a slower register search must not wipe online results.
  const searchSeq = useRef(0);

  const emit = useCallback(
    (p: Pick | null, amt: string, u: string) => {
      if (!p) {
        onChange(null, undefined, {});
        return;
      }
      const grams = resolveGrams(p, amt, u);
      const scaled = grams != null ? scaleNutrition(p.nutritionPer100g || {}, grams / 100) : {};
      onChange(p, grams, scaled);
    },
    [onChange]
  );

  const select = useCallback(
    (p: Pick) => {
      setPicked(p);
      setResults([]);
      setMoreVisible(false);
      const { options, defaultValue, defaultAmount } = buildUnitOptions(p);
      setUnitOptions(options);
      if (initialGrams != null && initialGrams > 0) {
        setUnit('g');
        setAmount(String(Math.round(initialGrams * 10) / 10));
        emit(p, String(Math.round(initialGrams * 10) / 10), 'g');
      } else {
        setUnit(defaultValue);
        setAmount(defaultAmount);
        emit(p, defaultAmount, defaultValue);
      }
      setStatus(p.pickKind === 'ingredient' ? 'Zutat übernommen.' : p.source === 'local' ? 'Produkt aus dem Register übernommen.' : 'Open-Food-Facts-Produkt übernommen.');
    },
    [emit, initialGrams]
  );

  // preload linked products for a swap slot
  useEffect(() => {
    if (!catalogueIngredientId) return;
    (async () => {
      const products = await tracker.linkedProducts(catalogueIngredientId);
      if (products.length) {
        setResults(products.map((p) => ({ ...asLocalPick(p), pickKind: 'product' as const })));
        setStatus('Verknüpfte Produkte — oder unten suchen.');
      }
    })().catch(() => undefined);
  }, [catalogueIngredientId]);

  const searchLocal = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) {
        setResults([]);
        setMoreVisible(false);
        setStatus('');
        if (catalogueIngredientId) {
          const products = await tracker.linkedProducts(catalogueIngredientId);
          if (products.length) setResults(products.map((p) => ({ ...asLocalPick(p), pickKind: 'product' as const })));
        }
        return;
      }
      setStatus('Register …');
      const seq = ++searchSeq.current;
      const [products, ingredients] = await Promise.all([
        tracker.searchRegisterProducts(trimmed, includeIngredients ? 8 : 12),
        includeIngredients ? tracker.searchCatalogue(trimmed, 8) : Promise.resolve([]),
      ]);
      const picks: Pick[] = [];
      for (const raw of ingredients) picks.push({ pickKind: 'ingredient', id: raw.id, name: raw.name, nutritionPer100g: raw.nutritionPer100g, gramsByUnit: raw.gramsByUnit });
      for (const raw of products) picks.push({ ...asLocalPick(raw), pickKind: 'product' });
      if (seq !== searchSeq.current) return;
      setResults(picks);
      setMoreVisible(false);
      if (!picks.length) setStatus('Keine Treffer im Register — „Online suchen“ für Open Food Facts.');
      else setStatus(`${ingredients.length ? `${ingredients.length} Zutaten` : ''}${ingredients.length && products.length ? ' · ' : ''}${products.length ? `${products.length} Produkte` : ''}`.trim());
    },
    [catalogueIngredientId, includeIngredients]
  );

  const onQueryInput = (v: string) => {
    setQuery(v);
    window.clearTimeout(localTimer.current);
    localTimer.current = window.setTimeout(() => searchLocal(v), 250) as unknown as number;
  };

  const lookupEan = useCallback(
    async (ean: string) => {
      setStatus(`Barcode ${ean}: Produkt wird geholt …`);
      setMoreVisible(false);
      try {
        const data = await lookupProductByEan(ean);
        if (data.source === 'local' && data.product) {
          select({ ...asLocalPick(data.product), pickKind: 'product' });
          return;
        }
        if (data.source === 'openfoodfacts' && data.product) {
          select({ ...asOffPick(data.product), pickKind: 'product' });
          return;
        }
        setStatus(`Kein Produkt zu EAN ${ean} gefunden.`);
      } catch (err) {
        setStatus(`Barcode-Lookup fehlgeschlagen: ${(err as Error).message}`);
      }
    },
    [select]
  );

  const searchOff = useCallback(
    async (append: boolean) => {
      const q = query.trim();
      if (!q) return;
      window.clearTimeout(localTimer.current);
      const seq = ++searchSeq.current;
      if (/^\d{6,14}$/.test(q)) {
        await lookupEan(q);
        return;
      }
      if (!append) {
        offState.current = { query: q, page: 0, hasMore: false };
        setResults([]);
      } else if (q !== offState.current.query) {
        return searchOff(false);
      }
      const nextPage = append ? offState.current.page + 1 : 1;
      setStatus(append ? 'Weitere Ergebnisse werden geladen …' : 'Open Food Facts …');
      setMoreLoading(true);
      try {
        const data = await offSearch(q, nextPage, 20);
        if (seq !== searchSeq.current) return;
        if (data?.error && !(data.results?.length || data.local?.length)) {
          setStatus(`Online-Suche fehlgeschlagen: ${data.error}`);
          setMoreVisible(false);
          return;
        }
        const localHits = append ? [] : Array.isArray(data.local) ? data.local : [];
        const remoteHits = Array.isArray(data.results) ? data.results : [];
        setResults((prev) => {
          const base = append ? prev : [];
          const next: Pick[] = [...base];
          for (const raw of localHits) next.push({ ...asLocalPick(raw), pickKind: 'product' });
          for (const raw of remoteHits) next.push({ ...asOffPick(raw), pickKind: 'product' });
          return next;
        });
        offState.current.page = Number(data.page) || nextPage;
        offState.current.hasMore = Boolean(data.hasMore) && remoteHits.length > 0;
        setMoreVisible(offState.current.hasMore);
        setStatus(`${localHits.length ? `${localHits.length} lokal` : ''}${localHits.length && remoteHits.length ? ' · ' : ''}${remoteHits.length ? `${remoteHits.length} Open Food Facts` : ''}${offState.current.hasMore ? ' …' : ''}`.trim() || 'Keine Treffer.');
      } catch {
        setStatus('Online-Suche fehlgeschlagen.');
      } finally {
        setMoreLoading(false);
      }
    },
    [query, lookupEan]
  );

  const clearPick = () => {
    setPicked(null);
    setStatus('');
    onChange(null, undefined, {});
  };

  const changeAmount = (v: string) => {
    setAmount(v);
    if (picked) emit(picked, v, unit);
  };
  const changeUnit = (u: string) => {
    let amt = amount;
    if (u === 'g' && (amount === '1' || amount === '')) amt = '100';
    if ((u === 'pack' || u === 'serving' || u.startsWith('u:')) && (amount === '100' || amount === '')) amt = '1';
    setUnit(u);
    setAmount(amt);
    if (picked) emit(picked, amt, u);
  };

  const grams = picked ? resolveGrams(picked, amount, unit) : undefined;
  const scaledKcal = picked && grams != null ? scaleNutrition(picked.nutritionPer100g || {}, grams / 100).calories : undefined;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              searchOff(false);
            }
          }}
          placeholder="Name, Marke oder EAN …"
          className="min-w-[12rem] flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900"
        />
        <button type="button" onClick={() => searchOff(false)} className="rounded bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600">Online suchen</button>
        <button type="button" onClick={() => requestScan((ean) => { setQuery(ean); lookupEan(ean); })} className="rounded bg-orange-500 px-3 py-1 text-sm text-white hover:bg-orange-600">Barcode scannen</button>
      </div>
      {status && <p className="mt-1 text-[11px] text-gray-500">{status}</p>}

      {results.length > 0 && (
        <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
          {results.map((p, i) => (
            <ResultRow key={i} pick={p} onPick={() => select(p)} />
          ))}
        </div>
      )}
      {moreVisible && (
        <button type="button" disabled={moreLoading} onClick={() => searchOff(true)} className="mt-2 w-full rounded border border-blue-300 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/30">
          {moreLoading ? 'Weitere Ergebnisse werden geladen …' : 'Weitere Ergebnisse laden'}
        </button>
      )}

      {picked && (
        <div className="mt-2 rounded border border-emerald-300 bg-emerald-50/60 p-2 dark:border-emerald-800 dark:bg-emerald-900/20">
          <div className="flex items-start gap-2">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-white dark:bg-gray-800">
              {picked.pickKind === 'product' && picked.imageUrl ? <img src={picked.imageUrl} alt="" className="h-full w-full object-cover" /> : <span className="text-lg">{picked.pickKind === 'ingredient' ? '🥗' : '🥫'}</span>}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900 dark:text-white">{pickLabel(picked)}</div>
              <div className="mt-0.5 text-[11px] text-gray-600 dark:text-gray-300">{picked.pickKind === 'product' ? productMetaLine(picked) || (picked.source === 'local' ? 'lokales Produkt' : 'Open Food Facts') : 'Zutat aus dem Register'}</div>
            </div>
            <button type="button" onClick={clearPick} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">Entfernen</button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <label className="block">Menge
              <input type="number" step="0.1" min="0" value={amount} onChange={(e) => changeAmount(e.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-900" />
            </label>
            <label className="block">Einheit
              <select value={unit} onChange={(e) => changeUnit(e.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-900">
                {unitOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <p className="self-end pb-1 text-xs text-gray-600 dark:text-gray-300">
              {grams == null ? 'Menge angeben' : `≈ ${scaledKcal != null ? `${Math.round(scaledKcal)} kcal` : 'ohne kcal'} für ${Math.round(grams * 10) / 10} g`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultRow({ pick, onPick }: { pick: Pick; onPick: () => void }) {
  if (pick.pickKind === 'ingredient') {
    const kcal = pick.nutritionPer100g?.calories;
    const meta = kcal != null ? `${Math.round(kcal)} kcal / 100 g` : 'ohne Nährwerte / 100 g';
    return (
      <div className="flex flex-col gap-2 rounded border border-gray-200 p-2 dark:border-gray-700">
        <div className="flex min-w-0 items-start gap-2">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-gray-100 dark:bg-gray-700"><span className="text-lg">🥗</span></div>
          <div className="min-w-0 flex-1">
            <div className="break-words text-sm font-medium text-gray-900 dark:text-white">{pick.name}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-gray-500">
              <span className="shrink-0 font-semibold uppercase text-amber-600 dark:text-amber-400">Zutat</span>
              <span>{meta}</span>
            </div>
          </div>
        </div>
        <button type="button" onClick={onPick} className="w-full rounded bg-emerald-500 px-2 py-1.5 text-xs text-white hover:bg-emerald-600">Übernehmen</button>
      </div>
    );
  }
  const origin = pick.source === 'local' ? 'lokal' : 'OFF';
  const originClass = pick.source === 'local' ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400';
  const meta = productMetaLine(pick);
  return (
    <div className="flex flex-col gap-2 rounded border border-gray-200 p-2 dark:border-gray-700">
      <div className="flex min-w-0 items-start gap-2">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-gray-100 dark:bg-gray-700">
          {pick.imageUrl ? <img src={pick.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span className="text-lg">🥫</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="break-words text-sm font-medium text-gray-900 dark:text-white">{pick.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-gray-500">
            <span className={`shrink-0 font-semibold uppercase ${originClass}`}>{origin}</span>
            {meta && <span className="min-w-0 break-words">{meta}</span>}
            {pick.ean && <span className="font-mono text-gray-400">EAN {pick.ean}</span>}
          </div>
        </div>
      </div>
      <button type="button" onClick={onPick} className="w-full rounded bg-emerald-500 px-2 py-1.5 text-xs text-white hover:bg-emerald-600">Übernehmen</button>
    </div>
  );
}

// ================================================= Meal-prep section ===
function MealPrepSection({ plans, onMarkEaten }: { plans: MealPlan[]; selectedDay: Date; onMarkEaten: (plan: MealPlan, eatenCount: number) => Promise<void> }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Offene Meal-Prep-Portionen</h2>
      </div>
      {plans.length === 0 ? (
        <p className="mt-2 text-xs text-gray-500">Keine offenen Portionen — plane ein Rezept als Meal Prep (Portionen ab einem Datum).</p>
      ) : (
        <div className="space-y-2">
          {plans.map((plan) => (
            <MealPrepRow key={plan.id} plan={plan} onMarkEaten={onMarkEaten} />
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] text-gray-500">
        Erinnerungen funktionieren nur best-effort, solange die App geöffnet oder kürzlich aktiv war. Für zuverlässige Weckzeiten Kalender oder Wecker nutzen.
      </p>
    </section>
  );
}

function MealPrepRow({ plan, onMarkEaten }: { plan: MealPlan; onMarkEaten: (plan: MealPlan, eatenCount: number) => Promise<void> }) {
  const total = Number(plan.servings) || 1;
  const remaining = Number(plan.servingsRemaining ?? plan.servings);
  const consumed = Number(plan.servingsConsumed ?? Math.max(0, total - remaining));
  const pct = total > 0 ? Math.min(100, Math.round((consumed / total) * 100)) : 0;
  const from = new Date(plan.scheduledAt).toLocaleDateString('de-DE');
  const [portions, setPortions] = useState(String(Math.min(1, remaining)));
  const [busy, setBusy] = useState(false);

  const mark = async () => {
    const requested = Number(portions || '1');
    const eatenCount = Math.min(remaining, Math.max(0.5, Number.isFinite(requested) ? requested : 1));
    if (eatenCount <= 0) return;
    setBusy(true);
    try {
      await onMarkEaten(plan, eatenCount);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col justify-between gap-2 rounded border border-gray-200 p-2 dark:border-gray-700 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-gray-900 dark:text-white">
          <Link to={`/rezept/${plan.recipeId}`} className="hover:underline">{plan.recipeTitle || 'Rezept'}</Link>
        </div>
        <div className="text-xs text-gray-500">ab {from} · noch {formatPortions(remaining)} von {formatPortions(total)} Portionen</div>
        <div className="mt-1 h-1.5 w-full max-w-xs overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
          <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1">
        <label className="flex items-center gap-1 text-xs text-gray-500">
          <input type="number" min="0.5" step="0.5" max={remaining} value={portions} onChange={(e) => setPortions(e.target.value)} className="w-14 rounded border border-gray-300 bg-white px-1 py-1 text-sm dark:border-gray-600 dark:bg-gray-900" />
          Portion(en)
        </label>
        <button type="button" onClick={mark} disabled={busy} className="rounded bg-emerald-500 px-2 py-1 text-xs text-white hover:bg-emerald-600 disabled:opacity-50">Abstreichen</button>
      </div>
    </div>
  );
}

// ===================================================== Free entry section ===
function FreeEntrySection({ selectedDay, isSelectedToday, requestScan, onAdded }: { selectedDay: Date; isSelectedToday: boolean; requestScan: (onEan: (ean: string) => void) => void; onAdded: (eatenAtIso: string) => void }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Pick | null>(null);
  const [grams, setGrams] = useState<number | undefined>(undefined);
  const [label, setLabel] = useState('');
  const [kcal, setKcal] = useState('');
  const [carbs, setCarbs] = useState('');
  const [protein, setProtein] = useState('');
  const [fat, setFat] = useState('');
  const [time, setTime] = useState(() => toDateTimeLocalValue(defaultEatenAt()));
  const [busy, setBusy] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  function defaultEatenAt(): Date {
    if (isSelectedToday) return new Date();
    const d = startOfLocalDay(selectedDay);
    d.setHours(12, 0, 0, 0);
    return d;
  }

  useEffect(() => {
    setTime(toDateTimeLocalValue(defaultEatenAt()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay, isSelectedToday]);

  const onPickChange = (p: Pick | null, g: number | undefined, scaled: NutritionData) => {
    setPicked(p);
    setGrams(g);
    if (p) {
      setLabel(pickLabel(p));
      setKcal(scaled.calories != null ? String(Math.round(scaled.calories)) : '');
      setCarbs(scaled.carbohydrates != null ? String(Math.round(scaled.carbohydrates * 10) / 10) : '');
      setProtein(scaled.protein != null ? String(Math.round(scaled.protein * 10) / 10) : '');
      setFat(scaled.fat != null ? String(Math.round(scaled.fat * 10) / 10) : '');
    } else {
      setKcal('');
      setCarbs('');
      setProtein('');
      setFat('');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) return;
    const nutrition: NutritionData = {
      calories: parseNumOr(kcal),
      carbohydrates: parseNumOr(carbs),
      protein: parseNumOr(protein),
      fat: parseNumOr(fat),
    };
    const eatenAt = time ? new Date(time).toISOString() : defaultEatenAt().toISOString();
    const body: Record<string, unknown> = { source: 'free', label: trimmed, eatenAt, nutrition };
    if (picked) {
      if (grams == null || grams <= 0) {
        alert('Bitte eine Menge größer 0 angeben.');
        return;
      }
      const scaled = scaleNutrition(picked.nutritionPer100g || {}, grams / 100);
      let productId: string | undefined;
      if (picked.pickKind === 'product') productId = await tracker.ensureSavedProduct(picked);
      body.source = 'product';
      body.productId = productId;
      body.grams = grams;
      body.nutrition = {
        ...scaled,
        calories: nutrition.calories ?? scaled.calories,
        carbohydrates: nutrition.carbohydrates ?? scaled.carbohydrates,
        protein: nutrition.protein ?? scaled.protein,
        fat: nutrition.fat ?? scaled.fat,
      };
    }
    setBusy(true);
    try {
      await tracker.addDiaryEntry(body);
      setLabel('');
      setKcal('');
      setCarbs('');
      setProtein('');
      setFat('');
      setPicked(null);
      setGrams(undefined);
      setResetKey((k) => k + 1);
      onAdded(eatenAt);
    } catch (err) {
      alert((err as Error).message || 'Eintrag konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 text-left">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Freier Eintrag</h2>
        <span className={`text-sm text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true">▼</span>
      </button>
      {open && (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <div>
            <div className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">Produkt (Register, Barcode oder Open Food Facts)</div>
            <ProductSearchBox key={resetKey} requestScan={requestScan} onChange={onPickChange} />
          </div>

          <p className="text-[11px] text-gray-500">
            Ohne Produkt wie bisher: Bezeichnung und kcal von Hand. Mit Produkt werden die Nährwerte aus 100&nbsp;g und der Menge berechnet — Portionsangaben (z.&nbsp;B. Scheibe) nur, wenn Open Food Facts sie hinterlegt hat.
          </p>

          <div className="grid grid-cols-1 items-end gap-2 text-sm sm:grid-cols-4">
            <label className="block sm:col-span-2">Bezeichnung
              <input value={label} onChange={(e) => setLabel(e.target.value)} required placeholder="z.B. Kaffee mit Milch" className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-900" />
            </label>
            <label className="block">kcal
              <input type="number" step="1" value={kcal} onChange={(e) => setKcal(e.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-900" />
            </label>
            <label className="block">Datum/Zeit
              <input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-900" />
            </label>
            <label className="block">KH (g)
              <input type="number" step="0.1" value={carbs} onChange={(e) => setCarbs(e.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-900" />
            </label>
            <label className="block">Eiweiß (g)
              <input type="number" step="0.1" value={protein} onChange={(e) => setProtein(e.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-900" />
            </label>
            <label className="block">Fett (g)
              <input type="number" step="0.1" value={fat} onChange={(e) => setFat(e.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-900" />
            </label>
            <div className="flex justify-end sm:col-span-1">
              <button type="submit" disabled={busy} className="rounded bg-orange-500 px-3 py-1.5 text-sm text-white hover:bg-orange-600 disabled:opacity-50">Eintragen</button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}

// ===================================================== Profile section ===
function ProfileSection({ profile, goal, learnedTdee, onSave }: { profile: BodyProfile; goal: CalorieGoal; learnedTdee: LearnedTdee | null; onSave: (p: BodyProfile) => Promise<void> }) {
  const [height, setHeight] = useState(profile.heightCm != null ? String(profile.heightCm) : '');
  const [age, setAge] = useState(profile.ageYears != null ? String(profile.ageYears) : '');
  const [gender, setGender] = useState(profile.gender || '');
  const [activity, setActivity] = useState(profile.activity ? String(profile.activity) : '1.55');
  const [weekly, setWeekly] = useState(profile.weeklyChangeKg != null ? String(profile.weeklyChangeKg) : '');
  const [target, setTarget] = useState(profile.targetWeightKg != null ? String(profile.targetWeightKg) : '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setHeight(profile.heightCm != null ? String(profile.heightCm) : '');
    setAge(profile.ageYears != null ? String(profile.ageYears) : '');
    setGender(profile.gender || '');
    setActivity(profile.activity ? String(profile.activity) : '1.55');
    setWeekly(profile.weeklyChangeKg != null ? String(profile.weeklyChangeKg) : '');
    setTarget(profile.targetWeightKg != null ? String(profile.targetWeightKg) : '');
  }, [profile]);

  const tdeeSource = () => {
    if (learnedTdee?.confidence === 'ok') return ' (gelernt)';
    if (learnedTdee?.confidence === 'learning') return ' (Formel – lernt noch)';
    return ' (Formel)';
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: BodyProfile = {
      heightCm: parseNumOr(height),
      ageYears: parseNumOr(age),
      gender: (gender as BodyProfile['gender']) || undefined,
      activity: parseNumOr(activity) || 1.55,
      weeklyChangeKg: parseNumOr(weekly),
      targetWeightKg: parseNumOr(target),
    };
    setBusy(true);
    try {
      await onSave(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Körperprofil &amp; Ziel</h2>
        <span className="text-xs text-gray-600 dark:text-gray-300">
          {goal.targetKcal > 0
            ? `Grundumsatz ~${goal.bmr} · Erhalt ~${goal.tdee} kcal${tdeeSource()} · Ziel ~${goal.targetKcal} kcal · E ${goal.targetProteinG} g · KH ${goal.targetCarbsG} g · F ${goal.targetFatG} g`
            : ''}
        </span>
      </div>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <label className="block">Größe (cm)
          <input type="number" step="0.1" value={height} onChange={(e) => setHeight(e.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-900" />
        </label>
        <label className="block">Alter (Jahre)
          <input type="number" step="1" value={age} onChange={(e) => setAge(e.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-900" />
        </label>
        <label className="block">Geschlecht
          <select value={gender} onChange={(e) => setGender(e.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-900">
            <option value="">–</option>
            <option value="female">weiblich</option>
            <option value="male">männlich</option>
            <option value="other">divers</option>
          </select>
        </label>
        <label className="block">Aktivität
          <select value={activity} onChange={(e) => setActivity(e.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-900">
            <option value="1.2">Sitzend PAL 1.2</option>
            <option value="1.375">Wenig PAL 1.375</option>
            <option value="1.55">Moderat PAL 1.55</option>
            <option value="1.725">Aktiv PAL 1.725</option>
            <option value="1.9">Sehr aktiv PAL 1.9</option>
          </select>
        </label>
        <label className="block">Ziel-Änderung (kg / Woche)
          <input type="number" step="0.05" min="-1" max="0.5" placeholder="z.B. -0.5" value={weekly} onChange={(e) => setWeekly(e.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-900" />
          <span className="text-[11px] text-gray-500">max. −1 kg / +0,5 kg pro Woche</span>
        </label>
        <label className="block">Zielgewicht (kg)
          <input type="number" step="0.1" value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-900" />
        </label>
        <div className="flex justify-end sm:col-span-3">
          <button type="submit" disabled={busy} className="rounded bg-orange-500 px-3 py-1.5 text-sm text-white hover:bg-orange-600 disabled:opacity-50">Profil speichern</button>
        </div>
      </form>
    </section>
  );
}

// ===================================================== Weight section ===
type WeightRange = '7d' | '30d' | '90d' | '365d' | 'all';
const WEIGHT_RANGE_MS: Record<Exclude<WeightRange, 'all'>, number> = {
  '7d': 7 * 86400000,
  '30d': 30 * 86400000,
  '90d': 90 * 86400000,
  '365d': 365 * 86400000,
};
const FORECAST_MS = 30 * 86400000;
const WEEK_MS = 7 * 86400000;
const TREND_WINDOW_MS = 28 * 86400000;
const WEIGHT_RANGE_KEY = 'cookbook.tracker.weightRange';
const WEIGHT_BMI_KEY = 'cookbook.tracker.weightBmi';

function readWeightRange(): WeightRange {
  try {
    const raw = localStorage.getItem(WEIGHT_RANGE_KEY);
    if (raw === '7d' || raw === '30d' || raw === '90d' || raw === '365d' || raw === 'all') return raw;
  } catch {
    /* ignore */
  }
  return '90d';
}
function readShowBmi(): boolean {
  try {
    const raw = localStorage.getItem(WEIGHT_BMI_KEY);
    if (raw === '0') return false;
    if (raw === '1') return true;
  } catch {
    /* ignore */
  }
  return true;
}

function formatSignedKg(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (Object.is(r, -0) || r === 0) return '0 kg';
  return `${r > 0 ? '+' : ''}${r} kg`;
}
function niceYTicks(min: number, max: number, count = 5): number[] {
  const span = Math.max(0.5, max - min);
  const raw = span / Math.max(1, count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.01; v += step) ticks.push(Math.round(v * 10) / 10);
  return ticks;
}
function trendSlopeKgPerMs(logs: WeightLog[], now: number): number {
  const pts = logs
    .map((l) => ({ t: new Date(l.loggedAt).getTime(), kg: Number(l.weightKg) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.kg) && p.t <= now && p.t >= now - TREND_WINDOW_MS)
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return 0;
  const n = pts.length;
  let sumT = 0;
  let sumK = 0;
  for (const p of pts) {
    sumT += p.t;
    sumK += p.kg;
  }
  const meanT = sumT / n;
  const meanK = sumK / n;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    const dt = p.t - meanT;
    num += dt * (p.kg - meanK);
    den += dt * dt;
  }
  if (den === 0) return 0;
  return num / den;
}

function buildWeightChart(weightLogs: WeightLog[], profile: BodyProfile, range: WeightRange, showBmiBands: boolean, dark: boolean): { svg: string; legend: string; forecastNote: { text: string; cls: string } | null } {
  const axis = dark ? '#9ca3af' : '#6b7280';
  const grid = dark ? 'rgba(156,163,175,0.18)' : 'rgba(107,114,128,0.2)';
  const line = '#f97316';
  const text = dark ? '#e5e7eb' : '#374151';

  const heightCm = profile.heightCm && profile.heightCm > 0 ? profile.heightCm : 0;
  const hasHeight = heightCm > 0;
  const bmiOn = showBmiBands && hasHeight;
  const weeklyChange = Number.isFinite(profile.weeklyChangeKg) ? Number(profile.weeklyChangeKg) : null;
  const forecastOn = weeklyChange != null && weightLogs.length > 0;
  const nowMs = Date.now();
  const weightTrend = computeWeightTrend(weightLogs, { now: nowMs, windowDays: 28 });
  const trendReliable = weightTrend.count >= TDEE_MIN_WEIGH_INS && weightTrend.spanDays >= TDEE_MIN_SPAN_DAYS;
  const lastLog = weightLogs[0];
  const lastKg = lastLog ? Number(lastLog.weightKg) : null;

  let forecastNote: { text: string; cls: string } | null = null;
  if (forecastOn && !trendReliable) {
    forecastNote = { text: `Trend-Prognose sammelt noch Daten (${weightTrend.count}/${TDEE_MIN_WEIGH_INS} Wägungen, ${Math.round(weightTrend.spanDays)}/${TDEE_MIN_SPAN_DAYS} Tage).`, cls: 'text-gray-500' };
  }

  // legend
  const legendItems: string[] = [`<span class="inline-flex items-center gap-1"><span class="inline-block w-3 h-0.5 bg-orange-500"></span>Gewicht</span>`];
  if (forecastOn) {
    legendItems.push(`<span class="inline-flex items-center gap-1"><span class="inline-block w-3 h-px border-t border-dashed border-teal-500"></span>Ziel ${formatSignedKg(weeklyChange!)} / Woche</span>`);
    if (trendReliable) legendItems.push(`<span class="inline-flex items-center gap-1"><span class="inline-block w-3 h-px border-t border-dotted border-orange-400"></span>Trend (4 Wochen)</span>`);
  }
  if (profile.targetWeightKg && profile.targetWeightKg > 0) {
    legendItems.push(`<span class="inline-flex items-center gap-1"><span class="inline-block w-3 h-px border-t border-dashed border-indigo-500"></span>Zielgewicht ${profile.targetWeightKg} kg</span>`);
  }
  if (bmiOn) {
    for (const band of BMI_BANDS) {
      const lo = band.from <= 0 ? null : weightForBmi(band.from, heightCm);
      const hi = band.to === Infinity ? null : weightForBmi(band.to, heightCm);
      let rangeLabel: string = band.label;
      if (lo == null && hi != null) rangeLabel = `${band.label} &lt; ${hi} kg`;
      else if (lo != null && hi == null) rangeLabel = `${band.label} ≥ ${lo} kg`;
      else if (lo != null && hi != null) rangeLabel = `${band.label} ${lo}–${hi} kg`;
      legendItems.push(`<span class="inline-flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded-sm" style="background:${dark ? band.darkFill : band.fill};box-shadow:inset 0 0 0 1px ${dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}"></span>${rangeLabel}</span>`);
    }
  }
  const legend = legendItems.join('');

  if (weightLogs.length === 0) {
    return { svg: '<div class="h-full flex items-center justify-center text-xs text-gray-500">Noch keine Gewichtseinträge.</div>', legend, forecastNote };
  }

  // window
  const now = nowMs;
  let from: number;
  let to: number;
  if (range === 'all') {
    const times = weightLogs.map((l) => new Date(l.loggedAt).getTime()).filter((t) => Number.isFinite(t));
    if (times.length === 0) {
      from = now - WEIGHT_RANGE_MS['90d'];
      to = now;
    } else {
      from = Math.min(...times);
      to = Math.max(now, Math.max(...times));
    }
  } else {
    from = now - WEIGHT_RANGE_MS[range];
    to = now;
  }
  if (forecastOn) to += FORECAST_MS;

  const inRange = weightLogs
    .map((l) => ({ t: new Date(l.loggedAt).getTime(), kg: Number(l.weightKg) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.kg) && p.t >= from && p.t <= now)
    .sort((a, b) => a.t - b.t);

  const slope = forecastOn && trendReliable ? trendSlopeKgPerMs(weightLogs, now) : 0;
  const goalEndKg = forecastOn && lastKg != null ? lastKg + weeklyChange! * (FORECAST_MS / WEEK_MS) : null;
  const trendEndKg = forecastOn && trendReliable && lastKg != null ? lastKg + slope * FORECAST_MS : null;

  const W = 720;
  const H = 208;
  const pad = { l: 42, r: bmiOn ? 86 : forecastOn ? 36 : 16, t: 14, b: 28 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  let tMin = from;
  let tMax = to;
  if (tMax <= tMin) tMax = tMin + 86400000;

  const weights = inRange.map((p) => p.kg);
  let yMin = weights.length ? Math.min(...weights) : lastKg ?? 50;
  let yMax = weights.length ? Math.max(...weights) : lastKg ?? 90;
  if (profile.targetWeightKg && profile.targetWeightKg > 0) {
    yMin = Math.min(yMin, profile.targetWeightKg);
    yMax = Math.max(yMax, profile.targetWeightKg);
  }
  if (forecastOn && lastKg != null) {
    yMin = Math.min(yMin, lastKg);
    yMax = Math.max(yMax, lastKg);
  }
  if (goalEndKg != null) {
    yMin = Math.min(yMin, goalEndKg);
    yMax = Math.max(yMax, goalEndKg);
  }
  if (trendEndKg != null) {
    yMin = Math.min(yMin, trendEndKg);
    yMax = Math.max(yMax, trendEndKg);
  }
  if (bmiOn) {
    const dataLo = weights.length ? Math.min(...weights) : yMin;
    const dataHi = weights.length ? Math.max(...weights) : yMax;
    const dataMid = weights.length ? weights[weights.length - 1] : (dataLo + dataHi) / 2;
    const boundsKg = BMI_BOUNDARIES.map((b) => weightForBmi(b.bmi, heightCm)).filter((kg): kg is number => kg != null);
    const include = boundsKg.filter((k) => k >= dataLo - 8 && k <= dataHi + 8);
    const lower = [...boundsKg].filter((k) => k <= dataMid).pop();
    const upper = boundsKg.find((k) => k >= dataMid);
    if (lower != null) include.push(lower);
    if (upper != null) include.push(upper);
    if (include.length) {
      yMin = Math.min(yMin, ...include);
      yMax = Math.max(yMax, ...include);
    }
  }
  const padY = Math.max(0.6, (yMax - yMin) * 0.12);
  yMin -= padY;
  yMax += padY;
  if (yMax - yMin < 2) {
    const mid = (yMin + yMax) / 2;
    yMin = mid - 1;
    yMax = mid + 1;
  }

  const xOf = (t: number) => pad.l + ((t - tMin) / (tMax - tMin)) * innerW;
  const yOf = (kg: number) => pad.t + (1 - (kg - yMin) / (yMax - yMin)) * innerH;
  const clipY = (kg: number) => Math.min(yMax, Math.max(yMin, kg));

  const parts: string[] = [];
  parts.push(`<svg viewBox="0 0 ${W} ${H}" class="w-full h-full" role="img" aria-label="Gewichtsverlauf">`);

  if (bmiOn) {
    for (const band of BMI_BANDS) {
      const loKg = band.from <= 0 ? yMin : weightForBmi(band.from, heightCm);
      const hiKg = band.to === Infinity ? yMax : weightForBmi(band.to, heightCm);
      if (loKg == null || hiKg == null) continue;
      const top = Math.min(yMax, Math.max(yMin, hiKg));
      const bot = Math.max(yMin, Math.min(yMax, loKg));
      if (top <= bot) continue;
      const y = yOf(top);
      const h = yOf(bot) - y;
      parts.push(`<rect x="${pad.l}" y="${y}" width="${innerW}" height="${Math.max(0, h)}" fill="${dark ? band.darkFill : band.fill}" />`);
    }
    for (const bound of BMI_BOUNDARIES) {
      const kg = weightForBmi(bound.bmi, heightCm);
      if (kg == null || kg < yMin || kg > yMax) continue;
      const y = yOf(kg);
      parts.push(`<line x1="${pad.l}" y1="${y}" x2="${pad.l + innerW}" y2="${y}" stroke="${axis}" stroke-width="0.75" stroke-dasharray="3 3" opacity="0.55" />`);
      parts.push(`<text x="${pad.l + innerW + 4}" y="${y + 3}" fill="${axis}" font-size="9">BMI ${bound.bmi}</text>`);
    }
  }

  if (forecastOn) {
    const xNow = xOf(now);
    const xEnd = xOf(now + FORECAST_MS);
    parts.push(`<rect x="${xNow}" y="${pad.t}" width="${Math.max(0, xEnd - xNow)}" height="${innerH}" fill="${dark ? 'rgba(13,148,136,0.08)' : 'rgba(13,148,136,0.07)'}" />`);
  }

  const yTicks = niceYTicks(yMin, yMax);
  for (const tick of yTicks) {
    if (tick < yMin || tick > yMax) continue;
    const y = yOf(tick);
    parts.push(`<line x1="${pad.l}" y1="${y}" x2="${pad.l + innerW}" y2="${y}" stroke="${grid}" stroke-width="1" />`);
    parts.push(`<text x="${pad.l - 6}" y="${y + 3}" fill="${axis}" font-size="10" text-anchor="end">${tick}</text>`);
  }

  const tickCount = range === '7d' ? 7 : 5;
  for (let i = 0; i < tickCount; i++) {
    const t = tMin + ((tMax - tMin) * i) / Math.max(1, tickCount - 1);
    const x = xOf(t);
    const d = new Date(t);
    const lbl = range === '365d' || range === 'all' ? d.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' }) : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    parts.push(`<text x="${x}" y="${H - 8}" fill="${axis}" font-size="10" text-anchor="middle">${escapeHtml(lbl)}</text>`);
  }

  if (profile.targetWeightKg && profile.targetWeightKg > 0 && profile.targetWeightKg >= yMin && profile.targetWeightKg <= yMax) {
    const y = yOf(profile.targetWeightKg);
    parts.push(`<line x1="${pad.l}" y1="${y}" x2="${pad.l + innerW}" y2="${y}" stroke="#6366f1" stroke-width="1.25" stroke-dasharray="5 4" />`);
  }

  if (inRange.length === 0 && !forecastOn) {
    parts.push(`<text x="${W / 2}" y="${H / 2}" fill="${axis}" font-size="12" text-anchor="middle">Keine Einträge in diesem Zeitraum</text>`);
  } else if (inRange.length === 0) {
    parts.push(`<text x="${xOf((tMin + now) / 2)}" y="${pad.t + innerH / 2}" fill="${axis}" font-size="11" text-anchor="middle">Keine Einträge in diesem Zeitraum</text>`);
  } else {
    const pts = inRange.map((p) => `${xOf(p.t).toFixed(1)},${yOf(p.kg).toFixed(1)}`).join(' ');
    if (inRange.length > 1) parts.push(`<polyline fill="none" stroke="${line}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts}" />`);
    for (const p of inRange) {
      const when = new Date(p.t).toLocaleDateString('de-DE');
      parts.push(`<circle cx="${xOf(p.t).toFixed(1)}" cy="${yOf(p.kg).toFixed(1)}" r="3.2" fill="${line}"><title>${when}: ${p.kg} kg</title></circle>`);
    }
  }

  if (forecastOn && lastKg != null && goalEndKg != null && trendEndKg != null) {
    const xNow = xOf(now);
    const xEnd = xOf(now + FORECAST_MS);
    const yNow = yOf(clipY(lastKg));
    const yGoal = yOf(clipY(goalEndKg));
    const yTrend = yOf(clipY(trendEndKg));
    const lastPt = inRange.length ? inRange[inRange.length - 1] : null;
    if (lastPt && now - lastPt.t > 60_000) {
      parts.push(`<line x1="${xOf(lastPt.t).toFixed(1)}" y1="${yOf(lastPt.kg).toFixed(1)}" x2="${xNow.toFixed(1)}" y2="${yNow.toFixed(1)}" stroke="${line}" stroke-width="1.5" stroke-dasharray="3 4" opacity="0.45" />`);
    }
    const behind = weeklyChange! < 0 ? trendEndKg > goalEndKg + 0.05 : weeklyChange! > 0 ? trendEndKg < goalEndKg - 0.05 : Math.abs(trendEndKg - goalEndKg) > 0.05;
    const onTrack = Math.abs(trendEndKg - goalEndKg) <= 0.05;
    const fill = onTrack ? (dark ? 'rgba(16,185,129,0.22)' : 'rgba(16,185,129,0.28)') : behind ? 'rgba(239,68,68,0.22)' : dark ? 'rgba(16,185,129,0.24)' : 'rgba(16,185,129,0.3)';
    parts.push(`<polygon points="${xNow.toFixed(1)},${yNow.toFixed(1)} ${xEnd.toFixed(1)},${yGoal.toFixed(1)} ${xEnd.toFixed(1)},${yTrend.toFixed(1)}" fill="${fill}" />`);
    parts.push(`<line x1="${xNow.toFixed(1)}" y1="${pad.t}" x2="${xNow.toFixed(1)}" y2="${pad.t + innerH}" stroke="${axis}" stroke-width="1" stroke-dasharray="2 3" />`);
    parts.push(`<text x="${xNow.toFixed(1)}" y="${pad.t + 10}" fill="${axis}" font-size="9" text-anchor="middle">Heute</text>`);
    parts.push(`<line x1="${xNow.toFixed(1)}" y1="${yNow.toFixed(1)}" x2="${xEnd.toFixed(1)}" y2="${yGoal.toFixed(1)}" stroke="#0d9488" stroke-width="1.75" stroke-dasharray="6 4" stroke-linecap="round" />`);
    parts.push(`<line x1="${xNow.toFixed(1)}" y1="${yNow.toFixed(1)}" x2="${xEnd.toFixed(1)}" y2="${yTrend.toFixed(1)}" stroke="#fb923c" stroke-width="1.75" stroke-dasharray="2 4" stroke-linecap="round" />`);
    parts.push(`<circle cx="${xEnd.toFixed(1)}" cy="${yGoal.toFixed(1)}" r="3" fill="#0d9488"><title>Ziel in 4 Wochen: ${Math.round(goalEndKg * 10) / 10} kg</title></circle>`);
    parts.push(`<circle cx="${xEnd.toFixed(1)}" cy="${yTrend.toFixed(1)}" r="3" fill="#fb923c"><title>Trend in 4 Wochen: ${Math.round(trendEndKg * 10) / 10} kg</title></circle>`);
    const deltaKg = Math.round((trendEndKg - goalEndKg) * 10) / 10;
    const maintain = weeklyChange === 0;
    let deltaLabel: string;
    if (onTrack) deltaLabel = maintain ? 'Gewicht gehalten' : 'im Plan';
    else if (maintain) deltaLabel = `Abweichung ${formatSignedKg(deltaKg)}`;
    else deltaLabel = `${behind ? 'hinter Ziel' : 'vor dem Ziel'} ${Math.abs(deltaKg)} kg`;
    const labelY = Math.min(yGoal, yTrend) - 8;
    const labelFill = behind && !onTrack ? (dark ? '#fca5a5' : '#dc2626') : dark ? '#5eead4' : '#0f766e';
    parts.push(`<text x="${((xNow + xEnd) / 2).toFixed(1)}" y="${labelY.toFixed(1)}" fill="${labelFill}" font-size="10" font-weight="600" text-anchor="middle">${escapeHtml(deltaLabel)}</text>`);

    const goalDelta = goalEndKg - lastKg;
    const trendDelta = trendEndKg - lastKg;
    const status = onTrack ? 'im Plan' : maintain ? `Abweichung ${formatSignedKg(deltaKg)}` : behind ? 'hinter dem Ziel' : 'vor dem Ziel';
    forecastNote = {
      text: `In 4 Wochen: Ziel ${Math.round(goalEndKg * 10) / 10} kg (${formatSignedKg(goalDelta)}) · bisheriger Trend ${Math.round(trendEndKg * 10) / 10} kg (${formatSignedKg(trendDelta)}) · Differenz ${Math.abs(deltaKg)} kg · ${status}`,
      cls: behind && !onTrack ? 'text-red-600 dark:text-red-400' : 'text-teal-700 dark:text-teal-300',
    };
  }

  parts.push(`<text x="12" y="12" fill="${text}" font-size="9">kg</text>`);
  parts.push('</svg>');
  return { svg: parts.join(''), legend, forecastNote };
}

function WeightSection({ weightLogs, profile, dark, onAdd, onDelete }: { weightLogs: WeightLog[]; profile: BodyProfile; dark: boolean; onAdd: (weightKg: number, day: string) => Promise<void>; onDelete: (id: string) => void }) {
  const [range, setRange] = useState<WeightRange>(() => readWeightRange());
  const [showBmi, setShowBmi] = useState(() => readShowBmi());
  const [weight, setWeight] = useState('');
  const [date, setDate] = useState(() => toDateInputValue(new Date()));
  const [busy, setBusy] = useState(false);

  const setRangePersist = (r: WeightRange) => {
    setRange(r);
    try {
      localStorage.setItem(WEIGHT_RANGE_KEY, r);
    } catch {
      /* ignore */
    }
  };
  const setBmiPersist = (on: boolean) => {
    setShowBmi(on);
    try {
      localStorage.setItem(WEIGHT_BMI_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const chart = useMemo(() => buildWeightChart(weightLogs, profile, range, showBmi, dark), [weightLogs, profile, range, showBmi, dark]);

  const current = weightLogs[0];
  const bmi = current ? calculateBmi(current.weightKg, profile.heightCm || 0) : null;
  const currentLabel = current
    ? `Aktuell: ${current.weightKg} kg (${new Date(current.loggedAt).toLocaleDateString('de-DE')})${bmi != null ? ` · BMI ${bmi} (${bmiCategoryLabel(bmi)})` : ''}`
    : 'Aktuell: – kg';
  const hasHeight = !!(profile.heightCm && profile.heightCm > 0);

  const ranges: { key: WeightRange; label: string }[] = [
    { key: '7d', label: '1 Woche' },
    { key: '30d', label: '1 Monat' },
    { key: '90d', label: '3 Monate' },
    { key: '365d', label: '1 Jahr' },
    { key: 'all', label: 'Alles' },
  ];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const w = Number(weight);
    if (!Number.isFinite(w) || w <= 0) return;
    setBusy(true);
    try {
      await onAdd(w, date || toDateInputValue(new Date()));
      setWeight('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Gewicht</h2>
        <span className="text-sm text-gray-600 dark:text-gray-300">{currentLabel}</span>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-gray-300 text-xs dark:border-gray-600">
          {ranges.map((r, i) => {
            const active = r.key === range;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => setRangePersist(r.key)}
                className={`px-2 py-1 ${i > 0 ? 'border-l border-gray-300 dark:border-gray-600' : ''} ${active ? 'bg-orange-500 text-white hover:bg-orange-600' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'}`}
              >
                {r.label}
              </button>
            );
          })}
        </div>
        <label className={`ml-auto flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 ${hasHeight ? '' : 'opacity-50'}`} title={hasHeight ? '' : 'Größe im Körperprofil eintragen, um BMI-Grenzen zu zeigen'}>
          <input type="checkbox" checked={showBmi} onChange={(e) => setBmiPersist(e.target.checked)} className="rounded border-gray-300 dark:border-gray-600" />
          BMI-Grenzen
        </label>
      </div>
      <Html html={chart.svg} className="h-52 w-full rounded border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40" />
      <Html html={chart.legend} className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400" />
      {chart.forecastNote && <p className={`mt-1 text-xs ${chart.forecastNote.cls}`}>{chart.forecastNote.text}</p>}

      <form onSubmit={submit} className="mb-3 mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-200">
          Gewicht (kg)
          <input type="number" step="0.1" required value={weight} onChange={(e) => setWeight(e.target.value)} className="w-24 rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900" />
        </label>
        <label className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-200">
          Datum
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900" />
        </label>
        <button type="submit" disabled={busy} className="rounded bg-orange-500 px-3 py-1.5 text-sm text-white hover:bg-orange-600 disabled:opacity-50">Loggen</button>
      </form>

      <ul className="max-h-40 divide-y divide-gray-100 overflow-y-auto text-sm dark:divide-gray-700">
        {weightLogs.length === 0 && <li className="py-2 text-xs text-gray-500">Noch keine Einträge.</li>}
        {weightLogs.slice(0, 25).map((log) => (
          <li key={log.id} className="flex items-center justify-between py-1.5">
            <span>{new Date(log.loggedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
            <span className="flex items-center gap-2">
              <strong>{log.weightKg} kg</strong>
              <button type="button" onClick={() => onDelete(log.id)} className="text-xs text-red-500">×</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

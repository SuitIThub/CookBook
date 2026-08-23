import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { assetUrl } from '@/lib/api';
import {
  localRecipe,
  localVariants,
  setLocalRecipePrivate,
  createLocalVariant,
  localShoppingLists,
  createLocalShoppingList,
  addRecipeToLocalShoppingList
} from '@/lib/localData';
import { computeLocalRecipeNutrition } from '@/lib/localNutrition';
import { exportRecipeMarkdown, exportRecipeJson, copyRecipeMarkdown } from '@/lib/recipeExport';
import AIChatModal from '@/components/AIChatModal';
import AddToShoppingListModal from '@/components/AddToShoppingListModal';
import CatalogueModal from '@/components/CatalogueModal';
import type { Ingredient, IngredientGroup, PreparationStep, PreparationGroup, NutritionData } from '@/types';
import { formatTime, getTotalTime } from '@shared/recipe';
import { hasNutritionValues } from '@core/nutrition';

/** Traffic-light assessment for a primary nutrient (mirrors the website's NutritionInfo). */
function assessNutrient(key: string, v: number): { symbol: string; color: string; title: string } | null {
  const t: Record<string, [number, number, number]> = {
    calories: [200, 500, 700],
    carbohydrates: [20, 60, 80],
    protein: [10, 35, 50],
    fat: [5, 25, 35]
  };
  const b = t[key];
  if (!b) return null;
  if (v < b[0]) return { symbol: '⬇️', color: 'text-blue-500', title: 'Niedrig' };
  if (v <= b[1]) return { symbol: '✅', color: 'text-green-500', title: 'Optimal' };
  if (v <= b[2]) return { symbol: '⚠️', color: 'text-yellow-500', title: 'Hoch' };
  return { symbol: '⬆️', color: 'text-red-500', title: 'Sehr hoch' };
}

/** Green nutrition-assessment card (mirrors the website's NutritionInfo). */
function NutritionCard({ nutrition, isEstimated = false, sourceLabel }: { nutrition: NutritionData; isEstimated?: boolean; sourceLabel?: string }) {
  if (!hasNutritionValues(nutrition)) return null;
  const primary = [
    { key: 'calories', label: 'kcal', unit: '', cls: 'text-orange-600 dark:text-orange-400' },
    { key: 'carbohydrates', label: 'Kohlenhydrate', unit: 'g', cls: 'text-blue-600 dark:text-blue-400' },
    { key: 'protein', label: 'Eiweiß', unit: 'g', cls: 'text-purple-600 dark:text-purple-400' },
    { key: 'fat', label: 'Fett', unit: 'g', cls: 'text-yellow-600 dark:text-yellow-400' }
  ] as const;
  const detail = [
    { key: 'saturatedFat', label: 'gesätt. Fett', cls: 'text-amber-700 dark:text-amber-400' },
    { key: 'sugar', label: 'Zucker', cls: 'text-pink-600 dark:text-pink-400' },
    { key: 'fiber', label: 'Ballaststoffe', cls: 'text-lime-600 dark:text-lime-400' },
    { key: 'salt', label: 'Salz', cls: 'text-slate-600 dark:text-slate-300' }
  ] as const;
  const hasPrimary = primary.some((f) => nutrition[f.key] != null);
  return (
    <div className="mb-4 rounded-lg border border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-4 dark:border-green-700 dark:from-green-900/20 dark:to-emerald-900/20">
      <h3 className="mb-3 flex flex-wrap items-center justify-between gap-2 text-lg font-semibold text-green-800 dark:text-green-200">
        <span className="flex items-center">
          <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Nährwerte pro Portion
          {isEstimated && <span className="ml-2 text-xs font-normal text-yellow-700 dark:text-yellow-300" title="mind. eine Zutat geschätzt">~ geschätzt</span>}
        </span>
        {sourceLabel && <span className="text-xs font-normal text-gray-600 dark:text-gray-300">{sourceLabel}</span>}
      </h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {primary.map((f) => {
          const val = nutrition[f.key];
          if (val == null) return null;
          const a = assessNutrient(f.key, val);
          return (
            <div key={f.key} className="text-center">
              <div className="mb-1 flex items-center justify-center">
                <div className={'mr-2 text-2xl font-bold ' + f.cls}>
                  {isEstimated ? '~' : ''}
                  {f.key === 'calories' ? Math.round(val) : Math.round(val * 10) / 10}
                  {f.unit}
                </div>
                {a && <span className={'text-lg ' + a.color} title={a.title}>{a.symbol}</span>}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">{f.label}</div>
            </div>
          );
        })}
      </div>
      {detail.some((d) => nutrition[d.key] != null) && (
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-green-200 pt-3 sm:grid-cols-4 dark:border-green-700">
          {detail.map((d) => {
            const val = nutrition[d.key];
            if (val == null) return null;
            return (
              <div key={d.key} className="text-center">
                <div className={'text-lg font-semibold ' + d.cls}>
                  {isEstimated ? '~' : ''}
                  {Math.round(val * 100) / 100}g
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400">{d.label}</div>
              </div>
            );
          })}
        </div>
      )}
      {hasPrimary && (
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

function isIngredientGroup(x: Ingredient | IngredientGroup): x is IngredientGroup {
  return Array.isArray((x as IngredientGroup).ingredients);
}
function isPrepGroup(x: PreparationStep | PreparationGroup): x is PreparationGroup {
  return Array.isArray((x as PreparationGroup).steps);
}
function flattenSteps(nodes: (PreparationStep | PreparationGroup)[]): PreparationStep[] {
  const out: PreparationStep[] = [];
  for (const n of nodes) {
    if (isPrepGroup(n)) out.push(...flattenSteps(n.steps));
    else out.push(n);
  }
  return out;
}
function formatAmount(n: number): string {
  const r = Math.round(n * 100) / 100;
  return (Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/\.?0+$/, '')).replace('.', ',');
}

/** Ingredient row / nested group, matching the website's IngredientNode markup. */
function IngredientNode({
  item,
  scale,
  onCatalogue
}: {
  item: Ingredient | IngredientGroup;
  scale: number;
  onCatalogue: (name: string) => void;
}) {
  if (isIngredientGroup(item)) {
    return (
      <li className="py-2">
        {item.title && (
          <h4 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">{item.title}</h4>
        )}
        <ul className="ml-4 space-y-2">
          {item.ingredients.map((child, i) => (
            <IngredientNode key={('id' in child && child.id) || i} item={child} scale={scale} onCatalogue={onCatalogue} />
          ))}
        </ul>
      </li>
    );
  }
  const qty = item.quantities?.[0];
  return (
    <li className="flex items-center justify-between rounded-md px-3 py-2 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700">
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-gray-900 dark:text-white">{item.name}</span>
          <button
            type="button"
            onClick={() => onCatalogue(item.name)}
            className="rounded p-1 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
            title="Zutat im Register öffnen (Nährwerte & Produkte)"
            aria-label={`Registerdaten für ${item.name}`}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M4 12h10M4 17h7" /></svg>
          </button>
        </div>
        {item.description && (
          <div className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">{item.description}</div>
        )}
      </div>
      {qty && (qty.amount > 0 || (qty.unit && qty.unit.trim() !== '')) && (
        <span className="rounded bg-gray-100 px-2 py-1 text-sm text-gray-600 dark:bg-gray-700 dark:text-gray-400">
          {formatAmount(qty.amount * scale)} {qty.unit}
        </span>
      )}
    </li>
  );
}

export default function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const recipeQuery = useQuery({ queryKey: ['recipe', id], queryFn: () => localRecipe(id!), enabled: !!id });
  const recipe = recipeQuery.data;
  const rootId = recipe ? recipe.parentRecipeId ?? recipe.id : undefined;

  const originalQuery = useQuery({ queryKey: ['recipe', rootId], queryFn: () => localRecipe(rootId!), enabled: !!rootId });
  const variantsQuery = useQuery({ queryKey: ['variants', rootId], queryFn: () => localVariants(rootId!), enabled: !!rootId });

  const [servingsOverride, setServingsOverride] = useState<number | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showAddToList, setShowAddToList] = useState(false);
  const [catalogueFor, setCatalogueFor] = useState<string | null>(null);

  const baseServings = recipe?.metadata.servings ?? 1;
  const servings = servingsOverride ?? baseServings;

  const nutritionQuery = useQuery({
    queryKey: ['nutrition', id, servings],
    queryFn: () => computeLocalRecipeNutrition(recipe!, { servings }),
    enabled: !!recipe
  });

  const togglePrivate = async () => {
    if (!recipe) return;
    await setLocalRecipePrivate(recipe.id, !recipe.isPrivate);
    queryClient.invalidateQueries({ queryKey: ['recipe', recipe.id] });
  };

  const makeVariant = async () => {
    if (!recipe) return;
    const name = window.prompt('Name der Variante?', '');
    if (name == null) return;
    const variant = await createLocalVariant(recipe, name);
    queryClient.invalidateQueries();
    navigate(`/rezept/${variant.id}/bearbeiten`);
  };

  const tabs = useMemo(() => {
    if (!originalQuery.data) return [];
    const variants = variantsQuery.data ?? [];
    if (variants.length === 0) return [];
    return [
      { id: originalQuery.data.id, label: 'Original' },
      ...variants.map((v, i) => ({ id: v.id, label: v.variantName?.trim() || `Variante ${i + 1}` }))
    ];
  }, [originalQuery.data, variantsQuery.data]);

  if (recipeQuery.isLoading) return <p className="text-muted">Lade Rezept …</p>;
  if (recipeQuery.isError || !recipe) {
    return (
      <div>
        <p className="text-red-600 dark:text-red-400">Rezept nicht gefunden.</p>
        <Link to="/" className="text-orange-600 hover:underline dark:text-orange-400">← Zurück zur Übersicht</Link>
      </div>
    );
  }

  const totalTime = getTotalTime(recipe.metadata.timeEntries ?? []);
  const scale = baseServings > 0 ? servings / baseServings : 1;
  const nutr = nutritionQuery.data;
  const gallery = (recipe.images?.length ? recipe.images.map((i) => i.url) : recipe.imageUrl ? [recipe.imageUrl] : []).filter(
    (u): u is string => !!u
  );
  const heroUrl = assetUrl(gallery[0] ?? undefined);
  const actionBtn = 'flex items-center justify-center space-x-2 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors whitespace-nowrap';

  return (
    <article className="mx-auto max-w-4xl">
      {/* Variant tabs */}
      {tabs.length > 0 && (
        <div className="mb-4">
          <div className="mb-4 hidden border-b border-gray-200 not-mobile:flex dark:border-gray-700">
            {tabs.map((t) => (
              <Link
                key={t.id}
                to={`/rezept/${t.id}`}
                className={
                  '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ' +
                  (t.id === recipe.id
                    ? 'border-orange-500 text-orange-600 dark:text-orange-400'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:hover:text-gray-200')
                }
              >
                {t.label}
              </Link>
            ))}
          </div>
          <div className="mb-4 not-mobile:hidden">
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Variante</label>
            <select
              value={recipe.id}
              onChange={(e) => navigate(`/rezept/${e.target.value}`)}
              className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-orange-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            >
              {tabs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Header */}
      <div
        className={
          'recipe-header-root mb-6 rounded-lg shadow-sm ' +
          (heroUrl ? 'relative overflow-hidden' : 'overflow-hidden border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800')
        }
      >
        {heroUrl && (
          <div className="relative h-64 w-full overflow-hidden rounded-t-lg sm:h-80 md:h-96">
            <img src={heroUrl} alt={recipe.title} className="h-full w-full object-cover" />
          </div>
        )}
        <div
          className={
            (heroUrl
              ? 'recipe-hero-overlap relative z-10 -mt-40 rounded-b-lg border-x border-b border-gray-200 dark:border-gray-700 sm:-mt-48 '
              : '') + 'p-6'
          }
        >
          <div className="flex flex-col gap-4 not-mobile:flex-row not-mobile:items-start not-mobile:justify-between">
            <div className="flex-1">
              <h1 className={'mb-2 text-3xl font-bold text-gray-900 dark:text-white' + (heroUrl ? ' drop-shadow' : '')}>
                {recipe.title}
              </h1>
              {recipe.subtitle && (
                <p className={'mb-3 text-xl text-gray-700 dark:text-gray-300' + (heroUrl ? ' drop-shadow-sm' : '')}>
                  {recipe.subtitle}
                </p>
              )}
              {recipe.description && (
                <p className="whitespace-pre-wrap leading-relaxed text-gray-600 dark:text-gray-400">{recipe.description}</p>
              )}
              {recipe.sourceUrl && (
                <p className={'mt-2 text-sm' + (heroUrl ? ' drop-shadow-sm' : '')}>
                  <a href={recipe.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                    Quelle
                  </a>
                </p>
              )}

              {/* Meta */}
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-600 dark:text-gray-400">
                {(recipe.metadata.timeEntries ?? []).map((t, i) => (
                  <span key={i}>
                    {t.label}: {formatTime(t.minutes)}
                  </span>
                ))}
                {totalTime > 0 && <span className="font-medium">gesamt {formatTime(totalTime)}</span>}
                {recipe.metadata.difficulty && <span>{recipe.metadata.difficulty}</span>}
                <span className="inline-flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setServingsOverride(Math.max(1, servings - 1))}
                    className="flex h-6 w-6 items-center justify-center rounded border border-gray-300 dark:border-gray-600"
                    aria-label="weniger Portionen"
                  >
                    −
                  </button>
                  <span className="tabular-nums">{servings} Portionen</span>
                  <button
                    type="button"
                    onClick={() => setServingsOverride(servings + 1)}
                    className="flex h-6 w-6 items-center justify-center rounded border border-gray-300 dark:border-gray-600"
                    aria-label="mehr Portionen"
                  >
                    +
                  </button>
                  {servingsOverride != null && servingsOverride !== baseServings && (
                    <button type="button" onClick={() => setServingsOverride(null)} className="text-xs text-orange-600 hover:underline dark:text-orange-400">
                      zurücksetzen
                    </button>
                  )}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-shrink-0 flex-col space-y-2">
              <button onClick={() => setShowAddToList(true)} className={actionBtn + ' bg-green-500 hover:bg-green-600'}>
                <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span>Zur Einkaufsliste</span>
              </button>
              <Link to={`/rezept/${recipe.id}/kochen`} className={actionBtn + ' bg-orange-500 hover:bg-orange-600'}>
                <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>Kochen</span>
              </Link>
              <Link to={`/rezept/${recipe.id}/bearbeiten`} className={actionBtn + ' bg-blue-500 hover:bg-blue-600'}>
                <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                <span>Bearbeiten</span>
              </Link>
              <button onClick={makeVariant} className={actionBtn + ' bg-teal-500 hover:bg-teal-600'}>
                <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                <span>Variante</span>
              </button>
              <button onClick={() => setShowChat(true)} className={actionBtn + ' bg-indigo-500 hover:bg-indigo-600'}>
                <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 3v-3z" />
                </svg>
                <span>KI</span>
              </button>
              <div className="relative">
                <button onClick={() => setExportOpen((o) => !o)} className={actionBtn + ' w-full bg-purple-500 hover:bg-purple-600'}>
                  <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <span className="flex-1 text-left">Exportieren</span>
                  <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {exportOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                    <div className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
                      <button
                        onClick={() => {
                          exportRecipeMarkdown(recipe);
                          setExportOpen(false);
                        }}
                        className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                      >
                        Als Markdown (.md)
                      </button>
                      <button
                        onClick={() => {
                          exportRecipeJson(recipe);
                          setExportOpen(false);
                        }}
                        className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                      >
                        Als JSON (.json)
                      </button>
                      <button
                        onClick={async () => {
                          const ok = await copyRecipeMarkdown(recipe);
                          setExportOpen(false);
                          if (ok) {
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          }
                        }}
                        className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                      >
                        Markdown kopieren
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={togglePrivate}
                className={
                  actionBtn +
                  ' ' +
                  (recipe.isPrivate
                    ? 'bg-amber-500 hover:bg-amber-600'
                    : 'border border-gray-300 bg-white !text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:!text-gray-200 dark:hover:bg-gray-700')
                }
                title={recipe.isPrivate ? 'Privat — bleibt nur auf diesem Gerät' : 'Wird synchronisiert'}
              >
                <span>{recipe.isPrivate ? '🔒 Privat' : 'Synchronisiert'}</span>
              </button>
              {copied && <span className="text-right text-xs text-green-600 dark:text-green-400">Kopiert.</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Tags */}
      {(recipe.category || (recipe.tags && recipe.tags.length > 0)) && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="flex flex-wrap gap-2">
            {recipe.category && (
              <Link to={`/?category=${encodeURIComponent(recipe.category)}`} className="tag category-tag">
                {recipe.category}
              </Link>
            )}
            {(recipe.tags ?? []).map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Nutrition — recipe's stated values (assessment card), then live-computed */}
      {recipe.metadata.nutrition && <NutritionCard nutrition={recipe.metadata.nutrition} />}
      {nutr && nutr.nutrition.hasAnyData && (
        <NutritionCard nutrition={nutr.nutrition.perServing} isEstimated={nutr.nutrition.isEstimated} sourceLabel="live berechnet" />
      )}

      {/* Price */}
      {nutr && nutr.price.hasAnyData && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex flex-wrap gap-4 text-sm text-gray-700 dark:text-gray-200">
            <div>Preis pro Rezept: <span className="font-semibold">{nutr.price.perRecipe.toFixed(2).replace('.', ',')} €</span></div>
            <div>Preis pro Portion: <span className="font-semibold">{nutr.price.perServing.toFixed(2).replace('.', ',')} €</span></div>
          </div>
        </div>
      )}

      {/* Image gallery */}
      {gallery.length > 0 && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">Bilder</h2>
          <div className="flex space-x-4 overflow-x-auto pb-2">
            {gallery.map((url, i) => (
              <div key={url + i} className="h-32 w-32 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-700">
                <img src={assetUrl(url)} alt="" className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ingredients | Preparation */}
      <div className="grid-two-cols">
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="p-6">
            <h2 className="mb-4 flex items-center text-2xl font-bold text-gray-900 dark:text-white">
              <svg className="mr-2 h-6 w-6 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
                <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
              </svg>
              Zutaten
            </h2>
            <ul className="space-y-2">
              {(recipe.ingredientGroups ?? []).map((g, i) => (
                <IngredientNode key={g.id || i} item={g} scale={scale} onCatalogue={setCatalogueFor} />
              ))}
            </ul>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="p-6">
            <h2 className="mb-4 flex items-center text-2xl font-bold text-gray-900 dark:text-white">
              <svg className="mr-2 h-6 w-6 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
              Zubereitung
            </h2>
            <ol className="space-y-4">
              {flattenSteps(recipe.preparationGroups ?? []).map((s, i) => (
                <li key={s.id || i} className="flex space-x-4">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-orange-500 text-sm font-bold text-white">
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <p className="leading-relaxed text-gray-900 dark:text-white">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {showChat && <AIChatModal recipeId={recipe.id} recipeTitle={recipe.title} onClose={() => setShowChat(false)} />}
      {showAddToList && (
        <AddToShoppingListModal
          recipeId={recipe.id}
          recipeTitle={recipe.title}
          onClose={() => setShowAddToList(false)}
          loadLists={localShoppingLists}
          createList={createLocalShoppingList}
          addRecipe={addRecipeToLocalShoppingList}
        />
      )}
      {catalogueFor && (
        <CatalogueModal
          name={catalogueFor}
          onClose={() => setCatalogueFor(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['nutrition', id] })}
        />
      )}
    </article>
  );
}

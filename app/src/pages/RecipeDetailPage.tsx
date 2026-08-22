import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { assetUrl } from '@/lib/api';
import { localRecipe, localVariants, setLocalRecipePrivate, createLocalVariant } from '@/lib/localData';
import { computeLocalRecipeNutrition } from '@/lib/localNutrition';
import type {
  Ingredient,
  IngredientGroup,
  PreparationStep,
  PreparationGroup
} from '@/types';
import { formatTime, getTotalTime } from '@shared/recipe';

function isIngredientGroup(x: Ingredient | IngredientGroup): x is IngredientGroup {
  return Array.isArray((x as IngredientGroup).ingredients);
}

function isPrepGroup(x: PreparationStep | PreparationGroup): x is PreparationGroup {
  return Array.isArray((x as PreparationGroup).steps);
}

/** Flatten a possibly-nested preparation tree into ordered steps. */
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

function IngredientNode({ item, scale }: { item: Ingredient | IngredientGroup; scale: number }) {
  if (isIngredientGroup(item)) {
    return (
      <div className="mt-3">
        {item.title && (
          <h4 className="mb-1 text-sm font-semibold text-secondary-500">{item.title}</h4>
        )}
        <ul className="space-y-1">
          {item.ingredients.map((child, i) => (
            <IngredientNode key={('id' in child && child.id) || i} item={child} scale={scale} />
          ))}
        </ul>
      </div>
    );
  }
  const qty = item.quantities?.[0];
  return (
    <li className="flex gap-2">
      {qty && (
        <span className="min-w-[4.5rem] shrink-0 tabular-nums text-secondary-500">
          {formatAmount(qty.amount * scale)} {qty.unit}
        </span>
      )}
      <span>{item.name}</span>
    </li>
  );
}

export default function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const recipeQuery = useQuery({
    queryKey: ['recipe', id],
    queryFn: () => localRecipe(id!),
    enabled: !!id
  });

  const recipe = recipeQuery.data;
  const rootId = recipe ? recipe.parentRecipeId ?? recipe.id : undefined;

  const originalQuery = useQuery({
    queryKey: ['recipe', rootId],
    queryFn: () => localRecipe(rootId!),
    enabled: !!rootId
  });

  const variantsQuery = useQuery({
    queryKey: ['variants', rootId],
    queryFn: () => localVariants(rootId!),
    enabled: !!rootId
  });

  const [servingsOverride, setServingsOverride] = useState<number | null>(null);
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
      ...variants.map((v, i) => ({
        id: v.id,
        label: v.variantName?.trim() || `Variante ${i + 1}`
      }))
    ];
  }, [originalQuery.data, variantsQuery.data]);

  if (recipeQuery.isLoading) return <p className="text-secondary-500">Lade Rezept …</p>;
  if (recipeQuery.isError || !recipe) {
    return (
      <div>
        <p className="text-red-600 dark:text-red-400">Rezept nicht gefunden.</p>
        <Link to="/" className="text-primary-600 hover:underline">
          ← Zurück zur Übersicht
        </Link>
      </div>
    );
  }

  const totalTime = getTotalTime(recipe.metadata.timeEntries ?? []);
  const steps = flattenSteps(recipe.preparationGroups ?? []);
  const scale = baseServings > 0 ? servings / baseServings : 1;
  const nutr = nutritionQuery.data;
  const image = assetUrl(recipe.imageUrl ?? recipe.images?.[0]?.url);

  return (
    <article className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <Link to="/" className="text-sm text-primary-600 hover:underline">
          ← Rezepte
        </Link>
        <div className="flex items-center gap-4">
          <Link to={`/rezept/${recipe.id}/kochen`} className="text-sm font-medium text-primary-600 hover:underline">
            Kochen
          </Link>
          <button onClick={makeVariant} className="text-sm font-medium text-primary-600 hover:underline">
            Variante
          </button>
          <Link to={`/rezept/${recipe.id}/bearbeiten`} className="text-sm font-medium text-primary-600 hover:underline">
            Bearbeiten
          </Link>
        </div>
      </div>

      {tabs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1 border-b border-secondary-200 dark:border-secondary-700">
          {tabs.map((t) => (
            <Link
              key={t.id}
              to={`/rezept/${t.id}`}
              className={
                '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ' +
                (t.id === recipe.id
                  ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-secondary-500 hover:border-secondary-300 hover:text-secondary-700 dark:hover:text-secondary-200')
              }
            >
              {t.label}
            </Link>
          ))}
        </div>
      )}

      <header className="mt-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-3xl font-bold">{recipe.title}</h1>
          <button
            type="button"
            onClick={togglePrivate}
            title={
              recipe.isPrivate
                ? 'Privat — bleibt nur auf diesem Gerät, wird nicht synchronisiert'
                : 'Wird mit dem Server synchronisiert'
            }
            className={
              'shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
              (recipe.isPrivate
                ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300'
                : 'border-secondary-300 text-secondary-500 hover:bg-secondary-100 dark:border-secondary-600 dark:hover:bg-secondary-800')
            }
          >
            {recipe.isPrivate ? '🔒 Privat' : 'Synchronisiert'}
          </button>
        </div>
        {recipe.subtitle && <p className="mt-1 text-secondary-500">{recipe.subtitle}</p>}
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-secondary-500">
          {(recipe.metadata.timeEntries ?? []).map((t, i) => (
            <span key={i}>
              {t.label}: {formatTime(t.minutes)}
            </span>
          ))}
          {totalTime > 0 && <span className="font-medium">· gesamt {formatTime(totalTime)}</span>}
          {recipe.metadata.difficulty && <span>· {recipe.metadata.difficulty}</span>}
          {recipe.category && <span>· {recipe.category}</span>}
        </div>
        {recipe.tags && recipe.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {recipe.tags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-secondary-100 px-2 py-0.5 text-xs text-secondary-600 dark:bg-secondary-700 dark:text-secondary-300"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </header>

      {image && (
        <img
          src={image}
          alt={recipe.title}
          className="mt-4 aspect-video w-full rounded-xl object-cover"
        />
      )}

      {recipe.description && <p className="mt-4 text-secondary-700 dark:text-secondary-300">{recipe.description}</p>}

      {nutr && (nutr.nutrition.hasAnyData || nutr.price.hasAnyData) && (
        <section className="mt-6 rounded-xl border border-secondary-200 p-4 dark:border-secondary-700">
          <h2 className="mb-2 text-sm font-semibold text-secondary-500">
            Nährwerte pro Portion{nutr.nutrition.isEstimated ? ' (geschätzt)' : ''}
          </h2>
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
            {nutr.nutrition.perServing.calories != null && (
              <span>
                <strong>{Math.round(nutr.nutrition.perServing.calories)}</strong> kcal
              </span>
            )}
            {nutr.nutrition.perServing.carbohydrates != null && (
              <span>{Math.round(nutr.nutrition.perServing.carbohydrates)} g KH</span>
            )}
            {nutr.nutrition.perServing.protein != null && (
              <span>{Math.round(nutr.nutrition.perServing.protein)} g Eiweiß</span>
            )}
            {nutr.nutrition.perServing.fat != null && (
              <span>{Math.round(nutr.nutrition.perServing.fat)} g Fett</span>
            )}
            {nutr.price.hasAnyData && (
              <span className="ml-auto text-secondary-600 dark:text-secondary-300">
                ≈ {nutr.price.perServing.toFixed(2).replace('.', ',')} €/Portion
              </span>
            )}
          </div>
        </section>
      )}

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Zutaten</h2>
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setServingsOverride(Math.max(1, servings - 1))}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-secondary-300 dark:border-secondary-600"
              aria-label="weniger Portionen"
            >
              −
            </button>
            <span className="min-w-[5.5rem] text-center tabular-nums">{servings} Portionen</span>
            <button
              type="button"
              onClick={() => setServingsOverride(servings + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-secondary-300 dark:border-secondary-600"
              aria-label="mehr Portionen"
            >
              +
            </button>
            {servingsOverride != null && servingsOverride !== baseServings && (
              <button type="button" onClick={() => setServingsOverride(null)} className="text-xs text-primary-600 hover:underline">
                zurücksetzen
              </button>
            )}
          </div>
        </div>
        <ul className="space-y-1">
          {(recipe.ingredientGroups ?? []).map((g, i) => (
            <IngredientNode key={g.id || i} item={g} scale={scale} />
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-xl font-semibold">Zubereitung</h2>
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={s.id || i} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-semibold text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                {i + 1}
              </span>
              <p className="pt-0.5 text-secondary-700 dark:text-secondary-300">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}

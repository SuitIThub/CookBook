import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet, assetUrl } from '@/lib/api';
import type {
  Recipe,
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

function IngredientNode({ item }: { item: Ingredient | IngredientGroup }) {
  if (isIngredientGroup(item)) {
    return (
      <div className="mt-3">
        {item.title && (
          <h4 className="mb-1 text-sm font-semibold text-secondary-500">{item.title}</h4>
        )}
        <ul className="space-y-1">
          {item.ingredients.map((child, i) => (
            <IngredientNode key={('id' in child && child.id) || i} item={child} />
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
          {qty.amount} {qty.unit}
        </span>
      )}
      <span>{item.name}</span>
    </li>
  );
}

export default function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>();

  const recipeQuery = useQuery({
    queryKey: ['recipe', id],
    queryFn: () => apiGet<Recipe>(`/api/recipes?id=${encodeURIComponent(id!)}`),
    enabled: !!id
  });

  const recipe = recipeQuery.data;
  const rootId = recipe ? recipe.parentRecipeId ?? recipe.id : undefined;

  const originalQuery = useQuery({
    queryKey: ['recipe', rootId],
    queryFn: () => apiGet<Recipe>(`/api/recipes?id=${encodeURIComponent(rootId!)}`),
    enabled: !!rootId
  });

  const variantsQuery = useQuery({
    queryKey: ['variants', rootId],
    queryFn: () => apiGet<Recipe[]>(`/api/recipes?id=${encodeURIComponent(rootId!)}&action=variants`),
    enabled: !!rootId
  });

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
  const image = assetUrl(recipe.imageUrl ?? recipe.images?.[0]?.url);

  return (
    <article className="mx-auto max-w-3xl">
      <Link to="/" className="text-sm text-primary-600 hover:underline">
        ← Rezepte
      </Link>

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
        <h1 className="text-3xl font-bold">{recipe.title}</h1>
        {recipe.subtitle && <p className="mt-1 text-secondary-500">{recipe.subtitle}</p>}
        <div className="mt-3 flex flex-wrap gap-3 text-sm text-secondary-500">
          <span>{recipe.metadata.servings} Portionen</span>
          {totalTime > 0 && <span>· {formatTime(totalTime)}</span>}
          {recipe.metadata.difficulty && <span>· {recipe.metadata.difficulty}</span>}
          {recipe.category && <span>· {recipe.category}</span>}
        </div>
      </header>

      {image && (
        <img
          src={image}
          alt={recipe.title}
          className="mt-4 aspect-video w-full rounded-xl object-cover"
        />
      )}

      {recipe.description && <p className="mt-4 text-secondary-700 dark:text-secondary-300">{recipe.description}</p>}

      <section className="mt-8">
        <h2 className="mb-3 text-xl font-semibold">Zutaten</h2>
        <ul className="space-y-1">
          {(recipe.ingredientGroups ?? []).map((g, i) => (
            <IngredientNode key={g.id || i} item={g} />
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

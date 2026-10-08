/**
 * Rezept (detail) — port of src/pages/rezept/[id].astro composed from the
 * website's detail components (RecipeHeader, RecipeTags, LiveNutritionPanel,
 * RecipeImageGallery, IngredientsList, PreparationSteps) plus the AI chat FAB.
 *
 * Local-first: reads the local replica; tag/portion/alternative/image-URL edits
 * are written locally and synced. Editing itself lives on /rezept/:id/bearbeiten.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Recipe, RecipeImage, Ingredient, IngredientGroup } from '@/types';
import { localRecipe, localVariants, setLocalRecipePrivate, saveLocalRecipe } from '@/lib/localData';
import { exportRecipeJson, exportRecipesRcb } from '@/lib/recipeExport';
import { runSync } from '@/lib/syncRunner';
import { getAlias } from '@/lib/settings';
import { onAliasSettingsChanged } from '@/lib/aliasSync';
import { getDefaultSelection, resolveSelection, type AlternativeSelection } from '@core/alternatives';
import { ensureFavoriteFamilyComplete, isFamilyFavorite, toggleFamilyFavorite } from '@core/favorites';
import { useLowBandwidth } from '@/components/settings/HeaderModals';
import AIChatModal from '@/components/AIChatModal';
import AddToShoppingListModal from '@/components/AddToShoppingListModal';
import CatalogueModal from '@/components/CatalogueModal';
import RecipeHeader from '@/components/recipe/details/RecipeHeader';
import RecipeTags from '@/components/recipe/details/RecipeTags';
import LiveNutritionPanel from '@/components/recipe/details/LiveNutritionPanel';
import RecipeImageGallery from '@/components/recipe/details/RecipeImageGallery';
import IngredientsList from '@/components/recipe/details/IngredientsList';
import PreparationSteps from '@/components/recipe/details/PreparationSteps';

/** Website: persist the chosen alternative as the new default (isAlternativeDefault). */
function applySelectionToGroups(groups: (Ingredient | IngredientGroup)[], selection: AlternativeSelection): any[] {
  return (groups || []).map((item: any) => {
    if (item && Array.isArray(item.ingredients)) return { ...item, ingredients: applySelectionToGroups(item.ingredients, selection) };
    if (item && item.alternativeGroupId && selection[item.alternativeGroupId] !== undefined) {
      return { ...item, isAlternativeDefault: item.id === selection[item.alternativeGroupId] };
    }
    return item;
  });
}

/** Website "Als Standard speichern": scale all ingredient quantities by `factor`. */
function scaleGroups(groups: (Ingredient | IngredientGroup)[], factor: number): any[] {
  return (groups || []).map((item: any) => {
    if (item && Array.isArray(item.quantities)) return { ...item, quantities: item.quantities.map((q: any) => ({ ...q, amount: (q.amount || 0) * factor })) };
    if (item && Array.isArray(item.ingredients)) return { ...item, ingredients: scaleGroups(item.ingredients, factor) };
    return item;
  });
}

export default function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const lowBandwidth = useLowBandwidth();

  const recipeQuery = useQuery({ queryKey: ['recipe', id], queryFn: () => localRecipe(id!), enabled: !!id });
  const recipe = recipeQuery.data;
  const rootId = recipe ? recipe.parentRecipeId ?? recipe.id : undefined;
  const originalQuery = useQuery({ queryKey: ['recipe', rootId], queryFn: () => localRecipe(rootId!), enabled: !!rootId });
  const variantsQuery = useQuery({ queryKey: ['variants', rootId], queryFn: () => localVariants(rootId!), enabled: !!rootId });

  const [servings, setServings] = useState<number | null>(null);
  const [selection, setSelection] = useState<AlternativeSelection>({});
  const [showChat, setShowChat] = useState(false);
  const [showAddToList, setShowAddToList] = useState(false);
  const [catalogueFor, setCatalogueFor] = useState<string | null>(null);
  const [nutritionKey, setNutritionKey] = useState(0);
  const [hasAlias, setHasAlias] = useState(!!getAlias());
  const [favTick, setFavTick] = useState(0);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => onAliasSettingsChanged(() => setHasAlias(!!getAlias())), []);
  useEffect(() => {
    const h = () => setFavTick((n) => n + 1);
    document.addEventListener('cookbook:favorites-changed', h);
    return () => document.removeEventListener('cookbook:favorites-changed', h);
  }, []);

  // Reset per-recipe view state when navigating between recipes/variants.
  useEffect(() => {
    setServings(null);
    setSelection(recipe ? resolveSelection(recipe, getDefaultSelection(recipe)) : {});
  }, [recipe?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const familyIds = useMemo(() => {
    const ids = [originalQuery.data?.id ?? rootId ?? '', ...(variantsQuery.data ?? []).map((v) => v.id)].filter(Boolean) as string[];
    return Array.from(new Set(ids.length ? ids : recipe ? [recipe.id] : []));
  }, [originalQuery.data, variantsQuery.data, rootId, recipe]);
  useEffect(() => {
    if (familyIds.length) ensureFavoriteFamilyComplete(familyIds);
  }, [familyIds]);

  const tabs = useMemo(() => {
    const variants = variantsQuery.data ?? [];
    if (!originalQuery.data || variants.length === 0) return [];
    return [
      { id: originalQuery.data.id, label: 'Original' },
      ...variants.map((v, i) => ({ id: v.id, label: v.variantName && v.variantName.trim().length > 0 ? v.variantName : `Variante ${i + 1}` }))
    ];
  }, [originalQuery.data, variantsQuery.data]);

  if (recipeQuery.isLoading) return <p className="text-muted">Lade Rezept …</p>;
  if (recipeQuery.isError || !recipe) {
    return (
      <div>
        <p className="text-red-600 dark:text-red-400">Rezept nicht gefunden.</p>
        <Link to="/rezepte" className="text-orange-600 hover:underline dark:text-orange-400">← Zurück zur Übersicht</Link>
      </div>
    );
  }

  const base = recipe.metadata.servings || 1;
  const current = servings ?? base;
  const scale = base > 0 ? current / base : 1;
  void favTick;
  const favorited = isFamilyFavorite(familyIds);

  const afterLocalWrite = () => {
    queryClient.invalidateQueries();
    runSync().catch(() => {});
  };
  const update = async (patch: Partial<Recipe>) => {
    await saveLocalRecipe(recipe.id, patch);
    afterLocalWrite();
  };

  const onSelect = (groupId: string, optionId: string) => {
    const next = resolveSelection(recipe, { ...selection, [groupId]: optionId });
    setSelection(next);
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void update({ ingredientGroups: applySelectionToGroups(recipe.ingredientGroups ?? [], next) as any });
    }, 600);
  };

  const saveServings = async () => {
    if (current === base) return;
    try {
      await update({ metadata: { ...recipe.metadata, servings: current }, ingredientGroups: scaleGroups(recipe.ingredientGroups ?? [], current / base) as any });
      setServings(null);
      alert('Portionszahl und Zutatenmengen wurden als Standard gespeichert.');
    } catch {
      alert('Fehler beim Speichern. Bitte versuchen Sie es erneut.');
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      {tabs.length > 0 && (
        <div className="mb-4">
          <div className="mb-4 hidden border-b border-gray-200 md:flex dark:border-gray-700">
            {tabs.map((t) => (
              <Link
                key={t.id}
                to={`/rezept/${t.id}`}
                className={
                  '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ' +
                  (recipe.id === t.id
                    ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200')
                }
              >
                {t.label}
              </Link>
            ))}
          </div>
          <div className="mb-4 md:hidden">
            <label htmlFor="variant-select" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Variante auswählen</label>
            <select
              id="variant-select"
              value={recipe.id}
              onChange={(e) => navigate(`/rezept/${e.target.value}`)}
              className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            >
              {tabs.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <RecipeHeader
        recipe={recipe}
        servings={current}
        lowBandwidth={lowBandwidth}
        showFavorite={hasAlias}
        favorited={favorited}
        onToggleFavorite={() => {
          toggleFamilyFavorite(familyIds);
          setFavTick((n) => n + 1);
        }}
        onExportJson={() => exportRecipeJson(recipe)}
        onExportRcb={() => exportRecipesRcb([recipe.id]).catch(() => alert('Der vollständige Export (mit Bildern) braucht eine Verbindung zum Server.'))}
        onAddToShopping={() => setShowAddToList(true)}
        onServings={(n) => setServings(Math.max(1, Math.min(99, n)))}
        onSaveServings={saveServings}
        footer={
          /* App-only: sync opt-out for this recipe. */
          <label className="mt-4 flex cursor-pointer items-center gap-2 border-t border-gray-200 pt-3 text-xs text-gray-500 dark:border-gray-600 dark:text-gray-400" title="Private Rezepte bleiben nur auf diesem Gerät und werden nicht mit dem Server geteilt.">
            <input
              type="checkbox"
              checked={!!recipe.isPrivate}
              onChange={async () => {
                await setLocalRecipePrivate(recipe.id, !recipe.isPrivate);
                afterLocalWrite();
              }}
              className="h-4 w-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
            />
            <span>🔒 Privat – nur auf diesem Gerät, nicht mit dem Server teilen</span>
          </label>
        }
      />

      <div className="space-y-6">
        <RecipeTags recipe={recipe} onAddTag={(tags) => update({ tags })} />
        <LiveNutritionPanel recipe={recipe} onOpenCatalogue={setCatalogueFor} refreshKey={nutritionKey} />
        <RecipeImageGallery
          recipe={recipe}
          hidden={lowBandwidth}
          onChanged={() => {
            // Uploads/deletes happen on the server → pull them into the replica.
            runSync()
              .catch(() => {})
              .finally(() => queryClient.invalidateQueries());
          }}
          onAddByUrl={async (img: RecipeImage) => {
            const images = [...(recipe.images ?? []), img];
            await update({ images, imageUrl: recipe.imageUrl || img.url } as any);
          }}
        />
        <div className="grid-two-cols">
          <IngredientsList recipe={recipe} selection={selection} scale={scale} onSelect={onSelect} onCatalogue={setCatalogueFor} />
          <PreparationSteps recipe={recipe} selection={selection} scale={scale} />
        </div>
      </div>

      {/* FAB: KI-Chat zu diesem Rezept */}
      {!showChat && (
        <button
          type="button"
          onClick={() => setShowChat(true)}
          className="recipe-ai-chat-fab fixed bottom-6 right-6 z-[80] flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg transition-all hover:bg-indigo-700 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
          aria-label="KI-Chat zu diesem Rezept öffnen"
        >
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        </button>
      )}

      {showChat && (
        <AIChatModal referencedRecipes={[{ id: recipe.id, title: recipe.title, imageUrl: recipe.images?.[0]?.url ?? recipe.imageUrl ?? undefined }]} onClose={() => setShowChat(false)} />
      )}
      {showAddToList && <AddToShoppingListModal recipeIds={[recipe.id]} recipeServingsById={servings ? { [recipe.id]: current } : undefined} onClose={() => setShowAddToList(false)} />}
      {catalogueFor && (
        <CatalogueModal
          name={catalogueFor}
          onClose={() => setCatalogueFor(null)}
          onSaved={() => {
            setNutritionKey((k) => k + 1);
            afterLocalWrite();
          }}
        />
      )}
    </div>
  );
}

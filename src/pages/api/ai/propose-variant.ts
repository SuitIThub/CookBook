import type { APIRoute } from 'astro';
import { db } from '../../../lib/database.server';
import {
  ollamaProposeVariant,
  ollamaProposeVariantFromMessage,
  type AIRequestConfig,
  type ChatMessage,
} from '../../../lib/ai';
import { createDraftToken } from '../../../lib/draftVariantStore';
import { recipeToMarkdown } from '../../../lib/recipeMarkdown';
import type { Recipe } from '../../../types/recipe';
import { ensureId, sanitizeRecipeData } from '../../../lib/aiRecipeSanitize';

function getOriginalUnit(
  original: Recipe,
  groupIndex: number,
  ingIndex: number,
  ingName?: string
): string {
  const group = original.ingredientGroups?.[groupIndex];
  if (!group || !Array.isArray(group.ingredients)) return '';
  const items = group.ingredients as { name?: string; quantities?: { unit?: string }[] }[];
  const orig = items[ingIndex];
  if (orig?.quantities?.[0]?.unit) return String(orig.quantities[0].unit);
  if (ingName) {
    const byName = items.find((i) => (i.name || '').trim() === (ingName || '').trim());
    if (byName?.quantities?.[0]?.unit) return String(byName.quantities[0].unit);
  }
  return '';
}

function repairRecipeDataFromOriginal(
  original: Recipe,
  sanitized: Record<string, unknown>
): Record<string, unknown> {
  const repaired = { ...sanitized };

  if (
    repaired.description === undefined ||
    repaired.description === null ||
    (typeof repaired.description === 'string' && !(repaired.description as string).trim())
  ) {
    repaired.description = original.description ?? '';
  }

  if (
    repaired.subtitle === undefined ||
    repaired.subtitle === null ||
    (typeof repaired.subtitle === 'string' && !(repaired.subtitle as string).trim())
  ) {
    repaired.subtitle = original.subtitle ?? undefined;
  }

  if (!Array.isArray(repaired.tags) || repaired.tags.length === 0) {
    repaired.tags = original.tags?.length ? [...original.tags] : undefined;
  }

  if (
    repaired.category === undefined ||
    repaired.category === null ||
    (typeof repaired.category === 'string' && !(repaired.category as string).trim())
  ) {
    repaired.category = original.category ?? undefined;
  }

  repaired.images = original.images?.length ? original.images : undefined;
  repaired.imageUrl = original.imageUrl ?? undefined;

  const origPrep = original.preparationGroups || [];
  let aiPrep = (repaired.preparationGroups as Record<string, unknown>[]) || [];
  if (origPrep.length > 0 && aiPrep.length < origPrep.length) {
    const missing = origPrep.slice(aiPrep.length).map((g: unknown) => {
      const gr = (g && typeof g === 'object' ? g : {}) as Record<string, unknown>;
      const steps = (Array.isArray(gr.steps) ? gr.steps : []) as Record<string, unknown>[];
      return {
        id: ensureId(gr.id),
        title: typeof gr.title === 'string' ? gr.title : undefined,
        steps: steps.map((s: unknown) => {
          const step = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
          return {
            id: ensureId(step.id),
            text: typeof step.text === 'string' ? step.text : '',
            linkedIngredients: Array.isArray(step.linkedIngredients) ? step.linkedIngredients : [],
            intermediateIngredients: Array.isArray(step.intermediateIngredients) ? step.intermediateIngredients : [],
          };
        }),
      };
    });
    aiPrep = [...aiPrep, ...missing];
    repaired.preparationGroups = aiPrep;
  }
  if (origPrep.length > 0 && aiPrep.length > 0) {
    repaired.preparationGroups = aiPrep.map((aiGroup, gIdx) => {
      const origGroup = origPrep[gIdx] as { steps?: unknown[] };
      const origSteps = origGroup?.steps || [];
      const aiSteps = (Array.isArray((aiGroup as Record<string, unknown>).steps)
        ? (aiGroup as Record<string, unknown>).steps
        : []) as Record<string, unknown>[];
      const mergedSteps =
        aiSteps.length >= origSteps.length
          ? aiSteps
          : [
              ...aiSteps,
              ...origSteps.slice(aiSteps.length).map((s: unknown) => {
                const step = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
                return {
                  id: ensureId(step.id),
                  text: typeof step.text === 'string' ? step.text : '',
                  linkedIngredients: Array.isArray(step.linkedIngredients) ? step.linkedIngredients : [],
                  intermediateIngredients: Array.isArray(step.intermediateIngredients) ? step.intermediateIngredients : [],
                };
              }),
            ];
      return {
        ...aiGroup,
        steps: mergedSteps.map((step) => ({
          id: (step as Record<string, unknown>).id ?? ensureId(undefined),
          text: (step as Record<string, unknown>).text ?? '',
          linkedIngredients: Array.isArray((step as Record<string, unknown>).linkedIngredients)
            ? (step as Record<string, unknown>).linkedIngredients
            : [],
          intermediateIngredients: Array.isArray((step as Record<string, unknown>).intermediateIngredients)
            ? (step as Record<string, unknown>).intermediateIngredients
            : [],
        })),
      };
    });
  }

  const origIng = original.ingredientGroups || [];
  let aiIng = (repaired.ingredientGroups as Record<string, unknown>[]) || [];
  if (origIng.length > 0 && aiIng.length < origIng.length) {
    const missingIng = origIng.slice(aiIng.length).map((g: unknown) => {
      const gr = (g && typeof g === 'object' ? g : {}) as Record<string, unknown>;
      const ings = (Array.isArray(gr.ingredients) ? gr.ingredients : []) as Record<string, unknown>[];
      return {
        id: ensureId(gr.id),
        title: typeof gr.title === 'string' ? gr.title : undefined,
        ingredients: ings.map((i: unknown) => {
          const ing = (i && typeof i === 'object' ? i : {}) as Record<string, unknown>;
          const qs = Array.isArray(ing.quantities) ? ing.quantities : [];
          return {
            id: ensureId(ing.id),
            name: typeof ing.name === 'string' ? ing.name : '',
            description: typeof ing.description === 'string' ? ing.description : undefined,
            quantities: qs.map((q: unknown) => {
              const qq = (q && typeof q === 'object' ? q : {}) as Record<string, unknown>;
              return { amount: typeof qq.amount === 'number' ? qq.amount : 0, unit: typeof qq.unit === 'string' ? qq.unit : '' };
            }),
          };
        }),
      };
    });
    aiIng = [...aiIng, ...missingIng];
    repaired.ingredientGroups = aiIng;
  }
  if (origIng.length > 0 && aiIng.length > 0) {
    repaired.ingredientGroups = aiIng.map((aiGroup, gIdx) => {
      const ingredients = (Array.isArray((aiGroup as Record<string, unknown>).ingredients)
        ? (aiGroup as Record<string, unknown>).ingredients
        : []) as Record<string, unknown>[];
      const newIngredients = ingredients.map((item, ingIdx) => {
        const qtyList = Array.isArray(item.quantities) ? item.quantities : [];
        const first = qtyList[0];
        const qq = (first && typeof first === 'object' ? first : {}) as Record<string, unknown>;
        let unit = typeof qq.unit === 'string' ? qq.unit : '';
        if (!unit) {
          unit = getOriginalUnit(original, gIdx, ingIdx, item.name as string) || '';
        }
        const singleQuantity = {
          amount: typeof qq.amount === 'number' ? qq.amount : 0,
          unit: unit || '',
        };
        return { ...item, quantities: [singleQuantity] };
      });
      return { ...aiGroup, ingredients: newIngredients };
    });
  }

  return repaired;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { recipeId, targetRecipeId, recipeIds, messages, variantMessage, preview, provider, model, openRouterApiKey } = body as {
      recipeId?: string;
      targetRecipeId?: string;
      recipeIds?: string[];
      messages?: ChatMessage[];
      variantMessage?: string;
      preview?: boolean;
      provider?: AIRequestConfig['provider'];
      model?: string;
      openRouterApiKey?: string;
    };

    const validContextIds = Array.isArray(recipeIds)
      ? recipeIds.filter((id) => typeof id === 'string' && id && id !== '__all_recipes__' && !!db.getRecipe(id))
      : [];
    const fallbackContextId = typeof recipeId === 'string' && recipeId && recipeId !== '__all_recipes__' && db.getRecipe(recipeId)
      ? recipeId
      : (validContextIds[0] || null);

    const idsToLoad = fallbackContextId
      ? [fallbackContextId, ...validContextIds.filter((id) => id !== fallbackContextId)]
      : [];

    const markdownParts: string[] = [];
    for (let i = 0; i < idsToLoad.length; i++) {
      const id = idsToLoad[i]!;
      const r = db.getRecipe(id);
      const title = r?.title ?? 'Rezept';
      const md = r ? recipeToMarkdown(r) : '';
      const label =
        i === 0
          ? `ORIGINAL RECIPE (Referenz – ${title})`
          : `REFERENCED RECIPE ${i}: ${title}`;
      markdownParts.push(`--- ${label} ---\n${md}`);
    }
    const recipeContext = markdownParts.join('\n\n');

    const targetRecipe =
      typeof targetRecipeId === 'string' && targetRecipeId.trim()
        ? db.getRecipe(targetRecipeId.trim())
        : null;
    if (targetRecipeId && !targetRecipe) {
      return new Response(JSON.stringify({ error: 'Target recipe not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!targetRecipe && !fallbackContextId && !(typeof variantMessage === 'string' && variantMessage.trim() !== '')) {
      return new Response(JSON.stringify({ error: 'Recipe context missing for variant generation' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const rootOriginalId = targetRecipe ? (targetRecipe.parentRecipeId || targetRecipe.id) : null;
    const aiConfig: AIRequestConfig = {
      provider,
      model,
      openRouterApiKey,
    };

    const proposed =
      typeof variantMessage === 'string' && variantMessage.trim() !== ''
        ? await ollamaProposeVariantFromMessage(recipeContext, variantMessage.trim(), aiConfig)
        : await ollamaProposeVariant(
            recipeContext,
            (messages?.length ?? 0) > 0
              ? 'Der Nutzer hat sich im Chat über das Rezept unterhalten. Leite die gewünschten Änderungen aus dem Verlauf ab.'
              : 'Der Nutzer möchte eine Variante ohne spezifischen Chat-Kontext. Erstelle eine sinnvolle Variante (z.B. andere Portionen, kleine Anpassungen).',
            messages ?? [],
            aiConfig
          );

    const rawName =
      typeof proposed.variantName === 'string' && proposed.variantName.trim() !== ''
        ? proposed.variantName.trim()
        : 'KI-Variante';
    const trimmedVariantName = rawName.split(/\s+/).slice(0, 3).join(' ') || rawName;

    let recipeData = sanitizeRecipeData(proposed.recipeData as Record<string, unknown>);
    if (targetRecipe) {
      recipeData = repairRecipeDataFromOriginal(targetRecipe, recipeData) as Record<string, unknown>;
    }
    const variantRecipeData = targetRecipe
      ? {
          ...recipeData,
          parentRecipeId: rootOriginalId,
          variantName: trimmedVariantName,
        }
      : {
          ...recipeData,
          parentRecipeId: undefined,
          variantName: undefined,
        };

    if (preview === true) {
      if (!targetRecipe) {
        const newRecipe = db.createRecipe(variantRecipeData as Parameters<typeof db.createRecipe>[0]);
        return new Response(
          JSON.stringify({
            preview: true,
            mode: 'new_recipe',
            recipeId: newRecipe.id,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      const token = createDraftToken({
        parentRecipeId: rootOriginalId,
        variantName: trimmedVariantName,
        recipeData: variantRecipeData as Record<string, unknown>,
      });
      return new Response(
        JSON.stringify({
          preview: true,
          mode: 'variant',
          token,
          parentRecipeId: rootOriginalId,
          variantName: trimmedVariantName,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const newVariant = db.createRecipe(variantRecipeData as Parameters<typeof db.createRecipe>[0]);

    return new Response(JSON.stringify(newVariant), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('AI propose-variant error:', err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Variant creation failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

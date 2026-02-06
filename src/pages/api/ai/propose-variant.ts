import type { APIRoute } from 'astro';
import { db } from '../../../lib/database';
import { ollamaProposeVariant, ollamaProposeVariantFromMessage, type ChatMessage } from '../../../lib/ai';
import { createDraftToken } from '../../../lib/draftVariantStore';
import type { Recipe } from '../../../types/recipe';

function ensureId(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value;
  return crypto.randomUUID();
}

function sanitizeRecipeData(raw: Record<string, unknown>): Record<string, unknown> {
  const metadata = (raw.metadata as Record<string, unknown>) || {};
  const ingredientGroups = Array.isArray(raw.ingredientGroups) ? raw.ingredientGroups : [];
  const preparationGroups = Array.isArray(raw.preparationGroups) ? raw.preparationGroups : [];

  const sanitizeIngredient = (item: unknown): Record<string, unknown> => {
    const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const quantities = Array.isArray(o.quantities) ? o.quantities : [];
    const first = quantities[0];
    const qq = (first && typeof first === 'object' ? first : {}) as Record<string, unknown>;
    const singleQuantity = {
      amount: typeof qq.amount === 'number' ? qq.amount : 0,
      unit: typeof qq.unit === 'string' ? qq.unit : '',
    };
    return {
      id: ensureId(o.id),
      name: typeof o.name === 'string' ? o.name : 'Zutat',
      description: typeof o.description === 'string' ? o.description : undefined,
      quantities: [singleQuantity],
    };
  };

  const sanitizeIngredientGroup = (group: unknown): Record<string, unknown> => {
    const g = (group && typeof group === 'object' ? group : {}) as Record<string, unknown>;
    const ingredients = Array.isArray(g.ingredients) ? g.ingredients : [];
    const out: Record<string, unknown> = {
      id: ensureId(g.id),
      title: typeof g.title === 'string' ? g.title : undefined,
      ingredients: ingredients.map((item: unknown) => {
        const i = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        if (Array.isArray(i.ingredients)) {
          return sanitizeIngredientGroup(item);
        }
        return sanitizeIngredient(item);
      }),
    };
    return out;
  };

  const sanitizeStep = (step: unknown): Record<string, unknown> => {
    const s = (step && typeof step === 'object' ? step : {}) as Record<string, unknown>;
    return {
      id: ensureId(s.id),
      text: typeof s.text === 'string' ? s.text : '',
      linkedIngredients: Array.isArray(s.linkedIngredients) ? s.linkedIngredients : [],
      intermediateIngredients: Array.isArray(s.intermediateIngredients) ? s.intermediateIngredients : [],
    };
  };

  const sanitizePreparationGroup = (group: unknown): Record<string, unknown> => {
    const g = (group && typeof group === 'object' ? group : {}) as Record<string, unknown>;
    const steps = Array.isArray(g.steps) ? g.steps : [];
    return {
      id: ensureId(g.id),
      title: typeof g.title === 'string' ? g.title : undefined,
      steps: steps.map((s: unknown) => {
        const ss = s && typeof s === 'object' ? s as Record<string, unknown> : {};
        if (Array.isArray(ss.steps)) return sanitizePreparationGroup(s);
        return sanitizeStep(s);
      }),
    };
  };

  const timeEntries = Array.isArray(metadata.timeEntries) ? metadata.timeEntries : [];
  const sanitizedMetadata = {
    servings: typeof metadata.servings === 'number' && metadata.servings > 0 ? metadata.servings : 4,
    timeEntries: timeEntries.map((e: unknown) => {
      const ee = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
      return {
        id: ensureId(ee.id),
        label: typeof ee.label === 'string' ? ee.label : 'Zeit',
        minutes: typeof ee.minutes === 'number' ? ee.minutes : 0,
      };
    }),
    difficulty: metadata.difficulty === 'leicht' || metadata.difficulty === 'mittel' || metadata.difficulty === 'schwer' ? metadata.difficulty : undefined,
    nutrition: metadata.nutrition && typeof metadata.nutrition === 'object' ? metadata.nutrition : undefined,
  };

  return {
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Neue Variante',
    subtitle: typeof raw.subtitle === 'string' ? raw.subtitle : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    metadata: sanitizedMetadata,
    category: typeof raw.category === 'string' ? raw.category : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : undefined,
    ingredientGroups: ingredientGroups.length > 0
      ? ingredientGroups.map(sanitizeIngredientGroup)
      : [{ id: crypto.randomUUID(), title: '', ingredients: [] }],
    preparationGroups: preparationGroups.length > 0
      ? preparationGroups.map(sanitizePreparationGroup)
      : [{ id: crypto.randomUUID(), title: '', steps: [] }],
    sourceUrl: typeof raw.sourceUrl === 'string' && raw.sourceUrl.trim() ? raw.sourceUrl.trim() : undefined,
  };
}

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
    const { recipeId, recipeIds, messages, variantMessage, preview } = body as {
      recipeId?: string;
      recipeIds?: string[];
      messages?: ChatMessage[];
      variantMessage?: string;
      preview?: boolean;
    };

    if (!recipeId) {
      return new Response(JSON.stringify({ error: 'recipeId required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const recipe = db.getRecipe(recipeId);
    if (!recipe) {
      return new Response(JSON.stringify({ error: 'Recipe not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const origin = new URL(request.url).origin;
    const idsToLoad =
      Array.isArray(recipeIds) && recipeIds.length > 0
        ? [recipeId, ...recipeIds.filter((id: string) => id && id !== recipeId)]
        : [recipeId];

    const markdownParts: string[] = [];
    for (let i = 0; i < idsToLoad.length; i++) {
      const id = idsToLoad[i]!;
      const r = db.getRecipe(id);
      const title = r?.title ?? 'Rezept';
      const markdownRes = await fetch(
        `${origin}/api/recipes/markdown?id=${encodeURIComponent(id)}`
      );
      const md = markdownRes.ok ? await markdownRes.text() : '';
      const label =
        i === 0
          ? `ORIGINAL RECIPE (Referenz – ${title})`
          : `REFERENCED RECIPE ${i}: ${title}`;
      markdownParts.push(`--- ${label} ---\n${md}`);
    }
    const recipeContext = markdownParts.join('\n\n');

    const rootOriginalId = recipe.parentRecipeId || recipe.id;

    const proposed =
      typeof variantMessage === 'string' && variantMessage.trim() !== ''
        ? await ollamaProposeVariantFromMessage(recipeContext, variantMessage.trim())
        : await ollamaProposeVariant(
            recipeContext,
            (messages?.length ?? 0) > 0
              ? 'Der Nutzer hat sich im Chat über das Rezept unterhalten. Leite die gewünschten Änderungen aus dem Verlauf ab.'
              : 'Der Nutzer möchte eine Variante ohne spezifischen Chat-Kontext. Erstelle eine sinnvolle Variante (z.B. andere Portionen, kleine Anpassungen).',
            messages ?? []
          );

    const rawName =
      typeof proposed.variantName === 'string' && proposed.variantName.trim() !== ''
        ? proposed.variantName.trim()
        : 'KI-Variante';
    const trimmedVariantName = rawName.split(/\s+/).slice(0, 3).join(' ') || rawName;

    let recipeData = sanitizeRecipeData(proposed.recipeData as Record<string, unknown>);
    recipeData = repairRecipeDataFromOriginal(recipe, recipeData) as Record<string, unknown>;
    const variantRecipeData = {
      ...recipeData,
      parentRecipeId: rootOriginalId,
      variantName: trimmedVariantName,
    };

    if (preview === true) {
      const token = createDraftToken({
        parentRecipeId: rootOriginalId,
        variantName: trimmedVariantName,
        recipeData: variantRecipeData as Record<string, unknown>,
      });
      return new Response(
        JSON.stringify({
          preview: true,
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

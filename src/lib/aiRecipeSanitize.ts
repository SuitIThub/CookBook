/**
 * Normalise recipe JSON produced by an LLM into the shape the cookbook stores
 * (ids everywhere, exactly one quantity per ingredient, sane metadata).
 * Shared by AI variant drafts and the reel import.
 */
export function ensureId(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value;
  return crypto.randomUUID();
}

export function sanitizeRecipeData(raw: Record<string, unknown>, fallbackTitle = 'Neue Variante'): Record<string, unknown> {
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
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : fallbackTitle,
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

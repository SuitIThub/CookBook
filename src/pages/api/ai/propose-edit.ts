import type { APIRoute } from 'astro';
import { db } from '../../../lib/database';
import { openRouterChat, type AIRequestConfig } from '../../../lib/ai';
import { createAiEditPreviewToken } from '../../../lib/aiRecipeEditPreviewStore';
import type { Recipe } from '../../../types/recipe';

interface ProposedEditPayload {
  recipeData?: Partial<Recipe>;
  highlights?: Array<{ path?: string; before?: string; after?: string }>;
}

type EditRegion =
  | 'title'
  | 'subtitle'
  | 'description'
  | 'metadata.servings'
  | 'metadata.timeEntries'
  | 'metadata.nutrition'
  | 'category'
  | 'tags'
  | 'ingredientGroups'
  | 'preparationGroups';

const ALL_EDIT_REGIONS: EditRegion[] = [
  'title',
  'subtitle',
  'description',
  'metadata.servings',
  'metadata.timeEntries',
  'metadata.nutrition',
  'category',
  'tags',
  'ingredientGroups',
  'preparationGroups',
];

function getProvider(config?: AIRequestConfig): 'ollama' | 'openrouter' {
  return config?.provider === 'openrouter' ? 'openrouter' : 'ollama';
}

function getOllamaBase(): string {
  const base = import.meta.env.OLLAMA_BASE_URL;
  if (!base || typeof base !== 'string' || base.trim() === '') {
    throw new Error('OLLAMA_BASE_URL is not set or empty');
  }
  return base.replace(/\/$/, '');
}

function getOllamaModel(config?: AIRequestConfig): string {
  const custom = typeof config?.model === 'string' ? config.model.trim() : '';
  if (custom) return custom;
  const envModel = import.meta.env.OLLAMA_MODEL;
  if (!envModel || typeof envModel !== 'string' || envModel.trim() === '') {
    throw new Error('OLLAMA_MODEL is not set or empty');
  }
  return envModel.trim();
}

function normalizeRegions(input: unknown): EditRegion[] {
  const list = Array.isArray(input) ? input : [];
  const normalized = list
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v): v is EditRegion => ALL_EDIT_REGIONS.includes(v as EditRegion));
  return normalized.length > 0 ? Array.from(new Set(normalized)) : [];
}

function buildStructuredEditSchema(regions: EditRegion[]) {
  const active = regions.length > 0 ? regions : ALL_EDIT_REGIONS;
  const has = (r: EditRegion) => active.includes(r);
  const recipeDataProps: Record<string, unknown> = {};
  if (has('title')) recipeDataProps.title = { type: 'string' };
  if (has('subtitle')) recipeDataProps.subtitle = { type: 'string' };
  if (has('description')) recipeDataProps.description = { type: 'string' };
  if (has('category')) recipeDataProps.category = { type: 'string' };
  if (has('tags')) recipeDataProps.tags = { type: 'array', items: { type: 'string' } };
  if (has('ingredientGroups')) recipeDataProps.ingredientGroups = { type: 'array' };
  if (has('preparationGroups')) recipeDataProps.preparationGroups = { type: 'array' };

  if (has('metadata.servings') || has('metadata.timeEntries') || has('metadata.nutrition')) {
    const metadataProps: Record<string, unknown> = {};
    if (has('metadata.servings')) metadataProps.servings = { type: 'number' };
    if (has('metadata.timeEntries')) {
      metadataProps.timeEntries = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            minutes: { type: 'number' },
          },
          required: ['label', 'minutes'],
        },
      };
    }
    if (has('metadata.nutrition')) {
      metadataProps.nutrition = {
        type: 'object',
        properties: {
          calories: { type: 'number' },
          carbohydrates: { type: 'number' },
          protein: { type: 'number' },
          fat: { type: 'number' },
          energyKcal: { type: 'number' },
          proteinG: { type: 'number' },
          fatG: { type: 'number' },
          carbohydratesG: { type: 'number' },
        },
      };
    }
    recipeDataProps.metadata = { type: 'object', properties: metadataProps };
  }

  return {
    type: 'object',
    properties: {
      recipeData: { type: 'object', properties: recipeDataProps, additionalProperties: true },
      highlights: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            before: { type: 'string' },
            after: { type: 'string' },
          },
          required: ['path', 'before', 'after'],
        },
      },
    },
    required: ['recipeData', 'highlights'],
    additionalProperties: false,
  } as const;
}

function ensureId(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : crypto.randomUUID();
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value.replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeNutritionObject(value: unknown): Recipe['metadata']['nutrition'] | undefined {
  let candidate: unknown = value;
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        candidate = JSON.parse(trimmed);
      } catch {
        candidate = value;
      }
    }
  }
  if (!candidate || typeof candidate !== 'object') return undefined;
  const obj = candidate as Record<string, unknown>;
  const byKey = (keys: string[]) => {
    for (const key of keys) {
      if (key in obj) return toNumberOrUndefined(obj[key]);
    }
    return undefined;
  };
  const nutrition = {
    calories: byKey(['calories', 'kcal', 'energie', 'energy', 'energyKcal', 'caloriesKcal']),
    carbohydrates: byKey(['carbohydrates', 'kohlenhydrate', 'carbs', 'carbohydratesG', 'carbsG']),
    protein: byKey(['protein', 'eiweiss', 'eiweiß', 'proteinG']),
    fat: byKey(['fat', 'fett', 'fatG']),
  };
  if (
    nutrition.calories === undefined &&
    nutrition.carbohydrates === undefined &&
    nutrition.protein === undefined &&
    nutrition.fat === undefined
  ) {
    return undefined;
  }
  return nutrition;
}

function inferEditIntent(editMessage: string) {
  const text = editMessage.toLowerCase();
  return {
    touchesNutrition: /(nährwert|naehrwert|kalorien|kcal|eiweiß|eiweiss|protein|kohlenhydrat|fett)/i.test(text),
    touchesTimes: /(zeit|zeiten|kochzeit|backzeit|vorbereitung)/i.test(text),
    touchesIngredients: /(zutat|zutaten|menge|mengen|ingredient)/i.test(text),
    touchesPreparation: /(zubereitung|schritt|schritte|prep|preparation)/i.test(text),
    touchesMetaText: /(titel|untertitel|beschreibung|kategorie|tag|portion)/i.test(text),
  };
}

function sanitizeTimeEntries(value: unknown, fallback: Recipe['metadata']['timeEntries']) {
  if (!Array.isArray(value)) return fallback;
  const entries = value
    .map((entry) => {
      const e = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
      if (!e) return null;
      return {
        id: ensureId(e.id),
        label: typeof e.label === 'string' && e.label.trim() ? e.label.trim() : 'Zeit',
        minutes: toNumberOrUndefined(e.minutes) ?? 0,
      };
    })
    .filter(Boolean) as Recipe['metadata']['timeEntries'];
  return entries.length > 0 ? entries : fallback;
}

function sanitizeIngredientNode(node: unknown): any {
  if (typeof node === 'string') {
    return {
      id: ensureId(undefined),
      name: node.trim() || 'Zutat',
      quantities: [{ amount: 0, unit: '' }],
    };
  }
  if (!node || typeof node !== 'object') {
    return {
      id: ensureId(undefined),
      name: 'Zutat',
      quantities: [{ amount: 0, unit: '' }],
    };
  }
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj.ingredients)) {
    return {
      id: ensureId(obj.id),
      title: typeof obj.title === 'string' ? obj.title : undefined,
      ingredients: obj.ingredients.map((item) => sanitizeIngredientNode(item)),
    };
  }
  const firstQ = Array.isArray(obj.quantities) ? obj.quantities[0] : null;
  const q = firstQ && typeof firstQ === 'object' ? (firstQ as Record<string, unknown>) : {};
  return {
    id: ensureId(obj.id),
    name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : 'Zutat',
    description: typeof obj.description === 'string' ? obj.description : undefined,
    quantities: [
      {
        amount: toNumberOrUndefined(q.amount) ?? 0,
        unit: typeof q.unit === 'string' ? q.unit : '',
      },
    ],
  };
}

function sanitizeIngredientGroups(value: unknown, fallback: Recipe['ingredientGroups']) {
  if (!Array.isArray(value)) return fallback;
  const groups = value
    .map((group) => {
      const g = group && typeof group === 'object' ? (group as Record<string, unknown>) : null;
      if (!g) return null;
      return {
        id: ensureId(g.id),
        title: typeof g.title === 'string' ? g.title : undefined,
        ingredients: Array.isArray(g.ingredients) ? g.ingredients.map((item) => sanitizeIngredientNode(item)) : [],
      };
    })
    .filter(Boolean) as Recipe['ingredientGroups'];
  return groups.length > 0 ? groups : fallback;
}

function sanitizePreparationNode(node: unknown): any {
  if (typeof node === 'string') {
    return {
      id: ensureId(undefined),
      text: node,
      linkedIngredients: [],
      intermediateIngredients: [],
    };
  }
  if (!node || typeof node !== 'object') {
    return {
      id: ensureId(undefined),
      text: '',
      linkedIngredients: [],
      intermediateIngredients: [],
    };
  }
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj.steps) && !('text' in obj)) {
    return {
      id: ensureId(obj.id),
      title: typeof obj.title === 'string' ? obj.title : undefined,
      steps: obj.steps.map((step) => sanitizePreparationNode(step)),
    };
  }
  return {
    id: ensureId(obj.id),
    text: typeof obj.text === 'string' ? obj.text : '',
    linkedIngredients: Array.isArray(obj.linkedIngredients) ? obj.linkedIngredients : [],
    intermediateIngredients: Array.isArray(obj.intermediateIngredients) ? obj.intermediateIngredients : [],
  };
}

function sanitizePreparationGroups(value: unknown, fallback: Recipe['preparationGroups']) {
  if (!Array.isArray(value)) return fallback;
  const raw = value as unknown[];
  if (raw.length > 0 && raw.every((item) => typeof item === 'string')) {
    return [
      {
        id: ensureId(undefined),
        title: undefined,
        steps: raw.map((step) => sanitizePreparationNode(step)),
      },
    ] as Recipe['preparationGroups'];
  }
  const groups = raw
    .map((group) => {
      const g = group && typeof group === 'object' ? (group as Record<string, unknown>) : null;
      if (!g) return null;
      return {
        id: ensureId(g.id),
        title: typeof g.title === 'string' ? g.title : undefined,
        steps: Array.isArray(g.steps) ? g.steps.map((step) => sanitizePreparationNode(step)) : [],
      };
    })
    .filter(Boolean) as Recipe['preparationGroups'];
  return groups.length > 0 ? groups : fallback;
}

function extractJsonObject(raw: string): string {
  const text = raw.trim();
  if (!text) return text;
  const codeFenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeFenceMatch?.[1]) return codeFenceMatch[1].trim();

  const start = text.indexOf('{');
  if (start === -1) return text;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1).trim();
      }
    }
  }
  return text;
}

function normalizeRecipeData(
  original: Recipe,
  candidate: Partial<Recipe> | undefined,
  editMessage: string,
  markerRegions: EditRegion[]
): Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'> {
  const data = candidate && typeof candidate === 'object' ? candidate : {};
  const intent = inferEditIntent(editMessage);
  const nutritionCandidate =
    data.metadata?.nutrition && typeof data.metadata.nutrition === 'object'
      ? (data.metadata.nutrition as Record<string, unknown>)
      : null;
  const mappedNutrition = normalizeNutritionObject(nutritionCandidate);
  const sanitizedNutrition = mappedNutrition ?? original.metadata.nutrition;
  const hasRegion = (region: EditRegion) => markerRegions.includes(region);
  const useRegionGating = markerRegions.length > 0;
  const canUpdateIngredients = useRegionGating ? hasRegion('ingredientGroups') : intent.touchesIngredients;
  const canUpdatePreparation = useRegionGating ? hasRegion('preparationGroups') : intent.touchesPreparation;
  const canUpdateTimes = useRegionGating ? hasRegion('metadata.timeEntries') : intent.touchesTimes;
  const canUpdateNutrition = useRegionGating ? hasRegion('metadata.nutrition') : intent.touchesNutrition;
  const canUpdateMetaText = useRegionGating
    ? hasRegion('title') ||
      hasRegion('subtitle') ||
      hasRegion('description') ||
      hasRegion('metadata.servings') ||
      hasRegion('category') ||
      hasRegion('tags')
    : intent.touchesMetaText;
  return {
    title:
      canUpdateMetaText && typeof data.title === 'string' && data.title.trim()
        ? data.title.trim()
        : original.title,
    subtitle:
      canUpdateMetaText && typeof data.subtitle === 'string' ? data.subtitle : original.subtitle,
    description:
      canUpdateMetaText && typeof data.description === 'string'
        ? data.description
        : original.description,
    metadata:
      data.metadata && typeof data.metadata === 'object'
        ? {
            servings:
              canUpdateMetaText && typeof data.metadata.servings === 'number' && data.metadata.servings > 0
                ? data.metadata.servings
                : original.metadata.servings,
            timeEntries: canUpdateTimes && Array.isArray(data.metadata.timeEntries)
              ? sanitizeTimeEntries(data.metadata.timeEntries, original.metadata.timeEntries)
              : original.metadata.timeEntries,
            difficulty:
              canUpdateMetaText &&
              (data.metadata.difficulty === 'leicht' ||
              data.metadata.difficulty === 'mittel' ||
              data.metadata.difficulty === 'schwer')
                ? data.metadata.difficulty
                : original.metadata.difficulty,
            nutrition: canUpdateNutrition ? sanitizedNutrition : original.metadata.nutrition,
          }
        : original.metadata,
    category:
      canUpdateMetaText && typeof data.category === 'string' ? data.category : original.category,
    tags:
      canUpdateMetaText && Array.isArray(data.tags)
        ? data.tags.filter((t): t is string => typeof t === 'string')
        : original.tags,
    ingredientGroups: canUpdateIngredients && Array.isArray(data.ingredientGroups)
      ? sanitizeIngredientGroups(data.ingredientGroups, original.ingredientGroups)
      : original.ingredientGroups,
    preparationGroups: canUpdatePreparation && Array.isArray(data.preparationGroups)
      ? sanitizePreparationGroups(data.preparationGroups, original.preparationGroups)
      : original.preparationGroups,
    imageUrl: original.imageUrl,
    images: original.images,
    sourceUrl: typeof data.sourceUrl === 'string' ? data.sourceUrl : original.sourceUrl,
    parentRecipeId: original.parentRecipeId,
    variantName: original.variantName,
  };
}

function computeFallbackHighlights(original: Recipe, updated: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>) {
  const out: Array<{ path: string; before: string; after: string }> = [];
  if (original.title !== updated.title) {
    out.push({ path: 'title', before: original.title || '', after: updated.title || '' });
  }
  if ((original.subtitle || '') !== (updated.subtitle || '')) {
    out.push({ path: 'subtitle', before: original.subtitle || '', after: updated.subtitle || '' });
  }
  if ((original.description || '') !== (updated.description || '')) {
    out.push({ path: 'description', before: original.description || '', after: updated.description || '' });
  }
  if (JSON.stringify(original.metadata.timeEntries || []) !== JSON.stringify(updated.metadata.timeEntries || [])) {
    out.push({
      path: 'metadata.timeEntries',
      before: `${original.metadata.timeEntries?.length || 0} Einträge`,
      after: `${updated.metadata.timeEntries?.length || 0} Einträge`,
    });
  }
  if (JSON.stringify(original.metadata.nutrition || {}) !== JSON.stringify(updated.metadata.nutrition || {})) {
    out.push({
      path: 'metadata.nutrition',
      before: JSON.stringify(original.metadata.nutrition || {}),
      after: JSON.stringify(updated.metadata.nutrition || {}),
    });
  }
  if (JSON.stringify(original.ingredientGroups || []) !== JSON.stringify(updated.ingredientGroups || [])) {
    out.push({
      path: 'ingredientGroups',
      before: `${original.ingredientGroups?.length || 0} Gruppen`,
      after: `${updated.ingredientGroups?.length || 0} Gruppen`,
    });
  }
  if (JSON.stringify(original.preparationGroups || []) !== JSON.stringify(updated.preparationGroups || [])) {
    out.push({
      path: 'preparationGroups',
      before: `${original.preparationGroups?.length || 0} Gruppen`,
      after: `${updated.preparationGroups?.length || 0} Gruppen`,
    });
  }
  return out;
}

function clipForDebug(raw: string): string {
  const clean = raw.replace(/\s+/g, ' ').trim();
  return clean.length > 280 ? `${clean.slice(0, 280)}...` : clean;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { recipeId, recipeIds, regions, editMessage, provider, model, openRouterApiKey } = body as {
      recipeId?: string;
      recipeIds?: string[];
      regions?: string[];
      editMessage?: string;
      provider?: AIRequestConfig['provider'];
      model?: string;
      openRouterApiKey?: string;
    };

    if (!recipeId || typeof editMessage !== 'string' || !editMessage.trim()) {
      return new Response(JSON.stringify({ error: 'recipeId und editMessage sind erforderlich' }), {
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
      const markdownRes = await fetch(`${origin}/api/recipes/markdown?id=${encodeURIComponent(id)}`);
      const md = markdownRes.ok ? await markdownRes.text() : '';
      const label = i === 0 ? `ORIGINAL RECIPE (${title})` : `REFERENCED RECIPE ${i}: ${title}`;
      markdownParts.push(`--- ${label} ---\n${md}`);
    }

    const prompt = `Du bist ein Assistent für Rezeptbearbeitung.
Antworte NUR mit JSON im Format:
{
  "recipeData": { ...nur geänderte Felder... },
  "highlights": [{ "path": "title", "before": "...", "after": "..." }]
}

Regeln:
- Bearbeite NUR das ERSTE Rezept (ORIGINAL RECIPE). Weitere Rezepte sind nur Referenz.
- recipeData ist ein PATCH: gib NUR Felder aus, die wirklich geändert werden sollen.
- Unveränderte Felder NICHT zurückgeben.
- Wenn nur Nährwerte gefragt sind, ändere ausschließlich metadata.nutrition.
- Zutaten und Zubereitungsschritte nur ändern, wenn der Nutzer das explizit verlangt.
- Keine Erfindungen außerhalb der Nutzeranweisung.
- highlights enthält nur die wichtigsten Änderungen (kurz, nachvollziehbar).

Durch den RECIPE_EDIT-Marker angeforderte Regionen:
${normalizeRegions(regions).length > 0 ? normalizeRegions(regions).join(', ') : 'keine expliziten Regionen'}

Nutzeranweisung:
${editMessage.trim()}

Rezeptkontext:
${markdownParts.join('\n\n')}`;

    const aiConfig: AIRequestConfig = { provider, model, openRouterApiKey };
    const normalizedRegions = normalizeRegions(regions);
    const schema = buildStructuredEditSchema(normalizedRegions);
    let raw = '';
    if (getProvider(aiConfig) === 'openrouter') {
      raw = await openRouterChat(
        [{ role: 'user', content: prompt }],
        aiConfig,
        {
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'recipe_edit_patch',
              strict: true,
              schema,
            },
          },
        }
      );
    } else {
      const res = await fetch(`${getOllamaBase()}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: getOllamaModel(aiConfig),
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          format: schema,
          options: { temperature: 0.2 },
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ollama structured edit failed: ${res.status} ${text}`);
      }
      const data = (await res.json()) as { message?: { content?: string } };
      raw = data.message?.content ?? '';
    }
    const parsedRaw = extractJsonObject(raw);
    let parsed: ProposedEditPayload = {};
    let parseFailed = false;
    try {
      parsed = JSON.parse(parsedRaw) as ProposedEditPayload;
    } catch {
      parsed = {};
      parseFailed = true;
    }

    const normalized = normalizeRecipeData(recipe, parsed.recipeData, editMessage.trim(), normalizedRegions);
    db.saveDraft(recipeId, normalized);

    const aiHighlights = Array.isArray(parsed.highlights)
      ? parsed.highlights
          .filter((h) => h && typeof h.path === 'string')
          .map((h) => ({
            path: String(h.path),
            before: typeof h.before === 'string' ? h.before : '',
            after: typeof h.after === 'string' ? h.after : '',
          }))
      : [];
    const highlights = aiHighlights.length > 0 ? aiHighlights : computeFallbackHighlights(recipe, normalized);
    const hasRecipeDataObject = !!(parsed.recipeData && typeof parsed.recipeData === 'object');
    const diagnostics =
      parseFailed
        ? {
            status: 'parse_failed' as const,
            message: 'Die KI-Antwort konnte nicht als JSON geparst werden. Der Vorschlag wurde daher nicht zuverlässig übernommen.',
            rawExcerpt: clipForDebug(raw),
          }
        : !hasRecipeDataObject
          ? {
              status: 'no_recipe_data' as const,
              message: 'Die KI hat kein recipeData-Objekt geliefert.',
              rawExcerpt: clipForDebug(raw),
            }
          : highlights.length === 0
            ? {
                status: 'no_changes' as const,
                message: 'Es wurden keine tatsächlichen Feldänderungen erkannt.',
                rawExcerpt: clipForDebug(raw),
              }
            : {
                status: 'ok' as const,
                message: 'Änderungen erkannt.',
                rawExcerpt: clipForDebug(raw),
              };
    const token = createAiEditPreviewToken({ recipeId, highlights, diagnostics });

    return new Response(
      JSON.stringify({
        preview: true,
        recipeId,
        token,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('AI propose-edit error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Edit-Vorschlag fehlgeschlagen' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

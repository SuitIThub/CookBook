/**
 * Model catalog for the model pickers (AI settings): every usable model with
 * price, capabilities and a quality signal, plus per-task recommendations.
 *
 * OpenRouter's public model list carries capabilities (input modalities,
 * supported parameters such as structured outputs) and benchmark data
 * (Artificial Analysis "intelligence index"). There is no task-specific
 * benchmark for e.g. receipt reading, so a model counts as recommended for a
 * task when it has the task's required capabilities AND a proven general
 * quality above the task's threshold — all such models, not a top-N.
 */

export type ModelTask = 'chat' | 'structure' | 'vision' | 'matching';

export interface CatalogModel {
  id: string;
  name: string;
  /** Release (epoch seconds), for "neueste" sorting. */
  created: number | null;
  /** USD per 1M tokens. */
  promptPrice: number | null;
  completionPrice: number | null;
  contextLength: number | null;
  image: boolean;
  pdf: boolean;
  structured: boolean;
  /** Artificial Analysis intelligence index (≈ 0–60), null when not benchmarked. */
  intelligence: number | null;
  free: boolean;
  /** Tasks this model is recommended for, with the reason shown in the picker. */
  recommended: Partial<Record<ModelTask, string>>;
}

interface TaskRule {
  label: string;
  needsImage?: boolean;
  needsStructured?: boolean;
  minIntelligence: number;
}

export const TASK_RULES: Record<ModelTask, TaskRule> = {
  chat: { label: 'Chat', minIntelligence: 40 },
  structure: { label: 'Rezepte strukturieren', needsStructured: true, minIntelligence: 30 },
  vision: { label: 'Bilder lesen', needsImage: true, needsStructured: true, minIntelligence: 20 },
  matching: { label: 'Zuordnen', needsStructured: true, minIntelligence: 20 }
};

function recommend(m: Omit<CatalogModel, 'recommended'>): CatalogModel['recommended'] {
  const out: CatalogModel['recommended'] = {};
  for (const [task, rule] of Object.entries(TASK_RULES) as [ModelTask, TaskRule][]) {
    if (rule.needsImage && !m.image) continue;
    if (rule.needsStructured && !m.structured) continue;
    if (m.intelligence == null || m.intelligence < rule.minIntelligence) continue;
    const caps = [rule.needsImage ? 'liest Bilder' : '', rule.needsStructured ? 'zuverlässiges JSON' : ''].filter(Boolean).join(', ');
    out[task] = `${caps ? `${caps}, ` : ''}Qualitätsindex ${Math.round(m.intelligence)} (≥ ${rule.minIntelligence})`;
  }
  return out;
}

const price = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1e6 * 1000) / 1000 : null;
};

let cache: { at: number; models: CatalogModel[] } | null = null;
const TTL_MS = 60 * 60 * 1000;

/** All interactive OpenRouter models (public list, cached for an hour). */
export async function openRouterCatalog(): Promise<CatalogModel[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.models;
  const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`OpenRouter-Modellliste nicht erreichbar (HTTP ${res.status})`);
  const data = (await res.json()) as { data?: any[] };
  const now = Date.now();
  const models = (data.data ?? [])
    .filter((m) => typeof m?.id === 'string' && m.id)
    // ":batch" variants only work through the async batch API.
    .filter((m) => !m.id.endsWith(':batch'))
    .filter((m) => (m.architecture?.output_modalities ?? ['text']).includes('text'))
    .filter((m) => !m.expiration_date || Date.parse(m.expiration_date) > now)
    .map((m) => {
      const inputs: string[] = m.architecture?.input_modalities ?? [];
      const params: string[] = m.supported_parameters ?? [];
      const promptPrice = price(m.pricing?.prompt);
      const completionPrice = price(m.pricing?.completion);
      const base = {
        id: m.id as string,
        name: typeof m.name === 'string' ? m.name : m.id,
        created: typeof m.created === 'number' ? m.created : null,
        promptPrice,
        completionPrice,
        contextLength: typeof m.context_length === 'number' ? m.context_length : null,
        image: inputs.includes('image'),
        pdf: inputs.includes('file'),
        structured: params.includes('structured_outputs') || params.includes('response_format'),
        intelligence: typeof m.benchmarks?.artificial_analysis?.intelligence_index === 'number' ? m.benchmarks.artificial_analysis.intelligence_index : null,
        free: m.id.endsWith(':free') || (promptPrice === 0 && completionPrice === 0)
      };
      return { ...base, recommended: recommend(base) };
    });
  cache = { at: Date.now(), models };
  return models;
}

/** Ollama model families known to accept images. */
const OLLAMA_VISION = /(llava|bakllava|vision|-vl|vl:|qwen2\.5vl|qwen3-vl|minicpm-v|moondream|gemma3|llama4|granite3\.2-vision|mistral-small3\.1)/i;

export function ollamaCatalog(names: string[]): CatalogModel[] {
  return names.map((id) => ({
    id,
    name: id,
    created: null,
    promptPrice: 0,
    completionPrice: 0,
    contextLength: null,
    image: OLLAMA_VISION.test(id),
    pdf: false,
    structured: true, // Ollama enforces JSON schemas via `format`
    intelligence: null,
    free: true,
    recommended: {}
  }));
}

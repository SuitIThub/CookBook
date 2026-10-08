/**
 * Per-task model choice inside the AI settings (`cookbook.ai.settings`):
 * the chat model stays the main setting; recipe structuring, image reading
 * (reel frames, receipts) and matching (ingredients ↔ products, receipt
 * lines) can use their own, typically cheaper/better-suited models.
 * Shared by website, app and server.
 */
export type AiProvider = 'ollama' | 'openrouter';
export type VisionMode = 'openrouter' | 'ollama' | 'ocr' | 'none';

export interface TaskModel {
  provider: AiProvider;
  model: string;
}

export interface AiTaskSettings {
  /** null/undefined → like the chat model. */
  structure?: TaskModel | null;
  vision?: { mode: VisionMode; model?: string };
  /** null → like the chat model. */
  matching?: TaskModel | null;
}

export interface AiSettingsLike {
  provider?: string;
  model?: string;
  openRouterApiKey?: string;
  tasks?: AiTaskSettings;
  /** pre-tasks reel setting (migrated) */
  reelVision?: string;
  reelVisionModel?: string;
}

/** Defaults: the chat model for structuring; Gemini Flash for images; a cheap model for matching. */
export const TASK_DEFAULTS = {
  vision: { mode: 'openrouter' as VisionMode, model: '~google/gemini-flash-latest' },
  matching: { provider: 'openrouter' as AiProvider, model: 'google/gemini-3.5-flash-lite' }
};

const PROVIDERS: AiProvider[] = ['ollama', 'openrouter'];
const VISION_MODES: VisionMode[] = ['openrouter', 'ollama', 'ocr', 'none'];

function taskModel(v: unknown): TaskModel | null | undefined {
  if (v === null) return null;
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  if (!PROVIDERS.includes(o.provider as AiProvider) || typeof o.model !== 'string') return undefined;
  return { provider: o.provider as AiProvider, model: o.model.trim() };
}

/** Task settings with defaults applied (and the old reelVision setting migrated). */
export function resolveTasks(s: AiSettingsLike | null | undefined): Required<{ structure: TaskModel | null; vision: { mode: VisionMode; model: string }; matching: TaskModel | null }> {
  const t = (s?.tasks ?? {}) as AiTaskSettings;
  let vision = t.vision && VISION_MODES.includes(t.vision.mode) ? { mode: t.vision.mode, model: (t.vision.model ?? '').trim() } : null;
  if (!vision && s?.reelVision && VISION_MODES.includes(s.reelVision as VisionMode)) {
    vision = { mode: s.reelVision as VisionMode, model: (s.reelVisionModel ?? '').trim() };
  }
  const matching = taskModel(t.matching);
  return {
    structure: taskModel(t.structure) ?? null,
    vision: vision ?? { ...TASK_DEFAULTS.vision },
    matching: matching === undefined ? { ...TASK_DEFAULTS.matching } : matching
  };
}

/** Request config (provider/model/key) for a text task; falls back to the chat model. */
export function taskRequestConfig(s: AiSettingsLike | null | undefined, task: 'chat' | 'structure' | 'matching') {
  const chat = {
    provider: (s?.provider === 'openrouter' ? 'openrouter' : 'ollama') as AiProvider,
    model: typeof s?.model === 'string' ? s.model : undefined,
    openRouterApiKey: typeof s?.openRouterApiKey === 'string' ? s.openRouterApiKey : undefined
  };
  if (task === 'chat') return chat;
  const own = resolveTasks(s)[task];
  return own ? { provider: own.provider, model: own.model || undefined, openRouterApiKey: chat.openRouterApiKey } : chat;
}

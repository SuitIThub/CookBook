/**
 * Dashboard layout model (website + app). The layout is an ordered list of
 * widgets, each with a width in columns (1–3) and its own settings. The grid
 * has 1 column on phones, 2 on tablets and 3 on desktops; wider widgets are
 * capped to the available columns. Stored per alias in localStorage under
 * `cookbook.dashboard.layout`, which the alias sync shares across devices.
 */
import { DEFAULT_CRITERIA, type RecommendationCriteria } from '../lib/weekRecommendations';

export const LAYOUT_KEY = 'cookbook.dashboard.layout';
export const LAYOUT_CHANGED_EVENT = 'cookbook:dashboard-layout-changed';

export type Span = 1 | 2 | 3;

export type WidgetType =
  | 'tracker-day'
  | 'tracker-log'
  | 'tracker-week'
  | 'tracker-weight'
  | 'tracker-mealprep'
  | 'tracker-goal'
  | 'tracker-suggestions'
  | 'favorites'
  | 'recommendations'
  | 'planned'
  | 'cook-queue'
  | 'shopping-lists'
  | 'shopping-list'
  | 'shortcuts'
  | 'random-recipe'
  | 'recent-recipes'
  | 'timers'
  | 'price-changes'
  | 'note';

export type ShortcutId =
  | 'scan-barcode'
  | 'tracker-product'
  | 'tracker-free'
  | 'tracker-weight'
  | 'bulk-scan'
  | 'receipt'
  | 'import-recipe'
  | 'new-recipe'
  | 'new-list'
  | 'random-recipe'
  | 'tracker'
  | 'recipes'
  | 'lists'
  | 'products'
  | 'ingredients';

export interface WidgetConfigs {
  'tracker-day': Record<string, never>;
  'tracker-log': Record<string, never>;
  'tracker-week': { days: 7 | 14 };
  'tracker-weight': { days: 30 | 90 | 365 };
  'tracker-mealprep': Record<string, never>;
  'tracker-goal': Record<string, never>;
  'tracker-suggestions': { count: number };
  favorites: { count: number };
  recommendations: {
    criteria: RecommendationCriteria;
    count: number;
    /** Share of the daily kcal goal one main meal should have (percent). */
    mealShare: number;
    aiPlan: boolean;
    /** Dishes per AI week plan. */
    aiDishes: number;
  };
  planned: { days: 7 | 14; showOpen: boolean };
  'cook-queue': Record<string, never>;
  'shopping-lists': { showPermanent: boolean; count: number; hideEmpty: boolean };
  'shopping-list': { listId: string; hideChecked: boolean };
  shortcuts: { items: ShortcutId[] };
  'random-recipe': { category: string };
  'recent-recipes': { count: number };
  timers: Record<string, never>;
  'price-changes': { count: number };
  note: { title: string; text: string };
}

export interface WidgetInstance<T extends WidgetType = WidgetType> {
  id: string;
  type: T;
  span: Span;
  config: WidgetConfigs[T];
}

export interface DashboardLayout {
  version: 1;
  widgets: WidgetInstance[];
}

export type WidgetCategory = 'Tracker' | 'Rezepte & Planung' | 'Einkauf' | 'Sonstiges';

export interface WidgetMeta<T extends WidgetType = WidgetType> {
  type: T;
  title: string;
  description: string;
  category: WidgetCategory;
  defaultSpan: Span;
  /** Widest sensible width (narrow widgets look lost at 3 columns). */
  maxSpan: Span;
  defaultConfig: () => WidgetConfigs[T];
  /** Has a settings dialog in edit mode. */
  configurable: boolean;
  /** May appear more than once (e.g. several pinned lists or notes). */
  multiple?: boolean;
}

export const SHORTCUTS: Record<ShortcutId, { label: string; to: string; group: string }> = {
  'scan-barcode': { label: 'Barcode scannen', to: '/tracker?action=scan', group: 'Tracker' },
  'tracker-product': { label: 'Produkt eintragen', to: '/tracker?action=product', group: 'Tracker' },
  'tracker-free': { label: 'Freier Eintrag', to: '/tracker?action=free', group: 'Tracker' },
  'tracker-weight': { label: 'Gewicht eintragen', to: '/tracker?action=weight', group: 'Tracker' },
  'bulk-scan': { label: 'Produkte scannen (Bulk)', to: '/produkte/import', group: 'Produkte' },
  receipt: { label: 'Kassenbon einlesen', to: '/produkte/kassenbon', group: 'Produkte' },
  'import-recipe': { label: 'Rezept importieren', to: '/rezepte?import=1', group: 'Rezepte' },
  'new-recipe': { label: 'Neues Rezept', to: '/rezept/neu', group: 'Rezepte' },
  'random-recipe': { label: 'Zufälliges Rezept', to: '/rezepte?random=1', group: 'Rezepte' },
  'new-list': { label: 'Neue Einkaufsliste', to: '/einkaufslisten?new=1', group: 'Einkauf' },
  tracker: { label: 'Tracker', to: '/tracker', group: 'Seiten' },
  recipes: { label: 'Rezepte', to: '/rezepte', group: 'Seiten' },
  lists: { label: 'Einkaufslisten', to: '/einkaufslisten', group: 'Seiten' },
  products: { label: 'Produkte', to: '/produkte', group: 'Seiten' },
  ingredients: { label: 'Zutaten', to: '/zutaten', group: 'Seiten' }
};

const empty = () => ({}) as Record<string, never>;

export const WIDGETS: { [T in WidgetType]: WidgetMeta<T> } = {
  'tracker-day': {
    type: 'tracker-day',
    title: 'Tagesbilanz',
    description: 'Kalorien und Makros von heute gegen dein Ziel.',
    category: 'Tracker',
    defaultSpan: 1,
    maxSpan: 2,
    defaultConfig: empty,
    configurable: false
  },
  'tracker-log': {
    type: 'tracker-log',
    title: 'Heute gegessen',
    description: 'Die Tagebuch-Einträge von heute.',
    category: 'Tracker',
    defaultSpan: 1,
    maxSpan: 2,
    defaultConfig: empty,
    configurable: false
  },
  'tracker-week': {
    type: 'tracker-week',
    title: 'Wochenbilanz',
    description: 'Kalorien der letzten Tage als Balken gegen dein Tagesziel.',
    category: 'Tracker',
    defaultSpan: 2,
    maxSpan: 3,
    defaultConfig: () => ({ days: 7 }),
    configurable: true
  },
  'tracker-weight': {
    type: 'tracker-weight',
    title: 'Gewicht',
    description: 'Aktuelles Gewicht, Trend und Verlauf — mit Schnelleintrag.',
    category: 'Tracker',
    defaultSpan: 1,
    maxSpan: 3,
    defaultConfig: () => ({ days: 30 }),
    configurable: true
  },
  'tracker-mealprep': {
    type: 'tracker-mealprep',
    title: 'Offene Meal-Prep-Portionen',
    description: 'Vorgekochte Portionen direkt abstreichen.',
    category: 'Tracker',
    defaultSpan: 1,
    maxSpan: 2,
    defaultConfig: empty,
    configurable: false
  },
  'tracker-goal': {
    type: 'tracker-goal',
    title: 'Ziel & Körper',
    description: 'Kalorienziel, BMI und Abstand zum Zielgewicht.',
    category: 'Tracker',
    defaultSpan: 1,
    maxSpan: 2,
    defaultConfig: empty,
    configurable: false
  },
  'tracker-suggestions': {
    type: 'tracker-suggestions',
    title: 'Passt noch ins Budget',
    description: 'Rezepte, die zu den heute noch offenen Kalorien passen.',
    category: 'Tracker',
    defaultSpan: 1,
    maxSpan: 3,
    defaultConfig: () => ({ count: 4 }),
    configurable: true
  },
  favorites: {
    type: 'favorites',
    title: 'Lieblingsgerichte',
    description: 'Deine favorisierten Rezepte.',
    category: 'Rezepte & Planung',
    defaultSpan: 2,
    maxSpan: 3,
    defaultConfig: () => ({ count: 6 }),
    configurable: true
  },
  recommendations: {
    type: 'recommendations',
    title: 'Für nächste Woche empfohlen',
    description: 'Vorschläge nach Favoriten, Abwechslung, Kalorienziel und „lange nicht gegessen“ — mit Einplanen und KI-Wochenplan.',
    category: 'Rezepte & Planung',
    defaultSpan: 2,
    maxSpan: 3,
    defaultConfig: () => ({ criteria: { ...DEFAULT_CRITERIA }, count: 5, mealShare: 40, aiPlan: true, aiDishes: 4 }),
    configurable: true
  },
  planned: {
    type: 'planned',
    title: 'Geplante Gerichte',
    description: 'Mit Datum geplante Meal-Prep-Gerichte der nächsten Tage — mit Einkaufsliste für den Plan.',
    category: 'Rezepte & Planung',
    defaultSpan: 1,
    maxSpan: 3,
    defaultConfig: () => ({ days: 7, showOpen: true }),
    configurable: true
  },
  'cook-queue': {
    type: 'cook-queue',
    title: 'Demnächst kochen',
    description: 'Gerichte, die du bald kochen willst (z. B. weil eingekauft) — ohne festes Datum; mit „Gekocht“ und Kochmodus.',
    category: 'Rezepte & Planung',
    defaultSpan: 1,
    maxSpan: 2,
    defaultConfig: empty,
    configurable: false
  },
  'shopping-lists': {
    type: 'shopping-lists',
    title: 'Aktuelle Einkaufslisten',
    description: 'Alle Einkaufslisten mit offenen Posten.',
    category: 'Einkauf',
    defaultSpan: 1,
    maxSpan: 2,
    defaultConfig: () => ({ showPermanent: true, count: 5, hideEmpty: true }),
    configurable: true
  },
  'shopping-list': {
    type: 'shopping-list',
    title: 'Einkaufsliste',
    description: 'Eine bestimmte Liste zum direkten Abhaken.',
    category: 'Einkauf',
    defaultSpan: 1,
    maxSpan: 3,
    defaultConfig: () => ({ listId: '', hideChecked: true }),
    configurable: true,
    multiple: true
  },
  'price-changes': {
    type: 'price-changes',
    title: 'Preisänderungen',
    description: 'Neue Preise aus eingelesenen Kassenbons im Vergleich zum letzten Einkauf.',
    category: 'Einkauf',
    defaultSpan: 1,
    maxSpan: 2,
    defaultConfig: () => ({ count: 6 }),
    configurable: true
  },
  shortcuts: {
    type: 'shortcuts',
    title: 'Shortcuts',
    description: 'Scannen, importieren, neue Liste … direkt vom Dashboard starten.',
    category: 'Sonstiges',
    defaultSpan: 1,
    maxSpan: 3,
    defaultConfig: () => ({ items: ['scan-barcode', 'bulk-scan', 'receipt', 'import-recipe', 'new-list', 'tracker-weight'] }),
    configurable: true,
    multiple: true
  },
  'random-recipe': {
    type: 'random-recipe',
    title: 'Zufallsrezept',
    description: 'Ein zufälliges Rezept als Inspiration, optional aus einer Kategorie.',
    category: 'Rezepte & Planung',
    defaultSpan: 1,
    maxSpan: 2,
    defaultConfig: () => ({ category: '' }),
    configurable: true,
    multiple: true
  },
  'recent-recipes': {
    type: 'recent-recipes',
    title: 'Neu im Kochbuch',
    description: 'Die zuletzt hinzugefügten Rezepte.',
    category: 'Rezepte & Planung',
    defaultSpan: 1,
    maxSpan: 3,
    defaultConfig: () => ({ count: 5 }),
    configurable: true
  },
  timers: {
    type: 'timers',
    title: 'Laufende Timer',
    description: 'Deine Koch-Timer mit Restzeit.',
    category: 'Sonstiges',
    defaultSpan: 1,
    maxSpan: 2,
    defaultConfig: empty,
    configurable: false
  },
  note: {
    type: 'note',
    title: 'Notiz',
    description: 'Freitext, z. B. Ideen für die Woche — wird mit dem Alias synchronisiert.',
    category: 'Sonstiges',
    defaultSpan: 1,
    maxSpan: 3,
    defaultConfig: () => ({ title: 'Notiz', text: '' }),
    configurable: true,
    multiple: true
  }
};

export const WIDGET_ORDER: WidgetType[] = Object.keys(WIDGETS) as WidgetType[];

export function newWidgetId(): string {
  return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createWidget<T extends WidgetType>(type: T): WidgetInstance<T> {
  const meta = WIDGETS[type];
  return { id: newWidgetId(), type, span: meta.defaultSpan, config: meta.defaultConfig() as WidgetConfigs[T] };
}

export function defaultLayout(): DashboardLayout {
  return {
    version: 1,
    widgets: [
      createWidget('tracker-day'),
      createWidget('shortcuts'),
      createWidget('cook-queue'),
      createWidget('planned'),
      createWidget('recommendations'),
      createWidget('shopping-lists'),
      createWidget('favorites')
    ]
  };
}

function clampSpan(value: unknown, max: Span): Span {
  const n = Math.round(Number(value));
  return (Math.min(max, Math.max(1, Number.isFinite(n) ? n : 1)) as Span);
}

/** Merge stored settings onto the defaults (unknown/invalid fields dropped). */
function sanitizeConfig<T extends WidgetType>(type: T, raw: unknown): WidgetConfigs[T] {
  const def = WIDGETS[type].defaultConfig() as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') return def as WidgetConfigs[T];
  const out: Record<string, unknown> = { ...def };
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(k in def)) continue;
    const d = def[k];
    if (typeof d === typeof v && Array.isArray(d) === Array.isArray(v)) {
      out[k] = d && typeof d === 'object' && !Array.isArray(d) ? { ...(d as object), ...(v as object) } : v;
    }
  }
  if (type === 'shortcuts') {
    out.items = (out.items as unknown[]).filter((i): i is ShortcutId => typeof i === 'string' && i in SHORTCUTS);
  }
  return out as WidgetConfigs[T];
}

/** Parse a stored layout; anything unusable falls back to the default layout. */
export function parseLayout(raw: string | null | undefined): DashboardLayout {
  if (!raw) return defaultLayout();
  try {
    const data = JSON.parse(raw) as { widgets?: unknown };
    if (!data || !Array.isArray(data.widgets)) return defaultLayout();
    const seen = new Set<string>();
    const widgets: WidgetInstance[] = [];
    for (const w of data.widgets as Record<string, unknown>[]) {
      const type = w?.type as WidgetType;
      if (!type || !(type in WIDGETS)) continue;
      const id = typeof w.id === 'string' && w.id && !seen.has(w.id) ? w.id : newWidgetId();
      seen.add(id);
      widgets.push({ id, type, span: clampSpan(w.span, WIDGETS[type].maxSpan), config: sanitizeConfig(type, w.config) });
    }
    return { version: 1, widgets };
  } catch {
    return defaultLayout();
  }
}

export function loadLayout(): DashboardLayout {
  try {
    return parseLayout(localStorage.getItem(LAYOUT_KEY));
  } catch {
    return defaultLayout();
  }
}

/** Persist (the alias sync's patched setItem pushes it to the server). */
export function saveLayout(layout: DashboardLayout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    /* storage full / blocked: layout stays for this session */
  }
}

/** Tailwind classes for a width: phones 1 column, tablets 2, desktops 3. */
export function spanClass(span: Span): string {
  if (span === 3) return 'md:col-span-2 lg:col-span-3';
  if (span === 2) return 'md:col-span-2';
  return '';
}

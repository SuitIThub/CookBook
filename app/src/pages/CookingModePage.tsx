import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { localRecipe } from '@/lib/localData';
import { formatQuantity } from '@core/units';
import { filterRecipeBySelection } from '@core/alternatives';
import type {
  Recipe,
  Ingredient,
  IngredientGroup,
  PreparationStep,
  PreparationGroup
} from '@/types';
import { CookingTimersProvider, useCookTimers } from '@/components/recipe/CookingTimers';

/* ------------------------------------------------------------------ helpers */

function celsiusToGasMark(celsius: number): string {
  const gasMarks = [
    { temp: 135, mark: '1' },
    { temp: 150, mark: '2' },
    { temp: 165, mark: '3' },
    { temp: 180, mark: '4' },
    { temp: 190, mark: '5' },
    { temp: 200, mark: '6' },
    { temp: 220, mark: '7' },
    { temp: 230, mark: '8' },
    { temp: 240, mark: '9' },
    { temp: 260, mark: '10' }
  ];
  const closest = gasMarks.reduce((prev, curr) =>
    Math.abs(curr.temp - celsius) < Math.abs(prev.temp - celsius) ? curr : prev
  );
  return closest.mark;
}

function extractTemperatures(text: string): { temp: number; original: string }[] {
  const out: { temp: number; original: string }[] = [];
  const re = /(\d+)\s*(?:°|Grad|℃)(?:\s*C)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const temp = parseInt(m[1]);
    if (!isNaN(temp) && temp > 0 && temp < 300) out.push({ temp, original: m[0] });
  }
  return out;
}

const TIME_RE = /(\d+(?:[,.]\d+)?(?:[-–]\d+(?:[,.]\d+)?)?\s*(?:Minuten?|Min\.?|Stunden?|Std\.?))/gi;

function parseTimeToSeconds(timeStr: string): number {
  const str = timeStr.toLowerCase();
  let totalMinutes = 0;
  const hourMatch = str.match(/(\d+(?:[,.]\d+)?)\s*(?:stunden?|std\.?)/i);
  if (hourMatch) totalMinutes += parseFloat(hourMatch[1].replace(',', '.')) * 60;
  const minuteMatch = str.match(/(\d+(?:[,.]\d+)?)\s*(?:minuten?|min\.?)/i);
  if (minuteMatch) totalMinutes += parseFloat(minuteMatch[1].replace(',', '.'));
  if (totalMinutes === 0) {
    const numberMatch = str.match(/(\d+(?:[,.]\d+)?)/);
    if (numberMatch) totalMinutes = parseFloat(numberMatch[1].replace(',', '.'));
  }
  return Math.round(totalMinutes * 60);
}

function formatQuantityForDisplay(amount: number, unit: string): { amount: number; unit: string } {
  if (!unit || unit.trim() === '') return { amount, unit: '' };
  const f = formatQuantity(amount, unit);
  return { amount: f.amount, unit: f.unit };
}

function flattenIngredients(groups: IngredientGroup[]): Ingredient[] {
  const out: Ingredient[] = [];
  for (const group of groups) {
    if (Array.isArray(group.ingredients)) {
      for (const ing of group.ingredients) {
        if ('name' in ing) out.push(ing as Ingredient);
        else if (Array.isArray((ing as IngredientGroup).ingredients))
          out.push(...flattenIngredients([ing as IngredientGroup]));
      }
    }
  }
  return out;
}

function isPrepGroup(x: PreparationStep | PreparationGroup): x is PreparationGroup {
  return Array.isArray((x as PreparationGroup).steps);
}

/** Only text steps directly in a group (mirrors the website's flattening). */
interface FlatGroup {
  title?: string;
  steps: PreparationStep[];
}
function buildGroups(groups: (PreparationStep | PreparationGroup)[]): FlatGroup[] {
  const out: FlatGroup[] = [];
  const walk = (nodes: (PreparationStep | PreparationGroup)[], title?: string) => {
    const directSteps = nodes.filter((n): n is PreparationStep => !isPrepGroup(n));
    if (directSteps.length > 0) out.push({ title, steps: directSteps });
    for (const n of nodes) if (isPrepGroup(n)) walk(n.steps, n.title);
  };
  walk(groups);
  return out;
}

/* -------------------------------------------------------------- step text */

/** Renders step text, turning duration mentions into clickable timer chips. */
function StepText({
  text,
  recipeTitle,
  stepDescription
}: {
  text: string;
  recipeTitle: string;
  stepDescription: string;
}) {
  const { addTimer } = useCookTimers();
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(TIME_RE.source, 'gi');
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>);
    const label = m[0];
    parts.push(
      <button
        key={key++}
        type="button"
        className="timer-trigger font-medium text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
        onClick={() => addTimer(label, parseTimeToSeconds(label), recipeTitle, stepDescription, true)}
      >
        {label}
      </button>
    );
    last = m.index + label.length;
  }
  if (last < text.length) parts.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return (
    <p className="mb-4 whitespace-pre-wrap text-lg leading-relaxed text-gray-800 sm:text-xl md:mb-6 md:text-2xl lg:text-3xl xl:text-4xl dark:text-gray-200">
      {parts}
    </p>
  );
}

/* --------------------------------------------------------------- content */

function CookingContent({ recipe }: { recipe: Recipe }) {
  const filtered = useMemo(() => filterRecipeBySelection(recipe), [recipe]);
  const groups = useMemo(() => buildGroups(filtered.preparationGroups), [filtered]);
  const allIngredients = useMemo(() => flattenIngredients(filtered.ingredientGroups), [filtered]);
  const totalSteps = groups.reduce((s, g) => s + g.steps.length, 0);

  // Flat slide model: index 0 = ingredients, then one per step.
  interface Slide {
    kind: 'ingredients' | 'step';
    groupIndex: number;
    stepIndex: number;
    step?: PreparationStep;
    globalStepIndex: number;
  }
  const slides = useMemo<Slide[]>(() => {
    const arr: Slide[] = [{ kind: 'ingredients', groupIndex: -1, stepIndex: -1, globalStepIndex: 0 }];
    let global = 0;
    groups.forEach((g, gi) =>
      g.steps.forEach((step, si) => {
        global++;
        arr.push({ kind: 'step', groupIndex: gi, stepIndex: si, step, globalStepIndex: global });
      })
    );
    return arr;
  }, [groups]);

  const [current, setCurrent] = useState(0);
  const [isLandscape, setIsLandscape] = useState(
    () => typeof window !== 'undefined' && window.innerWidth > window.innerHeight
  );
  const [hasTouch] = useState(
    () => typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  );
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiping = useRef(false);

  useEffect(() => {
    const onResize = () => setIsLandscape(window.innerWidth > window.innerHeight);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  const navigate = (dir: number) =>
    setCurrent((c) => Math.min(slides.length - 1, Math.max(0, c + dir)));

  const goToGroup = (groupIndex: number) => {
    let target = 1; // after ingredients
    for (let i = 0; i < groupIndex; i++) target += groups[i].steps.length;
    setCurrent(target);
    setGroupPickerOpen(false);
  };

  // Keyboard navigation (desktop convenience).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') navigate(1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') navigate(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col overscroll-none bg-white dark:bg-gray-900">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200 p-4 md:p-6 dark:border-gray-700">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl md:text-3xl lg:text-4xl xl:text-5xl dark:text-white">
          {recipe.title}
        </h1>
        <Link
          to={`/rezept/${recipe.id}`}
          className="rounded-full p-2 transition-colors hover:bg-gray-100 md:p-3 dark:hover:bg-gray-800"
          aria-label="Kochmodus schließen"
        >
          <svg className="h-6 w-6 text-gray-600 md:h-8 md:w-8 lg:h-10 lg:w-10 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </Link>
      </header>

      {/* Slides */}
      <main
        className="relative flex-1 overflow-hidden overscroll-none"
        onTouchStart={(e) => {
          touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          swiping.current = false;
        }}
        onTouchMove={(e) => {
          if (!touchStart.current) return;
          const dx = e.touches[0].clientX - touchStart.current.x;
          const dy = e.touches[0].clientY - touchStart.current.y;
          if (!swiping.current) {
            if ((!isLandscape && Math.abs(dy) > Math.abs(dx)) || (isLandscape && Math.abs(dx) > Math.abs(dy))) {
              swiping.current = true;
            }
          }
        }}
        onTouchEnd={(e) => {
          if (!touchStart.current || !swiping.current) {
            touchStart.current = null;
            return;
          }
          const dx = e.changedTouches[0].clientX - touchStart.current.x;
          const dy = e.changedTouches[0].clientY - touchStart.current.y;
          if (isLandscape) {
            if (Math.abs(dx) > 50) navigate(dx > 0 ? -1 : 1);
          } else {
            if (Math.abs(dy) > 50) navigate(dy > 0 ? -1 : 1);
          }
          touchStart.current = null;
        }}
      >
        {slides.map((slide, i) => {
          const offset = i - current;
          const transform = isLandscape ? `translateX(${offset * 100}%)` : `translateY(${offset * 100}%)`;
          return (
            <div
              key={i}
              className="absolute inset-0 flex flex-col p-4 transition-transform duration-300 md:p-8"
              style={{ transform }}
            >
              {slide.kind === 'ingredients' ? (
                <>
                  <h2 className="mb-4 text-xl font-bold text-gray-900 sm:text-2xl md:mb-6 md:text-3xl lg:text-4xl xl:text-5xl dark:text-white">
                    Zutaten
                  </h2>
                  <div className="flex-1 overflow-y-auto overscroll-none">
                    <ul className="space-y-3 md:space-y-4">
                      {allIngredients.map((ing) => (
                        <li
                          key={ing.id}
                          className="flex items-center text-base text-gray-800 sm:text-lg md:text-xl lg:text-2xl xl:text-3xl dark:text-gray-200"
                        >
                          {ing.quantities.map((q, qi) => (
                            <span key={qi} className="font-medium">
                              {qi > 0 && ' oder '}
                              {q.amount} {q.unit}
                            </span>
                          ))}
                          <span className="ml-2 md:ml-3">{ing.name}</span>
                          {ing.description && (
                            <span className="ml-2 text-gray-500 md:ml-3 dark:text-gray-400">({ing.description})</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              ) : (
                <StepSlide
                  slide={slide}
                  group={groups[slide.groupIndex]}
                  groupCount={groups.length}
                  totalSteps={totalSteps}
                  allIngredients={allIngredients}
                  recipeTitle={recipe.title}
                  onOpenGroupPicker={() => setGroupPickerOpen(true)}
                />
              )}
            </div>
          );
        })}

        {/* Nav buttons — only when touch is unavailable */}
        {!hasTouch && (
          <>
            <button
              onClick={() => navigate(-1)}
              style={{ visibility: current === 0 ? 'hidden' : 'visible' }}
              className={
                'absolute rounded-full bg-gray-900/10 p-4 transition-colors hover:bg-gray-900/20 md:p-6 dark:bg-white/10 dark:hover:bg-white/20 ' +
                (isLandscape
                  ? 'left-4 top-1/2 -translate-y-1/2 md:left-6'
                  : 'left-1/2 top-4 -translate-x-1/2 md:top-6')
              }
              aria-label="Zurück"
            >
              <svg
                className={
                  'h-8 w-8 transform text-gray-900 sm:h-10 sm:w-10 md:h-12 md:w-12 lg:h-16 lg:w-16 dark:text-white ' +
                  (isLandscape ? 'rotate-180' : 'rotate-90')
                }
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14m-7-7l7 7-7 7" />
              </svg>
            </button>
            <button
              onClick={() => navigate(1)}
              style={{ visibility: current === slides.length - 1 ? 'hidden' : 'visible' }}
              className={
                'absolute rounded-full bg-gray-900/10 p-4 transition-colors hover:bg-gray-900/20 md:p-6 dark:bg-white/10 dark:hover:bg-white/20 ' +
                (isLandscape
                  ? 'right-4 top-1/2 -translate-y-1/2 md:right-6'
                  : 'bottom-24 left-1/2 -translate-x-1/2 md:bottom-28')
              }
              aria-label="Weiter"
            >
              <svg
                className={
                  'h-8 w-8 transform text-gray-900 sm:h-10 sm:w-10 md:h-12 md:w-12 lg:h-16 lg:w-16 dark:text-white ' +
                  (isLandscape ? '' : 'rotate-90')
                }
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14m-7-7l7 7-7 7" />
              </svg>
            </button>
          </>
        )}
      </main>

      {/* Group selector modal */}
      {groupPickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 dark:bg-black/70"
          onClick={() => setGroupPickerOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white dark:bg-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-gray-200 p-4 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Gruppe auswählen</h3>
            </div>
            <div className="space-y-2 p-4">
              {groups.map((g, i) => (
                <button
                  key={i}
                  className="w-full rounded-lg p-3 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={() => goToGroup(i)}
                >
                  <div className="font-medium text-gray-900 dark:text-white">{g.title || 'Ungruppierte Schritte'}</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {g.steps.length} {g.steps.length === 1 ? 'Schritt' : 'Schritte'}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StepSlide({
  slide,
  group,
  groupCount,
  totalSteps,
  allIngredients,
  recipeTitle,
  onOpenGroupPicker
}: {
  slide: { groupIndex: number; stepIndex: number; step?: PreparationStep; globalStepIndex: number };
  group: FlatGroup;
  groupCount: number;
  totalSteps: number;
  allIngredients: Ingredient[];
  recipeTitle: string;
  onOpenGroupPicker: () => void;
}) {
  const step = slide.step!;
  const temps = extractTemperatures(step.text);
  const nextStep = slide.stepIndex < group.steps.length - 1 ? group.steps[slide.stepIndex + 1] : null;

  return (
    <>
      <div className="mb-4 space-y-2 md:mb-6">
        {group.title && (
          <button
            className="text-lg font-medium text-blue-600 hover:text-blue-800 sm:text-xl md:text-2xl lg:text-3xl dark:text-blue-400 dark:hover:text-blue-300"
            onClick={onOpenGroupPicker}
          >
            {group.title}
          </button>
        )}
        <h2 className="flex items-center gap-3 text-xl font-bold text-gray-900 sm:text-2xl md:text-3xl lg:text-4xl xl:text-5xl dark:text-white">
          <span>
            Schritt {slide.stepIndex + 1}/{group.steps.length}
          </span>
          <span className="text-base text-gray-400 sm:text-lg md:text-xl lg:text-2xl dark:text-gray-500">
            (Gruppe {slide.groupIndex + 1}/{groupCount}, Gesamt {slide.globalStepIndex}/{totalSteps})
          </span>
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        <StepText text={step.text} recipeTitle={recipeTitle} stepDescription={step.text} />

        <div className="flex flex-wrap gap-2 md:gap-3">
          {temps.map((t, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-800 sm:text-base md:px-4 md:py-1.5 md:text-lg lg:text-xl dark:bg-blue-900 dark:text-blue-100"
            >
              {t.original} (Gasstufe {celsiusToGasMark(t.temp)})
            </span>
          ))}
        </div>

        {temps.length > 0 && step.linkedIngredients && step.linkedIngredients.length > 0 && <div className="my-2 md:my-3" />}

        {step.linkedIngredients && step.linkedIngredients.length > 0 && (
          <div className="flex flex-wrap gap-2 md:gap-3">
            {step.linkedIngredients.map((link, i) => {
              const ing = allIngredients.find((x) => x.id === link.ingredientId);
              if (!ing) return null;
              const q = ing.quantities[link.selectedQuantityIndex];
              if (!q) return null;
              const f = formatQuantityForDisplay(q.amount, q.unit);
              const showUnit =
                !!f.unit &&
                f.unit.trim() !== '' &&
                !['Stück', 'Stk.', 'Stk', 'stück', 'stk.', 'stk'].includes(f.unit.trim());
              return (
                <span
                  key={i}
                  className="inline-flex items-center rounded-full bg-orange-100 px-3 py-1 text-sm text-orange-800 sm:text-base md:px-4 md:py-1.5 md:text-lg lg:text-xl dark:bg-orange-900 dark:text-orange-100"
                >
                  {f.amount > 0 && <span className="font-medium">{f.amount}</span>}
                  {f.amount > 0 && showUnit && <span className="ml-1">&nbsp;</span>}
                  {showUnit && <span className="font-medium">{f.unit}</span>}
                  {(f.amount > 0 || showUnit) && <span className="ml-1">&nbsp;</span>}
                  <span>{ing.name}</span>
                  {ing.description && (
                    <span className="ml-1 text-orange-600 md:ml-2 dark:text-orange-300">({ing.description})</span>
                  )}
                </span>
              );
            })}
          </div>
        )}

        {nextStep && (
          <div className="mt-4 rounded-lg bg-gray-100 p-3 portrait:block landscape:hidden md:mt-6 md:p-4 dark:bg-gray-800">
            <p className="mb-1 text-sm text-gray-500 sm:text-base md:mb-2 md:text-lg lg:text-xl dark:text-gray-400">Nächster Schritt:</p>
            <p className="line-clamp-2 text-base text-gray-700 sm:text-lg md:text-xl lg:text-2xl dark:text-gray-300">{nextStep.text}</p>
          </div>
        )}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- page */

export default function CookingModePage() {
  const { id } = useParams<{ id: string }>();
  const { data: recipe, isLoading } = useQuery({
    queryKey: ['recipe', id],
    queryFn: () => localRecipe(id!),
    enabled: !!id
  });

  // Keep the screen awake while cooking (best-effort).
  useEffect(() => {
    let lock: any = null;
    const request = async () => {
      try {
        lock = await (navigator as any).wakeLock?.request('screen');
      } catch {
        /* not supported */
      }
    };
    request();
    const onVisible = () => {
      if (document.visibilityState === 'visible') request();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      try {
        lock?.release?.();
      } catch {
        /* no-op */
      }
    };
  }, []);

  if (isLoading)
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-gray-900">
        <p className="text-gray-500">Lade …</p>
      </div>
    );

  const hasSteps =
    recipe && recipe.preparationGroups && buildGroups(recipe.preparationGroups).some((g) => g.steps.length > 0);

  if (!recipe || !hasSteps) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-white dark:bg-gray-900">
        <p className="text-gray-500">Keine Zubereitungsschritte.</p>
        <Link to={id ? `/rezept/${id}` : '/'} className="text-orange-600 hover:underline">
          ← Zurück
        </Link>
      </div>
    );
  }

  return (
    <CookingTimersProvider>
      <CookingContent recipe={recipe} />
    </CookingTimersProvider>
  );
}

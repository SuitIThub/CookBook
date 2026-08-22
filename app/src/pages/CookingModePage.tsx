import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { localRecipe } from '@/lib/localData';
import type { PreparationStep, PreparationGroup } from '@/types';

function isPrepGroup(x: PreparationStep | PreparationGroup): x is PreparationGroup {
  return Array.isArray((x as PreparationGroup).steps);
}
function flattenSteps(nodes: (PreparationStep | PreparationGroup)[]): PreparationStep[] {
  const out: PreparationStep[] = [];
  for (const n of nodes) {
    if (isPrepGroup(n)) out.push(...flattenSteps(n.steps));
    else out.push(n);
  }
  return out;
}

function stepSeconds(s: PreparationStep): number {
  if (s.timeInSeconds && s.timeInSeconds > 0) return s.timeInSeconds;
  if (s.timer && s.timer > 0) return s.timer * 60;
  return 0;
}
function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function StepTimer({ seconds }: { seconds: number }) {
  const [remaining, setRemaining] = useState(seconds);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    setRemaining(seconds);
    setRunning(false);
    setDone(false);
  }, [seconds]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(t);
          setRunning(false);
          setDone(true);
          try {
            navigator.vibrate?.([200, 100, 200]);
          } catch {
            /* no-op */
          }
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [running]);

  return (
    <div
      className={
        'mt-6 flex items-center justify-center gap-4 rounded-xl border p-4 ' +
        (done
          ? 'border-green-400 bg-green-50 dark:border-green-600 dark:bg-green-900/30'
          : 'border-secondary-200 dark:border-secondary-700')
      }
    >
      <span className="font-mono text-3xl tabular-nums" data-testid="timer">
        {mmss(remaining)}
      </span>
      {done ? (
        <span className="font-medium text-green-700 dark:text-green-300">Fertig! ⏰</span>
      ) : (
        <>
          <button
            onClick={() => setRunning((r) => !r)}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            {running ? 'Pause' : 'Start'}
          </button>
          <button
            onClick={() => {
              setRunning(false);
              setRemaining(seconds);
            }}
            className="rounded-lg border border-secondary-300 px-4 py-2 text-sm dark:border-secondary-600"
          >
            Reset
          </button>
        </>
      )}
    </div>
  );
}

export default function CookingModePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: recipe, isLoading } = useQuery({
    queryKey: ['recipe', id],
    queryFn: () => localRecipe(id!),
    enabled: !!id
  });
  const steps = useMemo(() => flattenSteps(recipe?.preparationGroups ?? []), [recipe]);
  const [i, setI] = useState(0);

  // Keep the screen awake while cooking (best-effort).
  useEffect(() => {
    let lock: any = null;
    (async () => {
      try {
        lock = await (navigator as any).wakeLock?.request('screen');
      } catch {
        /* not supported */
      }
    })();
    return () => {
      try {
        lock?.release?.();
      } catch {
        /* no-op */
      }
    };
  }, []);

  if (isLoading) return <p className="text-secondary-500">Lade …</p>;
  if (!recipe || steps.length === 0) {
    return (
      <div className="text-center">
        <p className="text-secondary-500">Keine Zubereitungsschritte.</p>
        <Link to={id ? `/rezept/${id}` : '/'} className="text-primary-600 hover:underline">
          ← Zurück
        </Link>
      </div>
    );
  }

  const step = steps[i];
  const secs = stepSeconds(step);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col">
      <div className="flex items-center justify-between">
        <span className="truncate text-sm text-secondary-500">{recipe.title}</span>
        <Link to={`/rezept/${recipe.id}`} className="text-sm text-primary-600 hover:underline" aria-label="Kochmodus schließen">
          ✕ Schließen
        </Link>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary-200 dark:bg-secondary-700">
        <div
          className="h-full bg-primary-500 transition-all"
          style={{ width: `${((i + 1) / steps.length) * 100}%` }}
        />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
        <p className="mb-4 text-sm font-medium text-secondary-400" data-testid="step-counter">
          Schritt {i + 1} / {steps.length}
        </p>
        <p className="text-2xl leading-relaxed" data-testid="step-text">
          {step.text}
        </p>
        {secs > 0 && <StepTimer seconds={secs} />}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-secondary-200 pt-4 dark:border-secondary-700">
        <button
          onClick={() => setI((n) => Math.max(0, n - 1))}
          disabled={i === 0}
          className="rounded-lg border border-secondary-300 px-6 py-3 font-medium disabled:opacity-40 dark:border-secondary-600"
        >
          ← Zurück
        </button>
        {i < steps.length - 1 ? (
          <button
            onClick={() => setI((n) => Math.min(steps.length - 1, n + 1))}
            className="rounded-lg bg-primary-600 px-6 py-3 font-medium text-white hover:bg-primary-700"
          >
            Weiter →
          </button>
        ) : (
          <button
            onClick={() => navigate(`/rezept/${recipe.id}`)}
            className="rounded-lg bg-green-600 px-6 py-3 font-medium text-white hover:bg-green-700"
          >
            Fertig ✓
          </button>
        )}
      </div>
    </div>
  );
}

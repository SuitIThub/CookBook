/** Small shared UI pieces for the dashboard (website + app). */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useDashboardData } from './data';

/**
 * Load data for a widget; reloads on `deps` change, when synced data changed
 * and when the tab/app becomes visible again.
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: string | null; loading: boolean; reload: () => void } {
  const host = useDashboardData();
  const [state, setState] = useState<{ data: T | undefined; error: string | null; loading: boolean }>({ data: undefined, error: null, loading: true });
  const loadRef = useRef(load);
  loadRef.current = load;
  const run = useCallback(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true }));
    loadRef
      .current()
      .then((data) => active && setState({ data, error: null, loading: false }))
      .catch((e: unknown) => active && setState((s) => ({ data: s.data, error: (e as Error)?.message || String(e), loading: false })));
    return () => {
      active = false;
    };
  }, []);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(run, [...deps, tick]);
  useEffect(() => host.onDataChanged(reload), [host, reload]);
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);
  return { ...state, reload };
}

/** Listen to a document event (e.g. alias-sync notifications) for the component's lifetime. */
export function useDocumentEvent(name: string, fn: () => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const handler = () => ref.current();
    document.addEventListener(name, handler);
    return () => document.removeEventListener(name, handler);
  }, [name]);
}

export function Loading() {
  return <p className="py-4 text-center text-sm text-gray-400">Lädt …</p>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <p className="py-2 text-sm text-red-600 dark:text-red-400">{children}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-3 text-sm text-gray-500 dark:text-gray-400">{children}</p>;
}

/** Standard widget body states: loading / error / content. */
export function Async<T>({ state, children }: { state: { data: T | undefined; error: string | null }; children: (data: T) => ReactNode }) {
  if (state.data === undefined) return state.error ? <ErrorText>{state.error}</ErrorText> : <Loading />;
  return (
    <>
      {state.error && <ErrorText>{state.error}</ErrorText>}
      {children(state.data)}
    </>
  );
}

export function RecipeThumb({ src, title, className = 'h-12 w-12' }: { src?: string; title: string; className?: string }) {
  if (!src) {
    return (
      <div className={`${className} flex flex-shrink-0 items-center justify-center rounded bg-orange-100 text-orange-400 dark:bg-orange-900/30`} aria-hidden="true">
        <svg className="h-1/2 w-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      </div>
    );
  }
  return <img src={src} alt={title} loading="lazy" className={`${className} recipe-image flex-shrink-0 rounded object-cover`} />;
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className={`flex max-h-[90vh] w-full ${wide ? 'max-w-2xl' : 'max-w-md'} flex-col rounded-lg bg-white shadow-xl dark:bg-gray-800`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" aria-label="Schließen">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 text-gray-800 dark:text-gray-200">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3 dark:border-gray-700">{footer}</div>}
      </div>
    </div>
  );
}

export const btnPrimary = 'rounded-md bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50';
export const btnSecondary =
  'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600';
export const btnSmall = 'rounded border border-orange-400 px-2 py-0.5 text-xs text-orange-600 hover:bg-orange-50 disabled:opacity-50 dark:text-orange-300 dark:hover:bg-orange-900/20';
export const inputClass =
  'w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white';

/** Progress ring (kcal) — same look as the tracker's day rings. */
export function Ring({ value, max, size = 112, label, sub }: { value: number; max: number; size?: number; label: string; sub?: string }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const ratio = max > 0 ? value / max : 0;
  const over = ratio > 1;
  const shown = Math.min(1, ratio);
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="fill-none stroke-gray-200 dark:stroke-gray-700" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - shown)}
          className={`fill-none ${over ? 'stroke-red-500' : 'stroke-orange-500'}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-lg font-bold leading-tight text-gray-900 dark:text-white">{label}</span>
        {sub && <span className="text-[11px] leading-tight text-gray-500">{sub}</span>}
      </div>
    </div>
  );
}

export function Bar({ value, max, colorClass, label }: { value: number; max: number; colorClass: string; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-600 dark:text-gray-300">
        <span>{label}</span>
        <span>
          {Math.round(value)}
          {max > 0 ? ` / ${Math.round(max)} g` : ' g'}
        </span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
        <div className={`h-full ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function localDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function formatPortions(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toLocaleString('de-DE', { maximumFractionDigits: 1 });
}

export function weekdayLabel(d: Date): string {
  const today = startOfDay(new Date());
  const diff = Math.round((startOfDay(d).getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff === -1) return 'Gestern';
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });
}

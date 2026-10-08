import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { useLocation } from 'react-router-dom';
import { getLayoutMode } from '@core/layoutMode';

/**
 * A React port of the website's MultiTimerManager, reproducing the visible
 * cooking-mode timer behaviour: a footer (mobile layout) / sidebar
 * (tablet+desktop) that lists timers with a live countdown and start/pause,
 * ±1 min, and stop controls, plus an "add timer" action. Timers persist to
 * localStorage under the same `active-timers` key the website uses so they
 * survive reloads. The website's optional server-backed *global* timer sync
 * (SSE) is intentionally omitted — the app is offline-first.
 */

export interface CookTimer {
  id: string;
  label: string;
  duration: number; // seconds
  remaining: number; // seconds
  isRunning: boolean;
  isCompleted: boolean;
  recipeName?: string;
  stepDescription?: string;
  autoStarted?: boolean;
  startTime?: number; // epoch ms while running
}

interface TimerApi {
  addTimer: (
    label: string,
    seconds: number,
    recipeName?: string,
    stepDescription?: string,
    autoStart?: boolean
  ) => string;
}

const TimerContext = createContext<TimerApi | null>(null);

export function useCookTimers(): TimerApi {
  const ctx = useContext(TimerContext);
  if (!ctx) throw new Error('useCookTimers must be used within <CookingTimersProvider>');
  return ctx;
}

const STORAGE_KEY = 'active-timers';

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function loadTimers(): CookTimer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CookTimer[];
    const now = Date.now();
    return parsed.map((t) => {
      if (t.isRunning && t.startTime) {
        const elapsed = Math.floor((now - t.startTime) / 1000);
        const remaining = t.remaining - elapsed;
        if (remaining <= 0) {
          return { ...t, remaining: 0, isRunning: false, isCompleted: true, startTime: undefined };
        }
        return { ...t, remaining, startTime: now };
      }
      return t;
    });
  } catch {
    return [];
  }
}

export function CookingTimersProvider({ children }: { children: ReactNode }) {
  const [timers, setTimers] = useState<CookTimer[]>(() =>
    typeof window === 'undefined' ? [] : loadTimers()
  );
  const [mobileLayout, setMobileLayout] = useState(() => getLayoutMode() === 'mobile');
  const [expanded, setExpanded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const location = useLocation();
  const isCooking = location.pathname.endsWith('/kochen');
  const alarmed = useRef<Set<string>>(new Set());

  // Persist on every change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(timers));
    } catch {
      /* ignore */
    }
  }, [timers]);

  // Track layout mode (footer vs sidebar).
  useEffect(() => {
    const onResize = () => setMobileLayout(getLayoutMode() === 'mobile');
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  // Global 1s tick for all running timers.
  useEffect(() => {
    const hasRunning = timers.some((t) => t.isRunning);
    if (!hasRunning) return;
    const iv = setInterval(() => {
      setTimers((prev) =>
        prev.map((t) => {
          if (!t.isRunning) return t;
          const remaining = t.remaining - 1;
          if (remaining <= 0) {
            return { ...t, remaining: 0, isRunning: false, isCompleted: true, startTime: undefined };
          }
          return { ...t, remaining };
        })
      );
    }, 1000);
    return () => clearInterval(iv);
  }, [timers]);

  // Fire a vibration/notification once when a timer completes.
  useEffect(() => {
    for (const t of timers) {
      if (t.isCompleted && !alarmed.current.has(t.id)) {
        alarmed.current.add(t.id);
        try {
          navigator.vibrate?.([300, 150, 300, 150, 300]);
        } catch {
          /* ignore */
        }
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            const body = [t.recipeName, t.stepDescription].filter(Boolean).join(' — ');
            new Notification('Timer abgelaufen!', { body: body || t.label });
          }
        } catch {
          /* ignore */
        }
      }
      if (!t.isCompleted) alarmed.current.delete(t.id);
    }
  }, [timers]);

  const addTimer = useCallback<TimerApi['addTimer']>(
    (label, seconds, recipeName, stepDescription, autoStart = true) => {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      setTimers((prev) => [
        ...prev,
        {
          id,
          label,
          duration: seconds,
          remaining: seconds,
          isRunning: autoStart,
          isCompleted: false,
          recipeName,
          stepDescription,
          autoStarted: autoStart,
          startTime: autoStart ? Date.now() : undefined
        }
      ]);
      setExpanded(true);
      setSidebarOpen(true);
      try {
        if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission().catch(() => {});
        }
      } catch {
        /* ignore */
      }
      return id;
    },
    []
  );

  const start = (id: string) =>
    setTimers((p) => p.map((t) => (t.id === id ? { ...t, isRunning: true, isCompleted: false, startTime: Date.now() } : t)));
  const pause = (id: string) =>
    setTimers((p) => p.map((t) => (t.id === id ? { ...t, isRunning: false, startTime: undefined } : t)));
  const stop = (id: string) =>
    setTimers((p) =>
      p.map((t) =>
        t.id === id ? { ...t, isRunning: false, isCompleted: false, remaining: t.duration, startTime: undefined } : t
      )
    );
  const adjust = (id: string, minutes: number) =>
    setTimers((p) =>
      p.map((t) => {
        if (t.id !== id) return t;
        const remaining = Math.max(0, t.remaining + minutes * 60);
        return { ...t, remaining, duration: Math.max(t.duration, remaining), isCompleted: remaining === 0 ? t.isCompleted : false };
      })
    );
  const remove = (id: string) => setTimers((p) => p.filter((t) => t.id !== id));

  const api = useMemo<TimerApi>(() => ({ addTimer }), [addTimer]);

  const activeCount = timers.filter((t) => !t.isCompleted).length;
  const nextTimer = timers
    .filter((t) => !t.isCompleted)
    .reduce<CookTimer | null>((min, t) => (!min || t.remaining < min.remaining ? t : min), null);

  const timerItem = (t: CookTimer) => (
    <div key={t.id} className={'timer-item' + (t.isCompleted ? ' timer-completed' : '') + (t.autoStarted ? ' timer-recipe-based' : '')}>
      <div className="timer-item-header">
        <div className="timer-item-title">
          <span className="timer-item-label">{t.label}</span>
          {t.autoStarted && <span className="timer-auto-badge">Auto</span>}
        </div>
        <button className="timer-remove-btn" title="Entfernen" onClick={() => remove(t.id)}>
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
      {(t.recipeName || t.stepDescription) && (
        <div className="timer-context-info">
          {t.recipeName && <div className="timer-recipe-name">{t.recipeName}</div>}
          {t.stepDescription && <div className="timer-step-description">{t.stepDescription}</div>}
        </div>
      )}
      <div className={'timer-item-display ' + (t.isCompleted ? 'text-green-500' : t.isRunning ? 'text-orange-500' : 'text-gray-500')}>
        {formatTime(t.remaining)}
      </div>
      <div className="timer-controls">
        <button
          className={'timer-control-btn' + (t.remaining < 60 ? ' disabled' : '')}
          disabled={t.remaining < 60}
          title="-1m"
          onClick={() => adjust(t.id, -1)}
        >
          <span className="text-xs">-1m</span>
        </button>
        <button
          className="timer-control-btn primary"
          title={t.isRunning ? 'Pause' : 'Start'}
          onClick={() => (t.isRunning ? pause(t.id) : start(t.id))}
        >
          {t.isRunning ? '⏸' : '▶'}
        </button>
        <button className="timer-control-btn" title="+1m" onClick={() => adjust(t.id, 1)}>
          <span className="text-xs">+1m</span>
        </button>
        <button className="timer-control-btn" title="Stop" onClick={() => stop(t.id)}>
          ⏹
        </button>
      </div>
    </div>
  );

  const addButton = (
    <button
      className="mt-4 flex w-full items-center justify-center space-x-2 rounded-lg bg-orange-500 px-4 py-3 font-medium text-white transition-colors hover:bg-orange-600"
      onClick={() => setShowAdd(true)}
    >
      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z"
          clipRule="evenodd"
        />
      </svg>
      <span>Neuer Timer</span>
    </button>
  );

  // The timer surface is global (like the website's MultiTimerManager): a footer
  // on mobile layout, a collapsible right-edge sidebar on tablet/desktop. In
  // cooking mode it stays hidden behind the fullscreen overlay (z-30) until a
  // timer is actually running, then it is raised above the overlay (z-60 via
  // `.cook-timer-layer`) so tapped durations remain usable — an app improvement
  // over the website, where cooking-mode timers hide behind the overlay.
  const showSurface = !isCooking || timers.length > 0;
  const raise = isCooking && timers.length > 0 ? 'cook-timer-layer ' : '';

  return (
    <TimerContext.Provider value={api}>
      {children}

      {!showSurface ? null : mobileLayout ? (
        /* Mobile layout → footer */
        <div id="timer-footer" className={raise + 'timer-footer'}>
          <div className="timer-footer-toggle" onClick={() => setExpanded((e) => !e)}>
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center space-x-3">
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {nextTimer ? nextTimer.label : 'Keine aktiven Timer'}
                </span>
                <span className="font-mono text-lg font-bold text-orange-500">
                  {nextTimer ? formatTime(nextTimer.remaining) : '--:--'}
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {activeCount > 1 ? `+${activeCount - 1}` : ''}
                </span>
                <svg
                  className="h-4 w-4 transform text-gray-500 transition-transform dark:text-gray-400"
                  style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M14 7a1 1 0 00-1.414 0L10 9.586 7.414 7A1 1 0 006 8.414l4 4a1 1 0 001.414 0l4-4A1 1 0 0014 7z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
            </div>
          </div>
          {expanded && (
            <div className="timer-footer-expanded">
              <div className="timer-list">
                {timers.map(timerItem)}
                {addButton}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Tablet / desktop → collapsible sidebar (toggle tab on the right edge) */
        <>
          <button
            className={raise + 'timer-sidebar-toggle flex flex-col ' + (sidebarOpen ? 'positioned-left' : '')}
            title={sidebarOpen ? 'Timer einklappen' : 'Timer anzeigen'}
            onClick={() => setSidebarOpen((o) => !o)}
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d={sidebarOpen ? 'M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 111.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z' : 'M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z'}
                clipRule="evenodd"
              />
            </svg>
            <span className="timer-count-indicator">{activeCount}</span>
          </button>
          {sidebarOpen && (
            <div id="timer-sidebar" className={raise + 'timer-sidebar'}>
              <div className="timer-sidebar-content">
                <div className="timer-sidebar-header">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Timer</h3>
                  <button className="btn-icon bg-orange-500 text-white hover:bg-orange-600" title="Neuer Timer" onClick={() => setShowAdd(true)}>
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
                <div className="timer-list">
                  {timers.length === 0 ? (
                    <div className="py-8 text-center text-gray-500 dark:text-gray-400">
                      <p className="text-sm">Keine Timer aktiv</p>
                    </div>
                  ) : (
                    timers.map(timerItem)
                  )}
                  {addButton}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {showAdd && <AddTimerModal onClose={() => setShowAdd(false)} onAdd={(label, secs) => addTimer(label, secs, undefined, undefined, true)} />}
    </TimerContext.Provider>
  );
}

function AddTimerModal({ onClose, onAdd }: { onClose: () => void; onAdd: (label: string, seconds: number) => void }) {
  const [title, setTitle] = useState('Timer');
  const [minutes, setMinutes] = useState(5);
  const [seconds, setSeconds] = useState(0);
  const submit = () => {
    const total = Math.max(1, minutes * 60 + seconds);
    onAdd(title.trim() || 'Timer', total);
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={onClose}>
      <div
        className="w-[95vw] max-w-sm rounded-lg border border-gray-300 bg-white p-6 shadow-2xl dark:border-gray-600 dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 flex items-center text-xl font-bold text-gray-900 dark:text-white">
          <svg className="mr-2 h-6 w-6 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z"
              clipRule="evenodd"
            />
          </svg>
          Neuer Timer
        </h3>
        <div className="mb-4">
          <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Titel</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="z.B. Nudeln kochen"
            className="form-input w-full"
          />
        </div>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Minuten</label>
            <input
              type="number"
              min={0}
              value={minutes}
              onChange={(e) => setMinutes(Math.max(0, parseInt(e.target.value) || 0))}
              className="form-input w-full"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Sekunden</label>
            <input
              type="number"
              min={0}
              max={59}
              value={seconds}
              onChange={(e) => setSeconds(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
              className="form-input w-full"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={submit}>
            Starten
          </button>
        </div>
      </div>
    </div>
  );
}

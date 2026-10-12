/**
 * Dashboard page body (website island + app page). Widgets in a responsive
 * grid (1 / 2 / 3 columns); the edit mode adds drag & drop, widths, settings,
 * removing and adding widgets. The layout is saved per alias (alias sync).
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useDashboardData } from './data';
import {
  createWidget,
  defaultLayout,
  LAYOUT_CHANGED_EVENT,
  loadLayout,
  saveLayout,
  spanClass,
  WIDGET_ORDER,
  WIDGETS,
  type DashboardLayout,
  type Span,
  type WidgetCategory,
  type WidgetConfigs,
  type WidgetInstance,
  type WidgetType
} from './model';
import { WidgetBody, widgetLink } from './widgets';
import { WidgetSettings } from './WidgetSettings';
import { btnPrimary, btnSecondary, Modal, useDocumentEvent } from './ui';

interface DragState {
  id: string;
  pointerId: number;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

function widgetTitle(w: WidgetInstance): string {
  if (w.type === 'note') return (w.config as WidgetConfigs['note']).title || WIDGETS.note.title;
  return WIDGETS[w.type].title;
}

export default function Dashboard() {
  const host = useDashboardData();
  const [layout, setLayout] = useState<DashboardLayout>(() => loadLayout());
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const lastSwapRef = useRef<string | null>(null);

  const update = useCallback((next: DashboardLayout) => {
    setLayout(next);
    saveLayout(next);
  }, []);

  // Layout changed on another device (alias sync) — not while dragging.
  useDocumentEvent(LAYOUT_CHANGED_EVENT, () => {
    if (!dragRef.current) setLayout(loadLayout());
  });

  const setWidget = useCallback(
    (id: string, patch: Partial<WidgetInstance>) => {
      setLayout((prev) => {
        const next = { ...prev, widgets: prev.widgets.map((w) => (w.id === id ? ({ ...w, ...patch } as WidgetInstance) : w)) };
        saveLayout(next);
        return next;
      });
    },
    []
  );

  const move = useCallback((id: string, toIndex: number) => {
    setLayout((prev) => {
      const from = prev.widgets.findIndex((w) => w.id === id);
      if (from < 0 || toIndex < 0 || toIndex >= prev.widgets.length || from === toIndex) return prev;
      const widgets = [...prev.widgets];
      const [w] = widgets.splice(from, 1);
      widgets.splice(toIndex, 0, w);
      return { ...prev, widgets };
    });
  }, []);

  /* ------------------------------------------------ drag & drop (pointer) */

  // Move/up are tracked on window: reordering moves the dragged element in the
  // DOM, which would drop a pointer capture on the handle.
  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    e.preventDefault();
    setDrag({ ...d, x: e.clientX, y: e.clientY });
    // Widget under the pointer → take its place. After a swap the pointer can
    // still be over that (bigger) widget; swapping back would flicker, so it
    // only counts again once the pointer has left it.
    let over: string | null = null;
    for (const [id, el] of cardRefs.current) {
      if (id === d.id) continue;
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        over = id;
        break;
      }
    }
    if (over !== lastSwapRef.current) lastSwapRef.current = null;
    if (!over || over === lastSwapRef.current) return;
    const target = over;
    lastSwapRef.current = target;
    setLayout((prev) => {
      const to = prev.widgets.findIndex((w) => w.id === target);
      const from = prev.widgets.findIndex((w) => w.id === d.id);
      if (to < 0 || from < 0 || to === from) return prev;
      const widgets = [...prev.widgets];
      const [w] = widgets.splice(from, 1);
      widgets.splice(to, 0, w);
      return { ...prev, widgets };
    });
  }, []);

  const onPointerUp = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    setDrag(null);
    setLayout((prev) => {
      saveLayout(prev);
      return prev;
    });
  }, []);

  useEffect(() => {
    if (!drag) return;
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [drag !== null, onPointerMove, onPointerUp]); // eslint-disable-line react-hooks/exhaustive-deps

  const onHandleDown = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0) return;
    const card = cardRefs.current.get(id);
    if (!card) return;
    e.preventDefault();
    const r = card.getBoundingClientRect();
    lastSwapRef.current = null;
    const d = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, offsetX: e.clientX - r.left, offsetY: e.clientY - r.top, width: r.width, height: r.height };
    dragRef.current = d;
    setDrag(d);
  };

  // Scroll the page while dragging near the top/bottom edge.
  useEffect(() => {
    if (!drag) return;
    let frame = 0;
    const tick = () => {
      const d = dragRef.current;
      if (!d) return;
      const edge = 70;
      if (d.y < edge) window.scrollBy(0, -Math.ceil((edge - d.y) / 6));
      else if (d.y > window.innerHeight - edge) window.scrollBy(0, Math.ceil((d.y - (window.innerHeight - edge)) / 6));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [drag !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const onHandleKey = (e: ReactKeyboardEvent<HTMLElement>, id: string, index: number) => {
    const delta = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0;
    if (!delta) return;
    e.preventDefault();
    move(id, index + delta);
    setLayout((prev) => {
      saveLayout(prev);
      return prev;
    });
    // Keep focus on the moved handle.
    requestAnimationFrame(() => cardRefs.current.get(id)?.querySelector<HTMLElement>('[data-drag-handle]')?.focus());
  };

  /* ------------------------------------------------------------ actions */

  const addWidget = (type: WidgetType) => {
    const w = createWidget(type);
    update({ ...layout, widgets: [...layout.widgets, w] });
    setAdding(false);
    requestAnimationFrame(() => cardRefs.current.get(w.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    if (WIDGETS[type].configurable && (type === 'shopping-list' || type === 'note')) setSettingsFor(w.id);
  };

  const removeWidget = (w: WidgetInstance) => {
    if (!confirm(`Widget „${widgetTitle(w)}“ entfernen?`)) return;
    update({ ...layout, widgets: layout.widgets.filter((x) => x.id !== w.id) });
  };

  const reset = () => {
    if (!confirm('Dashboard auf die Standard-Widgets zurücksetzen? Deine Anordnung und Einstellungen gehen verloren.')) return;
    update(defaultLayout());
  };

  const settingsWidget = layout.widgets.find((w) => w.id === settingsFor);
  const dragged = drag ? layout.widgets.find((w) => w.id === drag.id) : null;

  return (
    <div className={drag ? 'select-none' : ''}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Dashboard</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Angemeldet als <strong className="text-orange-500">{host.alias}</strong>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <button type="button" className={btnSecondary} onClick={reset}>
                Zurücksetzen
              </button>
              <button type="button" className={btnSecondary} onClick={() => setAdding(true)}>
                + Widget hinzufügen
              </button>
              <button type="button" className={btnPrimary} onClick={() => setEditing(false)}>
                Fertig
              </button>
            </>
          ) : (
            <button type="button" className={btnSecondary} onClick={() => setEditing(true)}>
              <span className="inline-flex items-center gap-1">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10-3a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1v-7z" />
                </svg>
                Bearbeiten
              </span>
            </button>
          )}
        </div>
      </div>

      {editing && (
        <p className="mb-4 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800 dark:border-orange-900/50 dark:bg-orange-900/20 dark:text-orange-200">
          Bearbeiten-Modus: Widgets am Griff <span aria-hidden="true">⠿</span> ziehen (oder Griff fokussieren und Pfeiltasten nutzen), Breite mit 1 / 2 / 3 wählen, Zahnrad für Einstellungen.
        </p>
      )}

      {layout.widgets.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-10 text-center text-gray-500 dark:border-gray-600">
          <p className="mb-3">Dein Dashboard ist leer.</p>
          <button
            type="button"
            className={btnPrimary}
            onClick={() => {
              setEditing(true);
              setAdding(true);
            }}
          >
            Widget hinzufügen
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {layout.widgets.map((w, index) => {
            const meta = WIDGETS[w.type];
            const isDragged = drag?.id === w.id;
            const link = widgetLink(w);
            return (
              <section
                key={w.id}
                ref={(el) => {
                  if (el) cardRefs.current.set(w.id, el);
                  else cardRefs.current.delete(w.id);
                }}
                className={`${spanClass(w.span)} flex min-w-0 flex-col rounded-lg border bg-white p-4 dark:bg-gray-800 ${
                  isDragged ? 'border-dashed border-orange-400 opacity-40' : editing ? 'border-orange-300 dark:border-orange-800' : 'border-gray-200 dark:border-gray-700'
                }`}
                aria-label={widgetTitle(w)}
              >
                <div className="mb-3 flex items-center gap-2">
                  {editing && (
                    <button
                      type="button"
                      data-drag-handle
                      className="flex-shrink-0 cursor-grab touch-none rounded px-1 text-lg leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700 active:cursor-grabbing dark:hover:bg-gray-700 dark:hover:text-gray-200"
                      title="Ziehen zum Verschieben (Pfeiltasten: verschieben)"
                      aria-label={`${widgetTitle(w)} verschieben`}
                      onPointerDown={(e) => onHandleDown(e, w.id)}
                      onKeyDown={(e) => onHandleKey(e, w.id, index)}
                    >
                      ⠿
                    </button>
                  )}
                  <h2 className="min-w-0 flex-1 truncate text-lg font-semibold text-gray-900 dark:text-white">
                    {!editing && link ? (
                      <host.Link to={link} className="hover:text-orange-600 dark:hover:text-orange-400">
                        {widgetTitle(w)}
                      </host.Link>
                    ) : (
                      widgetTitle(w)
                    )}
                  </h2>
                  {editing && (
                    <div className="flex flex-shrink-0 items-center gap-1">
                      {meta.maxSpan > 1 && (
                        <div className="hidden overflow-hidden rounded border border-gray-300 text-xs md:flex dark:border-gray-600" role="group" aria-label="Breite">
                          {([1, 2, 3] as Span[])
                            .filter((s) => s <= meta.maxSpan)
                            .map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => setWidget(w.id, { span: s })}
                                className={`px-2 py-0.5 ${s === 3 ? 'hidden lg:block' : ''} ${w.span === s ? 'bg-orange-500 text-white' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}`}
                                title={`${s} ${s === 1 ? 'Spalte' : 'Spalten'} breit`}
                                aria-pressed={w.span === s}
                              >
                                {s}
                              </button>
                            ))}
                        </div>
                      )}
                      {meta.configurable && (
                        <button type="button" onClick={() => setSettingsFor(w.id)} className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-700 dark:hover:text-gray-200" title="Einstellungen" aria-label={`Einstellungen für ${widgetTitle(w)}`}>
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        </button>
                      )}
                      <button type="button" onClick={() => removeWidget(w)} className="rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30" title="Entfernen" aria-label={`${widgetTitle(w)} entfernen`}>
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
                {/* In edit mode the content is visible but inert, so dragging never clicks a link. */}
                <div className={`min-w-0 flex-1 ${editing ? 'pointer-events-none select-none opacity-80' : ''}`} aria-hidden={editing || undefined}>
                  <WidgetBody widget={w} onConfigChange={(config) => setWidget(w.id, { config })} />
                </div>
              </section>
            );
          })}
        </div>
      )}

      {drag && dragged && (
        <div
          className="pointer-events-none fixed z-50 overflow-hidden rounded-lg border border-orange-400 bg-white p-4 opacity-90 shadow-2xl dark:bg-gray-800"
          style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width, height: Math.min(drag.height, 180) }}
        >
          <div className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <span className="text-gray-400">⠿</span>
            {widgetTitle(dragged)}
          </div>
          <p className="mt-1 text-sm text-gray-500">{WIDGETS[dragged.type].description}</p>
        </div>
      )}

      {adding && <AddWidgetDialog layout={layout} onAdd={addWidget} onClose={() => setAdding(false)} />}
      {settingsWidget && <WidgetSettings widget={settingsWidget} onSave={(config) => setWidget(settingsWidget.id, { config })} onClose={() => setSettingsFor(null)} />}
    </div>
  );
}

function AddWidgetDialog({ layout, onAdd, onClose }: { layout: DashboardLayout; onAdd: (type: WidgetType) => void; onClose: () => void }) {
  const present = new Set(layout.widgets.map((w) => w.type));
  const categories: WidgetCategory[] = ['Tracker', 'Rezepte & Planung', 'Einkauf', 'Sonstiges'];
  return (
    <Modal title="Widget hinzufügen" onClose={onClose} wide>
      {categories.map((cat) => (
        <div key={cat} className="mb-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{cat}</h4>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {WIDGET_ORDER.filter((t) => WIDGETS[t].category === cat).map((t) => {
              const meta = WIDGETS[t];
              const taken = present.has(t) && !meta.multiple;
              return (
                <button
                  key={t}
                  type="button"
                  disabled={taken}
                  onClick={() => onAdd(t)}
                  className="rounded-lg border border-gray-200 p-3 text-left hover:border-orange-400 hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-gray-200 disabled:hover:bg-transparent dark:border-gray-700 dark:hover:bg-orange-900/20"
                >
                  <span className="block text-sm font-medium text-gray-900 dark:text-white">
                    {meta.title}
                    {taken && <span className="ml-1 text-xs font-normal text-gray-500">(schon auf dem Dashboard)</span>}
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-500">{meta.description}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </Modal>
  );
}

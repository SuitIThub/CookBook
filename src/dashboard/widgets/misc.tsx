/** Shopping, shortcut, timer, price and note widgets. */
import { useEffect, useState } from 'react';
import type { ShoppingList } from '../../types/recipe';
import { useDashboardData } from '../data';
import { SHORTCUTS, type ShortcutId, type WidgetConfigs } from '../model';
import { Async, Empty, useLoad } from '../ui';

function quantityText(q?: { amount?: number; unit?: string }): string {
  if (!q || !q.amount) return q?.unit ?? '';
  return `${q.amount.toLocaleString('de-DE', { maximumFractionDigits: 2 })} ${q.unit ?? ''}`.trim();
}

function listKind(l: ShoppingList): string {
  if (l.permanentType === 1) return 'Sammelliste';
  if (l.permanentType === 2) return 'Vorlage';
  return '';
}

/* ------------------------------------------------ Aktuelle Einkaufslisten */

export function ShoppingListsWidget({ config }: { config: WidgetConfigs['shopping-lists'] }) {
  const host = useDashboardData();
  const { Link } = host;
  const state = useLoad(() => host.shoppingLists(), []);
  return (
    <Async state={state}>
      {(lists) => {
        const openCount = (l: ShoppingList) => l.items.filter((i) => !i.isChecked).length;
        // Sammelliste first, then lists with open items, newest first.
        const relevant = lists
          .filter((l) => l.permanentType !== 2 && (config.showPermanent || !l.isPermanent))
          .filter((l) => !config.hideEmpty || l.isPermanent || openCount(l) > 0)
          .sort(
            (a, b) =>
              Number(!!b.isPermanent) - Number(!!a.isPermanent) ||
              Number(openCount(b) > 0) - Number(openCount(a) > 0) ||
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        const shown = relevant.slice(0, config.count);
        if (shown.length === 0) {
          return (
            <Empty>
              Keine Einkaufslisten.{' '}
              <Link to="/einkaufslisten?new=1" className="text-orange-600 hover:underline dark:text-orange-400">
                Neue Liste
              </Link>
            </Empty>
          );
        }
        return (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {shown.map((l) => {
              const open = l.items.filter((i) => !i.isChecked).length;
              const total = l.items.length;
              return (
                <li key={l.id}>
                  <Link to={`/einkaufsliste/${l.id}`} className="flex items-center gap-2 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">{l.title}</span>
                      <span className="block text-xs text-gray-500">
                        {[listKind(l), l.recipes.length ? `${l.recipes.length} ${l.recipes.length === 1 ? 'Rezept' : 'Rezepte'}` : ''].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs ${open ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'}`}>
                      {open ? `${open} offen` : total ? 'erledigt' : 'leer'}
                    </span>
                  </Link>
                </li>
              );
            })}
            {relevant.length > shown.length && (
              <li className="pt-2">
                <Link to="/einkaufslisten" className="text-xs text-orange-600 hover:underline dark:text-orange-400">
                  {relevant.length - shown.length} weitere Listen
                </Link>
              </li>
            )}
          </ul>
        );
      }}
    </Async>
  );
}

/* --------------------------------------------------- Einzelne Liste */

export function ShoppingListWidget({ config }: { config: WidgetConfigs['shopping-list'] }) {
  const host = useDashboardData();
  const { Link } = host;
  const state = useLoad(() => host.shoppingLists(), []);
  // Optimistic check state while the write is in flight.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const toggle = async (listId: string, itemId: string, checked: boolean) => {
    setPending((p) => ({ ...p, [itemId]: checked }));
    try {
      await host.setListItemChecked(listId, itemId, checked);
      state.reload();
    } catch (e) {
      alert(`Konnte nicht gespeichert werden: ${(e as Error).message}`);
    } finally {
      setPending(({ [itemId]: _done, ...rest }) => rest);
    }
  };
  return (
    <Async state={state}>
      {(lists) => {
        const list = lists.find((l) => l.id === config.listId);
        if (!config.listId) return <Empty>Im Bearbeiten-Modus über das Zahnrad eine Liste auswählen.</Empty>;
        if (!list) return <Empty>Die gewählte Liste gibt es nicht mehr.</Empty>;
        const items = list.items
          .map((i) => ({ ...i, isChecked: pending[i.id] ?? !!i.isChecked }))
          .filter((i) => !config.hideChecked || !i.isChecked || i.id in pending)
          .sort((a, b) => Number(a.isChecked) - Number(b.isChecked));
        const open = list.items.filter((i) => !i.isChecked).length;
        return (
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <Link to={`/einkaufsliste/${list.id}`} className="truncate text-sm font-semibold text-gray-900 hover:underline dark:text-white">
                {list.title}
              </Link>
              <span className="flex-shrink-0 text-xs text-gray-500">{open} offen</span>
            </div>
            {items.length === 0 ? (
              <Empty>Alles erledigt.</Empty>
            ) : (
              <ul className="max-h-80 space-y-0.5 overflow-y-auto">
                {items.map((i) => (
                  <li key={i.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <input type="checkbox" className="h-4 w-4 flex-shrink-0 accent-orange-500" checked={i.isChecked} onChange={(e) => toggle(list.id, i.id, e.target.checked)} />
                      <span className={`min-w-0 flex-1 truncate text-sm ${i.isChecked ? 'text-gray-400 line-through' : 'text-gray-800 dark:text-gray-200'}`}>{i.name}</span>
                      <span className="flex-shrink-0 text-xs text-gray-500">{quantityText(i.quantity)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      }}
    </Async>
  );
}

/* ------------------------------------------------------------ Shortcuts */

const SHORTCUT_ICONS: Record<ShortcutId, string> = {
  'scan-barcode': 'M3 5v14M6 5v14M9 5v14M13 5v14M16 5v14M19 5v14M21 5v14',
  'tracker-product': 'M12 4v16m8-8H4',
  'tracker-free': 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  'tracker-weight': 'M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3',
  'bulk-scan': 'M4 6h16M4 10h16M4 14h16M4 18h16',
  receipt: 'M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z',
  'import-recipe': 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12',
  'new-recipe': 'M12 4v16m8-8H4',
  'random-recipe': 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  'new-list': 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7v6m-3-3h6',
  tracker: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  recipes: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  lists: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
  products: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  ingredients: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z'
};

export function ShortcutsWidget({ config }: { config: WidgetConfigs['shortcuts'] }) {
  const { Link } = useDashboardData();
  if (config.items.length === 0) return <Empty>Im Bearbeiten-Modus über das Zahnrad Shortcuts auswählen.</Empty>;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {config.items.map((id) => {
        const s = SHORTCUTS[id];
        return (
          <Link
            key={id}
            to={s.to}
            className="flex flex-col items-center justify-center gap-1 rounded-lg border border-gray-200 p-3 text-center text-xs font-medium text-gray-700 transition-colors hover:border-orange-400 hover:bg-orange-50 hover:text-orange-700 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-orange-900/20 dark:hover:text-orange-300"
          >
            <svg className="h-6 w-6 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={SHORTCUT_ICONS[id]} />
            </svg>
            {s.label}
          </Link>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- Timer */

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`;
}

export function TimersWidget() {
  const host = useDashboardData();
  const [timers, setTimers] = useState(() => host.timers());
  useEffect(() => {
    const id = window.setInterval(() => setTimers(host.timers()), 1000);
    return () => window.clearInterval(id);
  }, [host]);
  if (timers.length === 0) return <Empty>Keine Timer aktiv. Timer startest du im Kochmodus eines Rezepts.</Empty>;
  return (
    <ul className="space-y-1">
      {timers.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-sm text-gray-900 dark:text-white">{t.label}</span>
            {t.recipeName && <span className="block truncate text-xs text-gray-500">{t.recipeName}</span>}
          </span>
          <span
            className={`flex-shrink-0 font-mono text-lg ${t.isCompleted ? 'animate-pulse text-red-500' : t.isRunning ? 'text-orange-600 dark:text-orange-400' : 'text-gray-400'}`}
          >
            {t.isCompleted ? 'fertig' : clock(t.remaining)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------- Preisänderungen */

export function PriceChangesWidget({ config }: { config: WidgetConfigs['price-changes'] }) {
  const host = useDashboardData();
  const { Link } = host;
  const state = useLoad(() => host.priceChanges(config.count), [config.count]);
  return (
    <Async state={state}>
      {(changes) =>
        changes.length === 0 ? (
          <Empty>
            Noch keine Preisänderungen — sie entstehen beim{' '}
            <Link to="/produkte/kassenbon" className="text-orange-600 hover:underline dark:text-orange-400">
              Einlesen von Kassenbons
            </Link>
            .
          </Empty>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {changes.map((c) => {
              const diff = c.price - c.previousPrice;
              const pct = c.previousPrice > 0 ? (diff / c.previousPrice) * 100 : 0;
              return (
                <li key={`${c.productId}-${c.supermarketName}`} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-gray-900 dark:text-white">{c.productName}</span>
                    <span className="block truncate text-xs text-gray-500">
                      {c.supermarketName} · {new Date(c.observedAt).toLocaleDateString('de-DE')}
                    </span>
                  </span>
                  <span className="flex-shrink-0 text-right">
                    <span className="block text-sm text-gray-900 dark:text-white">{c.price.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>
                    <span className={`block text-xs ${diff > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {diff > 0 ? '+' : '−'}
                      {Math.abs(pct).toLocaleString('de-DE', { maximumFractionDigits: 0 })} % (vorher {c.previousPrice.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })})
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )
      }
    </Async>
  );
}

/* ---------------------------------------------------------------- Notiz */

export function NoteWidget({ config, onChange }: { config: WidgetConfigs['note']; onChange: (config: WidgetConfigs['note']) => void }) {
  const [text, setText] = useState(config.text);
  // Remote change (another device) while not typing here.
  useEffect(() => setText(config.text), [config.text]);
  // Save shortly after typing stops (the layout is synced per alias).
  useEffect(() => {
    if (text === config.text) return;
    const id = window.setTimeout(() => onChange({ ...config, text }), 600);
    return () => window.clearTimeout(id);
  }, [text, config, onChange]);
  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== config.text && onChange({ ...config, text })}
      rows={5}
      placeholder="Notizen, Ideen für die Woche …"
      className="w-full resize-y rounded border border-yellow-200 bg-yellow-50 p-2 text-sm text-gray-800 focus:border-yellow-400 focus:outline-none dark:border-yellow-900/50 dark:bg-yellow-900/10 dark:text-gray-100"
    />
  );
}

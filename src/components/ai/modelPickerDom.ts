/**
 * Model picker for the website's AI settings dialog (the app's React
 * ModelPicker.tsx renders the same thing): search, favorites, per-task
 * recommendations, sorting. Logic shared via lib/modelPicker.ts.
 */
import {
  arrangeModels,
  badges,
  formatPrice,
  readFavorites,
  TASK_HINTS,
  toggleFavorite,
  type CatalogModel,
  type ModelTask,
  type SortMode
} from '../../lib/modelPicker';

const cache = new Map<string, Promise<{ models: CatalogModel[]; freeOnly?: boolean }>>();

export function loadCatalog(provider: string, apiKey: string) {
  const key = `${provider}|${apiKey}`;
  if (!cache.has(key)) {
    const p = fetch(`/api/ai/model-catalog?provider=${provider}`, { headers: apiKey ? { 'X-OpenRouter-Api-Key': apiKey } : {} }).then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      return d;
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return cache.get(key)!;
}

/** Display name of a model id ("" when unknown yet). */
export async function modelName(provider: string, apiKey: string, id: string): Promise<string> {
  if (!id) return '';
  try {
    const { models } = await loadCatalog(provider, apiKey);
    return models.find((m) => m.id === id)?.name ?? id;
  } catch {
    return id;
  }
}

const TONE = {
  good: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  info: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  muted: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export interface PickerOptions {
  provider: 'openrouter' | 'ollama';
  apiKey: string;
  task: ModelTask;
  value: string;
  /** Label of the "no own model" choice (picks ''); omit for a required choice. */
  inheritLabel?: string;
  onPick: (id: string) => void;
}

export function openModelPicker(opts: PickerOptions): void {
  let query = '';
  let sort: SortMode = 'recommended';
  let onlyRecommended = false;
  let favorites = readFavorites();
  let models: CatalogModel[] | null = null;
  let freeOnly = false;

  const overlay = el('div', 'fixed inset-0 z-[70] flex items-stretch justify-center bg-black/50 sm:items-center sm:p-4');
  overlay.setAttribute('aria-modal', 'true');
  const panel = el('div', 'flex w-full max-w-xl flex-col bg-white shadow-2xl dark:bg-gray-800 sm:max-h-[85vh] sm:rounded-xl');
  const head = el('div', 'space-y-2 border-b border-gray-200 p-3 dark:border-gray-700');
  const topRow = el('div', 'flex items-center gap-2');
  const search = el('input', 'min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100');
  search.type = 'search';
  search.placeholder = 'Modell suchen (Name oder ID) …';
  const close = el('button', 'rounded-lg px-2 py-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Schließen');
  topRow.append(search, close);

  const controls = el('div', 'flex flex-wrap items-center gap-3 text-xs text-gray-600 dark:text-gray-300');
  const sortLabel = el('label', 'flex items-center gap-1', 'Sortierung ');
  const sortSel = el('select', 'rounded border border-gray-300 bg-white px-1 py-0.5 dark:border-gray-600 dark:bg-gray-700');
  for (const [v, l] of [['recommended', 'Empfehlung'], ['price', 'Preis'], ['newest', 'Neueste'], ['name', 'Name']]) {
    const o = el('option', '', l);
    o.value = v;
    sortSel.append(o);
  }
  sortLabel.append(sortSel);
  const recLabel = el('label', 'flex items-center gap-1');
  const recBox = el('input');
  recBox.type = 'checkbox';
  recLabel.append(recBox, document.createTextNode(' nur empfohlene & Favoriten'));
  controls.append(sortLabel, recLabel);
  const hint = el('p', 'text-[11px] text-gray-500 dark:text-gray-400', TASK_HINTS[opts.task]);
  head.append(topRow, controls, hint);

  const list = el('div', 'flex-1 overflow-y-auto');
  panel.append(head, list);
  overlay.append(panel);

  const done = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') done();
  };
  const pick = (id: string) => {
    opts.onPick(id);
    done();
  };

  const row = (m: CatalogModel) => {
    const fav = favorites.has(`${opts.provider}:${m.id}`);
    const r = el('div', `flex items-start gap-2 px-3 py-2 ${m.id === opts.value ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`);
    const star = el('button', `mt-0.5 text-lg leading-none ${fav ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-400 dark:text-gray-600'}`, fav ? '★' : '☆');
    star.type = 'button';
    star.title = fav ? 'Aus Favoriten entfernen' : 'Als Favorit merken';
    star.setAttribute('aria-label', star.title);
    star.addEventListener('click', () => {
      favorites = toggleFavorite(opts.provider, m.id);
      render();
    });
    const body = el('button', 'min-w-0 flex-1 text-left');
    body.type = 'button';
    body.append(el('div', 'truncate text-sm font-medium text-gray-900 dark:text-white', m.name), el('div', 'truncate text-[11px] text-gray-500 dark:text-gray-400', m.id));
    const b = el('div', 'mt-1 flex flex-wrap items-center gap-1');
    for (const badge of badges(m, opts.task)) {
      const s = el('span', `rounded px-1.5 py-0.5 text-[10px] font-medium ${TONE[badge.tone]}`, badge.label);
      s.title = badge.title;
      b.append(s);
    }
    const price = formatPrice(m);
    if (price) b.append(el('span', 'text-[10px] text-gray-500 dark:text-gray-400', price));
    body.append(b);
    body.addEventListener('click', () => pick(m.id));
    r.append(star, body);
    return r;
  };

  const section = (title: string, items: CatalogModel[]) => {
    if (!items.length) return;
    list.append(el('div', 'sticky top-0 z-10 bg-gray-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:bg-gray-900 dark:text-gray-300', `${title} (${items.length})`));
    const box = el('div', 'divide-y divide-gray-100 dark:divide-gray-700');
    items.forEach((m) => box.append(row(m)));
    list.append(box);
  };

  function render() {
    const scroll = list.scrollTop;
    list.textContent = '';
    if (opts.inheritLabel) {
      const inherit = el('button', `block w-full px-3 py-2 text-left text-sm ${!opts.value ? 'bg-indigo-50 font-medium dark:bg-indigo-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`, opts.inheritLabel);
      inherit.type = 'button';
      inherit.addEventListener('click', () => pick(''));
      list.append(inherit);
    }
    if (!models) {
      list.append(el('p', 'p-3 text-sm text-gray-500', 'Lade Modelle …'));
      return;
    }
    const a = arrangeModels(models, { provider: opts.provider, task: opts.task, query, sort, onlyRecommended, favorites });
    section('Favoriten', a.favorites);
    section('Empfohlen für diese Aufgabe', a.recommended);
    section(a.favorites.length || a.recommended.length ? 'Weitere passende Modelle' : 'Modelle', a.others);
    if (a.total === 0) list.append(el('p', 'p-3 text-sm text-gray-500', 'Kein passendes Modell gefunden.'));
    list.scrollTop = scroll;
  }

  search.addEventListener('input', () => {
    query = search.value;
    render();
  });
  sortSel.addEventListener('change', () => {
    sort = sortSel.value as SortMode;
    render();
  });
  recBox.addEventListener('change', () => {
    onlyRecommended = recBox.checked;
    render();
  });
  close.addEventListener('click', done);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) done();
  });
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  search.focus();
  render();

  loadCatalog(opts.provider, opts.apiKey.trim())
    .then((d) => {
      models = d.models;
      freeOnly = !!d.freeOnly;
      if (opts.provider === 'openrouter' && freeOnly) hint.textContent = `${TASK_HINTS[opts.task]} Ohne eigenen API-Key sind nur kostenlose Modelle verfügbar.`;
      render();
    })
    .catch((e) => {
      list.textContent = '';
      list.append(el('p', 'p-3 text-sm text-red-600 dark:text-red-400', (e as Error).message));
    });
}

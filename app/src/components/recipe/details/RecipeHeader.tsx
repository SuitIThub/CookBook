/**
 * Port of components/recipe/details/RecipeHeader.astro: hero image with the
 * website's gradient overlays, title/subtitle/description (links + YouTube /
 * Instagram embeds), action buttons (desktop column / mobile stack),
 * "Importiert von", stated nutrition card and the metadata grid with the
 * portion stepper ("Zurücksetzen" / "Als Standard speichern").
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Recipe } from '@/types';
import { formatTime, getTotalTime } from '@shared/recipe';
import { hasNutritionValues } from '@core/nutrition';
import { assetUrl } from '@/lib/api';
import NutritionInfo from './NutritionInfo';

/* ---- description / embeds ---------------------------------------------- */

type InstaKind = 'p' | 'reel' | 'tv';
function instagramEmbed(url: string): { embedUrl: string; kind: InstaKind } | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');
    if (host !== 'instagram.com' && host !== 'instagr.am') return null;
    const [seg, code] = u.pathname.split('/').filter(Boolean);
    if (!seg || !code || !/^[\w-]+$/.test(code)) return null;
    const s = seg.toLowerCase();
    if (s === 'p') return { embedUrl: `https://www.instagram.com/p/${code}/embed`, kind: 'p' };
    if (s === 'reel' || s === 'reels') return { embedUrl: `https://www.instagram.com/reel/${code}/embed`, kind: 'reel' };
    if (s === 'tv') return { embedUrl: `https://www.instagram.com/tv/${code}/embed`, kind: 'tv' };
    return null;
  } catch {
    return null;
  }
}
const YT_RE = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
const youtubeEmbed = (text: string) => {
  const m = text.match(YT_RE);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
};
const URL_RE = /(https?:\/\/[^\s]+)/g;

function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let pos = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index! > pos) out.push(text.slice(pos, m.index));
    out.push(
      <a key={m.index} href={m[0]} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline dark:text-blue-400">
        {m[0]}
      </a>
    );
    pos = m.index! + m[0].length;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

const sizer = (k: InstaKind) => ({ height: 0, paddingBottom: k === 'reel' ? '177.777777%' : k === 'tv' ? '56.25%' : '125%' });

function Embed({ kind, src, lowBandwidth }: { kind: 'youtube' | InstaKind; src: string; lowBandwidth: boolean }) {
  const [open, setOpen] = useState(!lowBandwidth);
  useEffect(() => setOpen(!lowBandwidth), [lowBandwidth]);
  const summary = (
    <summary
      onClick={(e) => {
        e.preventDefault();
        setOpen((o) => !o);
      }}
      className={'flex cursor-pointer items-center justify-end border-b border-gray-200 bg-gray-50 px-3 py-2 focus:outline-none dark:border-gray-700 dark:bg-gray-900/40' + (kind === 'youtube' ? '' : ' rounded-t-lg')}
    >
      <span className="text-sm text-blue-600 hover:underline dark:text-blue-400">{open ? 'Einbettung ausblenden' : 'Einbettung anzeigen'}</span>
    </summary>
  );
  if (kind === 'youtube') {
    return (
      <details open={open} className="cookbook-embed mt-4 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
        {summary}
        <div className="relative w-full" style={{ paddingTop: '56.25%' }}>
          {open && <iframe src={src} title="YouTube video player" className="absolute left-0 top-0 h-full w-full" style={{ minHeight: 315 }} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />}
        </div>
      </details>
    );
  }
  return (
    <details open={open} className="cookbook-embed mt-4 overflow-visible rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
      {summary}
      <div className="w-full min-w-0 px-1 py-2 sm:px-2">
        <div className="relative mx-auto w-full max-w-[540px] overflow-hidden rounded-md bg-gray-100 ring-1 ring-gray-200/90 dark:bg-gray-900/60 dark:ring-gray-600/60" style={sizer(kind)}>
          {open && <iframe src={src} title="Instagram" className="absolute left-0 top-0 h-full w-full border-0" allow="encrypted-media; clipboard-write" referrerPolicy="strict-origin-when-cross-origin" />}
        </div>
      </div>
    </details>
  );
}

/* ---- icons --------------------------------------------------------------- */

const STAR = 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z';
const EDIT = 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z';
const UP = 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12';
const DOWN = 'M19 9l-7 7-7-7';
const DOC = 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z';
const RCB = 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10';
const PLUS = 'M12 6v6m0 0v6m0-6h6m-6 0H6';
const COOK = 'M19 8l-7 7-7-7';
const I = ({ d, cls = 'h-4 w-4 flex-shrink-0', fill = false }: { d: string; cls?: string; fill?: boolean }) => (
  <svg className={cls} fill={fill ? 'currentColor' : 'none'} stroke={fill ? undefined : 'currentColor'} viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
  </svg>
);

export interface RecipeHeaderProps {
  recipe: Recipe;
  servings: number;
  lowBandwidth: boolean;
  showFavorite: boolean;
  favorited: boolean;
  onToggleFavorite: () => void;
  onExportJson: () => void;
  onExportRcb: () => void;
  onAddToShopping: () => void;
  onServings: (n: number) => void;
  onSaveServings: () => Promise<void>;
  /** App-only: privacy (sync opt-out) toggle. */
  footer?: ReactNode;
}

export default function RecipeHeader(p: RecipeHeaderProps) {
  const { recipe } = p;
  const hero = recipe.images && recipe.images.length > 0 ? recipe.images[0] : null;
  const heroUrl = hero ? assetUrl(hero.url) : undefined;
  const hasHero = !!heroUrl && !p.lowBandwidth;
  const [exportOpen, setExportOpen] = useState<'desktop' | 'mobile' | null>(null);
  const [savingServings, setSavingServings] = useState(false);

  useEffect(() => {
    if (!exportOpen) return;
    const close = () => setExportOpen(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [exportOpen]);

  const desc = recipe.description ?? '';
  const descYt = desc ? youtubeEmbed(desc) : null;
  const descInsta = desc && !descYt ? (desc.match(URL_RE) ?? []).map(instagramEmbed).find(Boolean) ?? null : null;
  const srcYt = recipe.sourceUrl ? youtubeEmbed(recipe.sourceUrl) : null;
  const srcInsta = recipe.sourceUrl ? instagramEmbed(recipe.sourceUrl) : null;
  const original = recipe.metadata.servings;
  const changed = p.servings !== original;
  const times = recipe.metadata.timeEntries ?? [];

  const titleCls = hasHero ? 'text-gray-900 drop-shadow-lg dark:text-white dark:drop-shadow-lg' : 'text-gray-900 dark:text-white';
  const subCls = hasHero ? 'text-gray-800 drop-shadow-md dark:text-white dark:drop-shadow-md' : 'text-gray-700 dark:text-gray-300';
  const descCls = hasHero ? 'text-gray-700 drop-shadow-md dark:text-white dark:drop-shadow-md' : 'text-gray-600 dark:text-gray-400';

  const exportMenu = (where: 'desktop' | 'mobile') =>
    exportOpen === where && (
      <div className={(where === 'desktop' ? 'mt-2' : 'bottom-full mb-2') + ' absolute right-0 z-10 w-48 rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800'}>
        <div className="py-1">
          <button onClick={p.onExportJson} className="flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">
            <I d={DOC} cls="mr-2 h-4 w-4" />
            JSON (ohne Bilder)
          </button>
          <button onClick={p.onExportRcb} className="flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">
            <I d={RCB} cls="mr-2 h-4 w-4" />
            {where === 'desktop' ? 'Vollständig (mit Bilder)' : 'Vollständig (mit Bildern)'}
          </button>
        </div>
      </div>
    );

  const favButton = (mobile: boolean) =>
    p.showFavorite && (
      <button
        type="button"
        onClick={p.onToggleFavorite}
        aria-label={p.favorited ? 'Unfavorisieren' : 'Favorisieren'}
        className={
          'favorite-action-btn flex items-center space-x-2 rounded-md bg-amber-500 px-4 text-sm font-medium text-white transition-colors hover:bg-amber-600 ' +
          (mobile ? 'flex-1 justify-center py-3' : 'whitespace-nowrap py-2')
        }
      >
        <I d={STAR} fill={p.favorited} cls={'h-4 w-4' + (mobile ? '' : ' flex-shrink-0')} />
        <span>{p.favorited ? 'Unfavorisieren' : 'Favorisieren'}</span>
      </button>
    );

  return (
    <div className={'recipe-header-root mb-6 rounded-lg shadow-sm transition-colors duration-200 ' + (hasHero ? 'recipe-header-has-hero relative overflow-hidden' : 'overflow-hidden border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800')}>
      {hasHero && (
        <div className="recipe-header-hero">
          <div className="relative h-64 w-full overflow-hidden rounded-t-lg sm:h-80 md:h-96 lg:h-[28rem]">
            <img src={heroUrl} alt={recipe.title} className="h-full w-full object-cover" />
          </div>
          <div className="pointer-events-none absolute left-0 right-0 top-0 dark:hidden" style={{ height: '38rem', zIndex: 1, background: 'linear-gradient(to bottom, transparent 0%, transparent 8%, rgba(255, 255, 255, 0.1) 25%, rgba(255, 255, 255, 0.4) 45%, rgba(255, 255, 255, 0.65) 60%, rgba(255, 255, 255, 0.84) 70%, rgba(255, 255, 255, 0.94) 78%, rgba(255, 255, 255, 0.98) 84%, rgb(255, 255, 255) 88%, rgb(255, 255, 255) 100%)' }} />
          <div className="pointer-events-none absolute left-0 right-0 top-0 dark:hidden" style={{ height: '38rem', zIndex: 1, background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.02) 25%, rgba(0, 0, 0, 0.06) 45%, rgba(0, 0, 0, 0.14) 60%, rgba(0, 0, 0, 0.21) 70%, rgba(0, 0, 0, 0.27) 78%, rgba(0, 0, 0, 0.31) 84%, rgba(0, 0, 0, 0.35) 88%, rgba(0, 0, 0, 0.35) 100%)' }} />
          <div className="pointer-events-none absolute left-0 right-0 top-0 hidden dark:block" style={{ height: '38rem', zIndex: 1, background: 'linear-gradient(to bottom, transparent 0%, transparent 7%, rgba(31, 41, 55, 0.2) 25%, rgba(31, 41, 55, 0.5) 45%, rgba(31, 41, 55, 0.76) 60%, rgba(31, 41, 55, 0.9) 70%, rgba(31, 41, 55, 0.95) 78%, rgba(31, 41, 55, 0.99) 84%, rgb(31, 41, 55) 88%, rgb(31, 41, 55) 100%)' }} />
          <div className="pointer-events-none absolute left-0 right-0 top-0 hidden dark:block" style={{ height: '38rem', zIndex: 1, background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.05) 0%, rgba(0, 0, 0, 0.1) 25%, rgba(0, 0, 0, 0.2) 45%, rgba(0, 0, 0, 0.32) 60%, rgba(0, 0, 0, 0.44) 70%, rgba(0, 0, 0, 0.53) 78%, rgba(0, 0, 0, 0.57) 84%, rgba(0, 0, 0, 0.6) 88%, rgba(0, 0, 0, 0.6) 100%)' }} />
        </div>
      )}
      <div className={'recipe-header-overlap p-6 ' + (hasHero ? 'relative z-10 -mt-32 rounded-b-lg border-x border-b border-gray-200 dark:border-gray-700 sm:-mt-40 md:-mt-48 lg:-mt-64' : '')}>
        {hasHero && (
          <>
            <div className="pointer-events-none absolute inset-0 rounded-b-lg dark:hidden" style={{ zIndex: -1, background: 'linear-gradient(to bottom, transparent 0%, transparent 5%, rgba(255, 255, 255, 0.4) 15%, rgba(255, 255, 255, 0.8) 25%, rgb(255, 255, 255) 40%, rgb(255, 255, 255) 100%)' }} />
            <div className="pointer-events-none absolute inset-0 hidden rounded-b-lg dark:block" style={{ zIndex: -1, background: 'linear-gradient(to bottom, transparent 0%, transparent 5%, rgba(31, 41, 55, 0.5) 15%, rgba(31, 41, 55, 0.85) 25%, rgb(31, 41, 55) 40%, rgb(31, 41, 55) 100%)' }} />
          </>
        )}

        {/* Desktop layout */}
        <div className="mb-4 hidden items-start justify-between not-mobile:flex">
          <div className="flex-1 pr-6">
            <h1 className={`mb-2 text-3xl font-bold ${titleCls}`}>{recipe.title}</h1>
            {recipe.subtitle && <p className={`mb-3 text-xl ${subCls}`}>{recipe.subtitle}</p>}
            {desc && <p className={`whitespace-pre-wrap leading-relaxed ${descCls}`}>{linkify(desc)}</p>}
          </div>
          <div className="flex min-w-fit flex-shrink-0 flex-col space-y-2">
            {favButton(false)}
            <Link to={`/rezept/${recipe.id}/bearbeiten`} className="flex items-center space-x-2 whitespace-nowrap rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600">
              <I d={EDIT} />
              <span>Bearbeiten</span>
            </Link>
            <div className="relative flex-shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setExportOpen((o) => (o === 'desktop' ? null : 'desktop'));
                }}
                className="flex w-full items-center space-x-2 whitespace-nowrap rounded-md bg-purple-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-600"
              >
                <I d={UP} />
                <span className="flex-1 text-left">Exportieren</span>
                <I d={DOWN} />
              </button>
              {exportMenu('desktop')}
            </div>
            <button onClick={p.onAddToShopping} className="flex items-center space-x-2 whitespace-nowrap rounded-md bg-green-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-600">
              <I d={PLUS} />
              <span>Zur Einkaufsliste</span>
            </button>
            <Link to={`/rezept/${recipe.id}/kochen`} className="flex items-center space-x-2 whitespace-nowrap rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600">
              <I d={COOK} />
              <span>Kochmodus</span>
            </Link>
          </div>
        </div>

        {/* Mobile layout */}
        <div className="mb-4 hidden mobile:block">
          <div className="mb-4">
            <h1 className={`mb-2 text-2xl font-bold sm:text-3xl ${titleCls}`}>{recipe.title}</h1>
            {recipe.subtitle && <p className={`mb-3 text-lg sm:text-xl ${subCls}`}>{recipe.subtitle}</p>}
            {desc && <p className={`whitespace-pre-wrap text-sm leading-relaxed sm:text-base ${descCls}`}>{linkify(desc)}</p>}
          </div>
          <div className="flex flex-col space-y-3 sm:flex-row sm:space-x-3 sm:space-y-0">
            {favButton(true)}
            <Link to={`/rezept/${recipe.id}/bearbeiten`} className="flex flex-1 items-center justify-center space-x-2 rounded-md bg-blue-500 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-600">
              <I d={EDIT} cls="h-4 w-4" />
              <span>Bearbeiten</span>
            </Link>
            <div className="relative flex-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setExportOpen((o) => (o === 'mobile' ? null : 'mobile'));
                }}
                className="flex w-full items-center justify-center space-x-2 rounded-md bg-purple-500 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-purple-600"
              >
                <I d={UP} cls="h-4 w-4" />
                <span>Exportieren</span>
                <I d={DOWN} cls="h-4 w-4" />
              </button>
              {exportMenu('mobile')}
            </div>
            <button onClick={p.onAddToShopping} className="flex flex-1 items-center justify-center space-x-2 rounded-md bg-green-500 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-green-600">
              <I d={PLUS} cls="h-4 w-4" />
              <span>Zur Einkaufsliste</span>
            </button>
            <Link to={`/rezept/${recipe.id}/kochen`} className="flex flex-1 items-center justify-center space-x-2 rounded-md bg-orange-500 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-orange-600">
              <I d={COOK} cls="h-4 w-4" />
              <span>Kochmodus</span>
            </Link>
          </div>
        </div>

        {recipe.sourceUrl && (
          <div className="mb-4 mt-4 border-t border-gray-200 pt-4 dark:border-gray-600">
            <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
              <span>Importiert von:</span>
              <a href={recipe.sourceUrl} target="_blank" rel="noopener noreferrer" className="break-all text-blue-600 hover:underline dark:text-blue-400">
                {recipe.sourceUrl}
              </a>
            </div>
            {srcYt && <Embed kind="youtube" src={srcYt} lowBandwidth={p.lowBandwidth} />}
            {srcInsta && <Embed kind={srcInsta.kind} src={srcInsta.embedUrl} lowBandwidth={p.lowBandwidth} />}
          </div>
        )}
        {descYt && <div className="mb-6"><Embed kind="youtube" src={descYt} lowBandwidth={p.lowBandwidth} /></div>}
        {descInsta && <div className="mb-6"><Embed kind={descInsta.kind} src={descInsta.embedUrl} lowBandwidth={p.lowBandwidth} /></div>}

        {recipe.metadata.nutrition && hasNutritionValues(recipe.metadata.nutrition) && <NutritionInfo nutrition={recipe.metadata.nutrition} />}

        <div className="grid grid-cols-1 gap-4 border-t border-gray-200 pt-4 mobile:grid-cols-2 not-mobile:grid-cols-4 dark:border-gray-600">
          {original > 0 && (
            <div className="text-center">
              <div className="mb-2 text-2xl font-bold text-orange-500">
                {changed && (
                  <button onClick={() => p.onServings(original)} className="mb-2 text-xs text-orange-600 underline transition-colors hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300">
                    Zurücksetzen
                  </button>
                )}
                <div className="flex items-center justify-center space-x-2">
                  <button onClick={() => p.onServings(Math.max(1, p.servings - 1))} className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100 text-lg font-bold text-orange-600 transition-colors hover:bg-orange-200 dark:bg-orange-900 dark:text-orange-400 dark:hover:bg-orange-800">
                    −
                  </button>
                  <span>{p.servings}</span>
                  <button onClick={() => p.onServings(Math.min(99, p.servings + 1))} className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100 text-lg font-bold text-orange-600 transition-colors hover:bg-orange-200 dark:bg-orange-900 dark:text-orange-400 dark:hover:bg-orange-800">
                    +
                  </button>
                </div>
                {changed && (
                  <button
                    disabled={savingServings}
                    onClick={async () => {
                      setSavingServings(true);
                      try {
                        await p.onSaveServings();
                      } finally {
                        setSavingServings(false);
                      }
                    }}
                    title="Portionszahl und Zutatenmengen als Standard speichern"
                    className="mx-auto mt-2 flex items-center justify-center gap-1 text-xs text-green-600 underline transition-colors hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                  >
                    <I d="M5 13l4 4L19 7" cls="h-3 w-3" />
                    {savingServings ? 'Speichern...' : 'Als Standard speichern'}
                  </button>
                )}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Portionen</div>
            </div>
          )}
          {times.map((t, i) => (
            <div key={t.id || i} className="text-center">
              <div className="text-2xl font-bold text-blue-500">{formatTime(t.minutes)}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">{t.label}</div>
            </div>
          ))}
          {times.length > 1 && (
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-500">{formatTime(getTotalTime(times))}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Gesamtzeit</div>
            </div>
          )}
          {recipe.metadata.difficulty && (
            <div className="text-center">
              <div
                className={
                  'inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ' +
                  (recipe.metadata.difficulty === 'leicht'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : recipe.metadata.difficulty === 'mittel'
                      ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                      : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200')
                }
              >
                {recipe.metadata.difficulty}
              </div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">Schwierigkeit</div>
            </div>
          )}
        </div>
        {p.footer}
      </div>
    </div>
  );
}

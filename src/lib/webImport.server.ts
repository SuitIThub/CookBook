/**
 * Recipe import from web pages without structured recipe data (server-only).
 *
 * The URL import parses JSON-LD / known site markup. Pages without it (blogs,
 * small sites, magazines) are read like a reel instead: the page's visible
 * text goes to the user's structuring model, which turns it into a recipe.
 * Runs as a background job (see importJobs.server.ts); clients poll.
 *   1. fetch the page (browser-like headers, same as the URL import)
 *   2. visible text of the main content (no scripts, navigation, footer …)
 *   3. LLM: text → recipe JSON, then sanitize + catalogue spellings + step links
 *   4. recipe created like the URL import (sourceUrl, og:image as image)
 *
 * With `review` (checkbox in the import modal) the page is first imported the
 * normal way (site extractor / JSON-LD); the AI then checks that result
 * against the page text and corrects or completes it. Pages without recipe
 * data fall through to the plain AI import above.
 */
import { db } from './database.server';
import { recipeFromWebPage, reviewImportedRecipe, type AIRequestConfig } from './ai';
import { sanitizeRecipeData } from './aiRecipeSanitize';
import { catalogueCandidates, enrichRecipeData } from './recipeEnrich';
import { fetchPageHtml, NoRecipeDataError } from './recipe-extractors/base-extractor';
import { extractRecipeFromUrl, type UrlExtraction } from './urlImport.server';
import { startImportJob, type ImportJob } from './importJobs.server';
import type { RecipeImage } from '../types/recipe';

/** Enough for long recipe blogs, small enough for local models' context. */
const MAX_TEXT_CHARS = 30_000;
/** Less visible text than this is no recipe (likely a JavaScript-rendered page). */
const MIN_TEXT_CHARS = 200;

export type WebStage = 'extract' | 'download' | 'read' | 'recipe' | 'review';

export interface WebImportOptions {
  ai: AIRequestConfig;
  /** Import normally first, then let the AI check/complete the result. */
  review?: boolean;
}

/** Start a web-page import in the background; poll with getImportJob(). */
export function startWebImport(url: string, options: WebImportOptions): ImportJob<WebStage> {
  return options.review
    ? startImportJob<WebStage>('extract', 'Rezept wird ausgelesen …', (set) => runReviewedImport(url, options, set))
    : startImportJob<WebStage>('download', 'Seite wird geladen …', (set) => runWebImport(url, options, set));
}

async function runReviewedImport(
  url: string,
  options: WebImportOptions,
  set: (stage: WebStage, message: string) => void
): Promise<{ recipeId: string; warnings: string[] }> {
  let extraction: UrlExtraction;
  try {
    extraction = await extractRecipeFromUrl(url);
  } catch (e) {
    // No recipe data → nothing to review; read the page with AI instead.
    if (e instanceof NoRecipeDataError) {
      set('download', 'Keine Rezept-Daten gefunden — die KI liest die Seite …');
      return runWebImport(url, options, set);
    }
    throw friendlyFetchError(e as Error);
  }
  const { data: extracted, warnings } = extraction;

  set('download', 'Seite wird für die KI-Prüfung geladen …');
  let text = '';
  try {
    text = pageText(await fetchPageHtml(url)).slice(0, MAX_TEXT_CHARS);
  } catch (e) {
    warnings.push(`KI-Prüfung übersprungen: Seite konnte nicht erneut geladen werden (${(e as Error).message}).`);
  }

  let data: Record<string, any> = extracted;
  if (text.length >= MIN_TEXT_CHARS) {
    set('review', 'KI prüft das Rezept gegen die Seite …');
    try {
      const catalogue = db.getAllCatalogueIngredients().map((c) => c.name);
      const { images, imageUrl, sourceUrl, ...forReview } = extracted;
      const review = await reviewImportedRecipe(forReview, text, options.ai, catalogueCandidates(text, catalogue));
      const reviewed = enrichRecipeData(sanitizeRecipeData(review.recipeData, extracted.title), catalogue).data as Record<string, any>;
      // Safety net: a review that lost most ingredients is a broken answer, not a correction.
      if (countIngredients(reviewed.ingredientGroups) < Math.ceil(countIngredients(extracted.ingredientGroups) / 2)) {
        warnings.push('Die KI-Prüfung lieferte ein unvollständiges Ergebnis und wurde verworfen — es gilt der normale Import.');
      } else {
        data = {
          ...reviewed,
          // Nutrition from the page's structured data beats the AI's reading.
          metadata: { ...reviewed.metadata, nutrition: extracted.metadata?.nutrition ?? reviewed.metadata?.nutrition },
          images,
          imageUrl,
          sourceUrl
        };
        // Grouping notes of the extractor are obsolete once the AI grouped the recipe.
        const grouped = (groups: any[] | undefined) => (groups ?? []).filter((g) => g?.title).length > 0;
        for (const [hint, groups] of [['Zutaten wurden ohne Gruppierung', reviewed.ingredientGroups], ['Zubereitungsschritte wurden ohne Gruppierung', reviewed.preparationGroups]] as const) {
          const i = warnings.findIndex((w) => w.includes(hint));
          if (i >= 0 && grouped(groups)) warnings.splice(i, 1);
        }
        // One note per change (the warnings dialog lists each separately).
        warnings.unshift(
          ...(review.changes.length
            ? ['Die KI hat das importierte Rezept mit der Seite abgeglichen und angepasst:', ...review.changes.map((c) => `KI-Korrektur: ${c}`)]
            : ['Die KI hat das importierte Rezept mit der Seite abgeglichen und keine Abweichungen gefunden.'])
        );
      }
    } catch (e) {
      warnings.push(`KI-Prüfung fehlgeschlagen — es gilt der normale Import: ${(e as Error).message}`);
    }
  } else if (text) {
    warnings.push('KI-Prüfung übersprungen: Auf der Seite wurde kaum lesbarer Text gefunden.');
  }

  const recipe = db.createRecipe(data as any);
  return { recipeId: recipe.id, warnings };
}

async function runWebImport(
  url: string,
  options: WebImportOptions,
  set: (stage: WebStage, message: string) => void
): Promise<{ recipeId: string; warnings: string[] }> {
  const warnings: string[] = ['Die Seite enthält keine Rezept-Daten — das Rezept wurde per KI aus dem Seitentext erstellt. Bitte Zutaten, Mengen und Schritte prüfen.'];

  // 1. page
  const html = await fetchPageHtml(url).catch((e: Error) => {
    throw friendlyFetchError(e);
  });

  // 2. visible text
  set('read', 'Seitentext wird gelesen …');
  const meta = pageMeta(html, url);
  let text = pageText(html);
  if (text.length < MIN_TEXT_CHARS) {
    throw new Error('Auf der Seite wurde kaum lesbarer Text gefunden (sie wird vermutlich erst im Browser per JavaScript aufgebaut). Bitte das Rezept manuell eingeben.');
  }
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    warnings.push('Die Seite ist sehr lang; nur der erste Teil wurde ausgewertet.');
  }

  // 3. text → recipe JSON
  set('recipe', 'Rezept wird per KI erstellt …');
  const sources = [
    meta.title && `## Seitentitel\n${meta.title}`,
    meta.description && `## Seitenbeschreibung\n${meta.description}`,
    `## Seitentext\n${text}`
  ]
    .filter(Boolean)
    .join('\n\n');
  const catalogue = db.getAllCatalogueIngredients().map((c) => c.name);
  const raw = await recipeFromWebPage(sources, options.ai, catalogueCandidates(sources, catalogue));
  const { data } = enrichRecipeData(sanitizeRecipeData(raw, meta.title || 'Rezept von Webseite'), catalogue);
  if (!hasIngredients(data.ingredientGroups)) {
    throw new Error('Auf der Seite wurde kein Rezept gefunden.');
  }

  // 4. create the recipe (image by URL, like the JSON-LD import)
  const images: RecipeImage[] = meta.image
    ? [{ id: `imported-${Date.now()}`, filename: `imported-image-${Date.now()}.jpg`, url: meta.image, uploadedAt: new Date() }]
    : [];
  const recipe = db.createRecipe({
    ...(data as any),
    imageUrl: meta.image,
    images,
    sourceUrl: url
  });
  return { recipeId: recipe.id, warnings };
}

function friendlyFetchError(e: Error): Error {
  if (!e.message.startsWith('Failed to fetch')) return e;
  if (/timed out/.test(e.message)) return new Error('Die Website hat zu lange nicht geantwortet.');
  if (/: 403/.test(e.message)) return new Error('Die Website blockiert automatische Zugriffe.');
  return new Error(`Die Website konnte nicht geladen werden: ${e.message}`);
}

function hasIngredients(groups: unknown): boolean {
  return countIngredients(groups) > 0;
}

/** Ingredients in (possibly nested) ingredient groups. */
function countIngredients(groups: unknown): number {
  if (!Array.isArray(groups)) return 0;
  return groups.reduce(
    (n: number, g: any) =>
      n + (Array.isArray(g?.ingredients) ? g.ingredients.reduce((m: number, i: any) => m + (Array.isArray(i?.ingredients) ? countIngredients([i]) : i?.name ? 1 : 0), 0) : 0),
    0
  );
}

/* ------------------------------------------------------- HTML → text */

function metaContent(html: string, key: string): string {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  return tag ? decodeEntities(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? '').trim() : '';
}

function pageMeta(html: string, url: string): { title: string; description: string; image?: string } {
  const title = metaContent(html, 'og:title') || decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
  const description = metaContent(html, 'og:description') || metaContent(html, 'description');
  let image: string | undefined;
  const rawImage = metaContent(html, 'og:image') || metaContent(html, 'twitter:image');
  if (rawImage) {
    try {
      const abs = new URL(rawImage, url);
      if (abs.protocol === 'http:' || abs.protocol === 'https:') image = abs.href;
    } catch {
      /* ignore invalid image URL */
    }
  }
  return { title, description, image };
}

/** Visible text of the page's main content, with headings and list items kept recognisable. */
export function pageText(html: string): string {
  let body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|head|canvas|select|button)\b[\s\S]*?<\/\1>/gi, ' ');
  // Prefer the main content area if it holds a substantial part of the text.
  for (const tag of ['main', 'article']) {
    const m = body.match(new RegExp(`<${tag}\\b[\\s\\S]*<\\/${tag}>`, 'i'));
    if (m && stripTags(m[0]).length > 500) {
      body = m[0];
      break;
    }
  }
  body = body.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');
  const text = body
    .replace(/<h([1-6])\b[^>]*>/gi, '\n\n## ')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/?(p|div|section|ul|ol|table|tr|h[1-6]|li|dl|dt|dd|figure|figcaption|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<\/?(td|th)\b[^>]*>/gi, ' | ');
  return decodeEntities(stripTags(text))
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').replace(/^(\s*\|\s*)+|(\s*\|\s*)+$/g, '').trim())
    .filter((l, i, all) => l !== '' && l !== '-' && l !== '##' && !(l === all[i - 1]))
    .join('\n')
    .trim();
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', deg: '°', frac12: '½',
  frac14: '¼', frac34: '¾', times: '×', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', laquo: '«', raquo: '»',
  eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', middot: '·', bull: '•', euro: '€', shy: ''
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    return NAMED_ENTITIES[e] ?? all;
  });
}

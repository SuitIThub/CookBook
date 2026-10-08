/**
 * Recipe edit drafts — the website autosaves the edit form as a server draft
 * (/api/drafts). The app keeps them on the device (offline) under the same
 * semantics: autosave while editing, "Unvollständiger Entwurf vorhanden" on
 * the recipe page, discard/continue.
 */
const PREFIX = 'kochbuch.recipeDraft.';

export interface RecipeDraft<T = unknown> {
  form: T;
  savedAt: number;
}

export function loadRecipeDraft<T>(recipeId: string | undefined): RecipeDraft<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + (recipeId || 'new'));
    return raw ? (JSON.parse(raw) as RecipeDraft<T>) : null;
  } catch {
    return null;
  }
}
export function saveRecipeDraft(recipeId: string | undefined, form: unknown): number {
  const savedAt = Date.now();
  try {
    localStorage.setItem(PREFIX + (recipeId || 'new'), JSON.stringify({ form, savedAt }));
  } catch {
    /* quota */
  }
  return savedAt;
}
export function deleteRecipeDraft(recipeId: string | undefined): void {
  try {
    localStorage.removeItem(PREFIX + (recipeId || 'new'));
  } catch {
    /* ignore */
  }
}
export function hasRecipeDraft(recipeId: string): boolean {
  return loadRecipeDraft(recipeId) !== null;
}

/** "vor 5 Minuten" like the website's draft status bar. */
export function draftAgo(savedAt: number): string {
  const s = Math.floor((Date.now() - savedAt) / 1000);
  const m = Math.floor(s / 60);
  if (s < 1) return 'gerade eben';
  if (s === 1) return 'vor 1 Sekunde';
  if (s < 60) return `vor ${s} Sekunden`;
  if (m === 1) return 'vor 1 Minute';
  if (m < 60) return `vor ${m} Minuten`;
  const h = Math.floor(m / 60);
  if (h === 1) return 'vor 1 Stunde';
  if (h < 24) return `vor ${h} Stunden`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'vor 1 Tag' : `vor ${d} Tagen`;
}

/**
 * In-memory store for draft variant data (from AI propose-variant preview).
 * Used so the variante-neu page can load the draft server-side.
 * Entries expire after TTL_MS.
 */

const TTL_MS = 60 * 60 * 1000; // 1 hour

export interface DraftVariantData {
  parentRecipeId: string;
  variantName: string;
  recipeData: Record<string, unknown>;
  storedAt: number;
}

const store = new Map<string, DraftVariantData>();

function cleanupExpired() {
  const now = Date.now();
  for (const [key, data] of store.entries()) {
    if (now - data.storedAt > TTL_MS) store.delete(key);
  }
}

export function setDraftVariant(token: string, data: Omit<DraftVariantData, 'storedAt'>): void {
  cleanupExpired();
  store.set(token, { ...data, storedAt: Date.now() });
}

export function getDraftVariant(token: string): DraftVariantData | null {
  const data = store.get(token);
  if (!data) return null;
  if (Date.now() - data.storedAt > TTL_MS) {
    store.delete(token);
    return null;
  }
  return data;
}

export function deleteDraftVariant(token: string): boolean {
  return store.delete(token);
}

function randomToken(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function createDraftToken(data: Omit<DraftVariantData, 'storedAt'>): string {
  const token = randomToken();
  setDraftVariant(token, data);
  return token;
}

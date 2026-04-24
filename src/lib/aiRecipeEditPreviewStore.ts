const TTL_MS = 60 * 60 * 1000; // 1 hour

export interface AiEditHighlightItem {
  path: string;
  before: string;
  after: string;
}

export interface AiEditPreviewData {
  recipeId: string;
  highlights: AiEditHighlightItem[];
  diagnostics?: {
    status: 'ok' | 'no_changes' | 'parse_failed' | 'no_recipe_data';
    message: string;
    rawExcerpt?: string;
  };
  storedAt: number;
}

const store = new Map<string, AiEditPreviewData>();

function cleanupExpired() {
  const now = Date.now();
  for (const [token, data] of store.entries()) {
    if (now - data.storedAt > TTL_MS) {
      store.delete(token);
    }
  }
}

function createToken(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function createAiEditPreviewToken(
  data: Omit<AiEditPreviewData, 'storedAt'>
): string {
  cleanupExpired();
  const token = createToken();
  store.set(token, { ...data, storedAt: Date.now() });
  return token;
}

export function getAiEditPreviewToken(token: string): AiEditPreviewData | null {
  cleanupExpired();
  const data = store.get(token);
  if (!data) return null;
  if (Date.now() - data.storedAt > TTL_MS) {
    store.delete(token);
    return null;
  }
  return data;
}

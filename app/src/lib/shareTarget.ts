/**
 * "Teilen → Kochbuch" on Android (native ShareTargetPlugin). Mirrors the
 * website's /share-target route: the first http(s) URL in the shared
 * url/text/title opens the recipe import (/rezepte?importUrl=…).
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

interface SharePayload {
  text?: string | null;
  title?: string | null;
}
interface ShareTargetPlugin {
  consume(): Promise<{ share?: SharePayload }>;
  addListener(event: 'shared', fn: () => void): Promise<{ remove: () => Promise<void> }>;
}
const ShareTarget = registerPlugin<ShareTargetPlugin>('ShareTarget');

function isHttpUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Same rules as the website's pickSharedUrl (share-target.ts). */
export function pickSharedUrl(values: Array<string | null | undefined>): string | null {
  for (const raw of values) {
    const value = raw?.trim();
    if (!value) continue;
    if (isHttpUrl(value)) return value;
    const inline = value.match(/https?:\/\/[^\s<>"'`]+/i);
    if (inline && isHttpUrl(inline[0])) return inline[0];
  }
  return null;
}

/** Route incoming shares (cold start + while running). Returns a stop function. */
export function installShareTarget(navigate: (to: string) => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};
  const take = async () => {
    try {
      const { share } = await ShareTarget.consume();
      if (!share) return;
      const url = pickSharedUrl([share.text, share.title]);
      navigate(url ? `/rezepte?importUrl=${encodeURIComponent(url)}` : '/rezepte');
    } catch {
      /* plugin missing (older native build) */
    }
  };
  void take();
  const handle = ShareTarget.addListener('shared', () => void take());
  return () => void handle.then((h) => h.remove()).catch(() => {});
}

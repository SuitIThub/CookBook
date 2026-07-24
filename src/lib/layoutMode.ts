/** Layout mode for hybrid responsive chrome (nav, timer, recipe header). */

export type LayoutMode = 'mobile' | 'tablet' | 'desktop';

/** Tall portrait threshold: width/height <= 0.75 (max-aspect-ratio: 3/4). */
export const MOBILE_MAX_ASPECT = 0.75;

/** Below this width (with non-tall aspect) → tablet; at/above → desktop. */
export const DESKTOP_MIN_WIDTH = 1280;

export function getLayoutMode(
  width = typeof window !== 'undefined' ? window.innerWidth : 0,
  height = typeof window !== 'undefined' ? window.innerHeight : 0
): LayoutMode {
  if (height <= 0) return 'mobile';
  const aspect = width / height;
  if (aspect <= MOBILE_MAX_ASPECT) return 'mobile';
  if (width < DESKTOP_MIN_WIDTH) return 'tablet';
  return 'desktop';
}

export function isMobileLayout(mode: LayoutMode = getLayoutMode()): boolean {
  return mode === 'mobile';
}

export function applyLayoutModeToDocument(
  width = typeof window !== 'undefined' ? window.innerWidth : 0,
  height = typeof window !== 'undefined' ? window.innerHeight : 0
): LayoutMode {
  const mode = getLayoutMode(width, height);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.layout = mode;
  }
  return mode;
}

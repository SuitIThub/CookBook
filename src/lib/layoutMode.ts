/** Layout mode for hybrid responsive chrome (nav, timer, recipe header). */

export type LayoutMode = 'mobile' | 'tablet' | 'desktop';

/**
 * Tall-portrait threshold (width/height).
 * Keep in sync with CSS: (aspect-ratio <= 3/4)
 */
export const MOBILE_MAX_ASPECT = 0.75;

/**
 * Phone-sized short side (CSS px). Large near-square surfaces (e.g. Fold main
 * ~1968×2184) stay tablet even when the viewport aspect is reported oddly.
 * Keep in sync with CSS: (width < 600px) on the mobile query.
 */
export const MOBILE_MAX_SHORT_SIDE = 600;

/** Below this width (when not mobile) → tablet; at/above → desktop. */
export const DESKTOP_MIN_WIDTH = 1280;

export function getLayoutMode(
  width = typeof window !== 'undefined' ? window.innerWidth : 0,
  height = typeof window !== 'undefined' ? window.innerHeight : 0
): LayoutMode {
  if (height <= 0) return 'mobile';
  const aspect = width / height;
  const shortSide = Math.min(width, height);

  // Mobile only for phone-tall AND phone-sized screens.
  // Fold main (short side typically ≳ 600 CSS px, aspect ~0.9) → tablet.
  if (aspect <= MOBILE_MAX_ASPECT && shortSide < MOBILE_MAX_SHORT_SIDE) {
    return 'mobile';
  }
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

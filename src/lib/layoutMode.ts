/** Layout mode for hybrid responsive chrome (nav, timer, recipe header). */

export type LayoutMode = 'mobile' | 'tablet' | 'desktop';

/**
 * Very tall portrait (phones and fold *covers*, typically ~19.5:9 to 21:9).
 * Keep in sync with CSS: (aspect-ratio <= 0.62)
 */
export const TALL_PHONE_MAX_ASPECT = 0.62;

/**
 * Upper bound for a still-phone-like viewport after browser chrome shrinks height.
 * Fold inner screens are ~10:9 (aspect ~0.86–0.90) and must stay tablet.
 * Keep in sync with CSS: (aspect-ratio <= 0.84)
 */
export const MOBILE_CHROME_MAX_ASPECT = 0.84;

/**
 * Width cap paired with MOBILE_CHROME_MAX_ASPECT.
 * Fold 7 cover can be ≳ 600 CSS px (old floor treated it as tablet).
 * Keep in sync with CSS: (width < 700px)
 */
export const MOBILE_CHROME_MAX_WIDTH = 700;

/** Below this width (when not mobile) → tablet; at/above → desktop. */
export const DESKTOP_MIN_WIDTH = 1280;

/**
 * Phone / fold-cover portrait, including Fold 7 cover (~21:9, CSS width often
 * 540–650). Near-square fold *inner* screens stay tablet.
 */
export function isMobileViewport(width: number, height: number): boolean {
  if (height <= 0) return true;
  const aspect = width / height;
  return (
    (aspect <= TALL_PHONE_MAX_ASPECT && width < DESKTOP_MIN_WIDTH) ||
    (aspect <= MOBILE_CHROME_MAX_ASPECT && width < MOBILE_CHROME_MAX_WIDTH)
  );
}

export function getLayoutMode(
  width = typeof window !== 'undefined' ? window.innerWidth : 0,
  height = typeof window !== 'undefined' ? window.innerHeight : 0
): LayoutMode {
  if (isMobileViewport(width, height)) return 'mobile';
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

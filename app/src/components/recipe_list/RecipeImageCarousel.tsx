import { useEffect, useRef, useState } from 'react';
import type { RecipeImage } from '@/types';
import { assetUrl } from '@/lib/api';

/**
 * Mirrors the website's RecipeImageCarousel: single image is contained in an
 * h-48 box; multiple images become a translateX track with dots + prev/next
 * arrows and a 10s autoplay (paused on hover). Swipe is added for touch (a
 * mobile-appropriate extra). In list view, CSS (.view-list .rc-image) shrinks
 * this to a 7rem thumbnail and hides the controls.
 */
export default function RecipeImageCarousel({ images }: { images: RecipeImage[] }) {
  const [index, setIndex] = useState(0);
  const total = images?.length ?? 0;
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchX = useRef<number | null>(null);

  const stop = () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };
  const start = () => {
    stop();
    if (total > 1) timer.current = setInterval(() => setIndex((i) => (i + 1) % total), 10000);
  };
  useEffect(() => {
    start();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  if (!images || total === 0) {
    return (
      <div className="recipe-image-placeholder">
        <img src="/icons/icon_alpha_128.svg" alt="Kochbuch Logo" className="h-16 w-16" />
      </div>
    );
  }

  if (total === 1) {
    return (
      <div className="recipe-image-carousel relative">
        <div className="flex h-48 w-full items-center justify-center overflow-hidden bg-gray-100 dark:bg-gray-700">
          <img src={assetUrl(images[0].url)} alt="Recipe image" className="max-h-full max-w-full object-contain" />
        </div>
      </div>
    );
  }

  const go = (i: number) => setIndex((i + total) % total);

  return (
    <div
      className="recipe-image-carousel relative"
      onMouseEnter={stop}
      onMouseLeave={start}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
        stop();
      }}
      onTouchEnd={(e) => {
        const startX = touchX.current;
        const endX = e.changedTouches[0]?.clientX ?? null;
        if (startX != null && endX != null) {
          const dx = endX - startX;
          if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1));
        }
        touchX.current = null;
        start();
      }}
    >
      <div className="relative h-48 overflow-hidden">
        <div
          className="carousel-container flex h-full transition-transform duration-300"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {images.map((image, i) => (
            <div
              key={image.id || i}
              className="flex h-full w-full flex-shrink-0 items-center justify-center bg-gray-100 dark:bg-gray-700"
            >
              <img
                src={assetUrl(image.url)}
                alt={`Recipe image ${i + 1}`}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          ))}
        </div>

        <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 transform space-x-1">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                go(i);
              }}
              aria-label={`Bild ${i + 1}`}
              className={'carousel-dot h-2 w-2 rounded-full bg-white ' + (i === index ? 'opacity-100' : 'opacity-50')}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            go(index - 1);
          }}
          aria-label="Vorheriges Bild"
          className="carousel-prev absolute left-2 top-1/2 flex h-6 w-6 -translate-y-1/2 transform items-center justify-center rounded-full bg-black bg-opacity-50 text-white"
        >
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            go(index + 1);
          }}
          aria-label="Nächstes Bild"
          className="carousel-next absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 transform items-center justify-center rounded-full bg-black bg-opacity-50 text-white"
        >
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

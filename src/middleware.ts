import { defineMiddleware } from 'astro:middleware';

/** Keep recipe HTML/JS/CSS out of browser and PWA HTTP caches. */
export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
  }
  return response;
});

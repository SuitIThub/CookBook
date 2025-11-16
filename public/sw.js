const CACHE_NAME = 'kochbuch-v1';
const urlsToCache = [
  '/favicon.svg',
  '/manifest.json'
];

// Install service worker and cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch event - different strategies for different types of requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const request = event.request;
  
  // Don't cache HTML pages - always fetch fresh to avoid stale JavaScript state
  // This is especially important for PWA back button navigation
  if (request.method === 'GET' && 
      request.headers.get('accept')?.includes('text/html')) {
    // For HTML pages, always fetch from network (no caching)
    // This prevents stale JavaScript state when navigating back in PWA
    event.respondWith(
      fetch(request)
        .catch(() => {
          // Only fall back to cache if network completely fails
          return caches.match(request);
        })
    );
    return;
  }
  
  // For API requests, use network-first but don't cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }
  
  // For dynamic pages (recipe list, shopping list, individual recipes), use network-first
  // But don't cache them to avoid stale state
  if (url.pathname === '/' || 
      url.pathname === '/einkaufsliste' || 
      url.pathname.startsWith('/rezept/')) {
    event.respondWith(
      fetch(request)
        .catch(() => {
          // Only fall back to cache if network fails
          return caches.match(request);
        })
    );
    return;
  }
  
  // For static assets (JS, CSS, images, etc.), use cache-first strategy
  event.respondWith(
    caches.match(request)
      .then((response) => {
        // Return cached version or fetch from network
        return response || fetch(request).then((response) => {
          // Cache static assets for offline access
          if (response.ok) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        });
      })
  );
});

// Activate service worker and clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      ).then(() => {
        // Also clear any cached HTML pages from the current cache
        // to prevent stale JavaScript state
        return caches.open(CACHE_NAME).then((cache) => {
          return cache.keys().then((keys) => {
            return Promise.all(
              keys.map((request) => {
                // Delete any cached HTML pages
                if (request.headers.get('accept')?.includes('text/html') ||
                    request.url.endsWith('/') ||
                    request.url.includes('/rezepte') ||
                    request.url.includes('/einkaufsliste')) {
                  return cache.delete(request);
                }
              })
            );
          });
        });
      });
    })
  );
}); 
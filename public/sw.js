const CACHE_NAME = 'kochbuch-v1';
const urlsToCache = [
  '/favicon.svg',
  '/manifest.json',
  '/icons/icon-72x72.svg',
  '/icons/icon-96x96.svg',
  '/icons/icon-128x128.svg',
  '/icons/icon-144x144.svg',
  '/icons/icon-152x152.svg',
  '/icons/icon-192x192.svg',
  '/icons/icon-384x384.svg',
  '/icons/icon-512x512.svg'
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
  
  // For SVG icons, use cache-first strategy
  if (url.pathname.endsWith('.svg')) {
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          if (response) {
            return response;
          }
          return fetch(event.request)
            .then((response) => {
              // Clone the response before using it
              const responseToCache = response.clone();
              
              // Cache the fetched response
              caches.open(CACHE_NAME)
                .then((cache) => {
                  cache.put(event.request, responseToCache);
                });
              
              return response;
            });
        })
    );
  }
  // For dynamic pages (recipe list, shopping list, individual recipes), use network-first
  else if (url.pathname === '/' || 
      url.pathname === '/einkaufsliste' || 
      url.pathname.startsWith('/rezept/') ||
      url.pathname.startsWith('/api/')) {
    
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // If network request succeeds, clone and cache the response for offline access
          if (response.ok) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          // If network fails, try to serve from cache
          return caches.match(event.request);
        })
    );
  } 
  // For all other static assets, use cache-first strategy
  else {
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          // Return cached version or fetch from network
          return response || fetch(event.request);
        })
    );
  }
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
      );
    })
  );
}); 
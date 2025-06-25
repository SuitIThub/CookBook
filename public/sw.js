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

// Helper function to handle network requests with timeout
const timeoutFetch = (request, timeout = 5000) => {
  return Promise.race([
    fetch(request),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), timeout)
    )
  ]);
};

// Install service worker and cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(urlsToCache)
          .catch(error => {
            console.error('Failed to cache initial resources:', error);
            // Continue installation even if caching fails
            return Promise.resolve();
          });
      })
  );
  // Activate immediately
  self.skipWaiting();
});

// Fetch event - different strategies for different types of requests
self.addEventListener('fetch', (event) => {
  // Ignore non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension requests
  if (event.request.url.startsWith('chrome-extension://')) return;

  // Handle cast SDK requests differently
  if (event.request.url.includes('gstatic.com/cv/js/sender')) {
    event.respondWith(
      timeoutFetch(event.request)
        .catch(() => {
          console.error('Failed to fetch Cast SDK');
          return new Response('', {
            status: 500,
            statusText: 'Failed to load Cast SDK'
          });
        })
    );
    return;
  }

  const url = new URL(event.request.url);
  
  // For SVG icons and static assets, use cache-first strategy
  if (url.pathname.endsWith('.svg') || url.pathname.endsWith('.json')) {
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          if (response) {
            return response;
          }
          return timeoutFetch(event.request)
            .then((response) => {
              if (!response || response.status !== 200) {
                throw new Error('Failed to fetch');
              }
              // Clone the response before using it
              const responseToCache = response.clone();
              
              // Cache the fetched response
              caches.open(CACHE_NAME)
                .then((cache) => {
                  cache.put(event.request, responseToCache)
                    .catch(error => console.error('Failed to cache:', error));
                })
                .catch(error => console.error('Failed to open cache:', error));
              
              return response;
            })
            .catch(error => {
              console.error('Fetch failed:', error);
              // Return a fallback response or rethrow
              return caches.match('/favicon.svg')
                .then(fallback => fallback || Promise.reject(error));
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
      timeoutFetch(event.request)
        .then((response) => {
          // If network request succeeds, clone and cache the response for offline access
          if (response.ok) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache)
                  .catch(error => console.error('Failed to cache:', error));
              })
              .catch(error => console.error('Failed to open cache:', error));
          }
          return response;
        })
        .catch(() => {
          // If network fails, try to serve from cache
          return caches.match(event.request)
            .then(response => response || Promise.reject('No cached version available'));
        })
    );
  } 
  // For all other requests, use cache-first strategy
  else {
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          if (response) {
            return response;
          }
          return timeoutFetch(event.request)
            .catch(error => {
              console.error('Fetch failed:', error);
              return new Response('', {
                status: 500,
                statusText: 'Failed to fetch resource'
              });
            });
        })
    );
  }
});

// Activate service worker and clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        // Take control of all clients immediately
        return clients.claim();
      })
  );
}); 
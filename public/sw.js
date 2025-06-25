const CACHE_NAME = 'kochbuch-v3';
const STATIC_CACHE = 'static-v3';
const DYNAMIC_CACHE = 'dynamic-v3';
const OFFLINE_DB_NAME = 'offlineStorage';
const OFFLINE_STORE_RECIPES = 'offlineRecipes';
const OFFLINE_STORE_SHOPPING_LISTS = 'offlineShoppingLists';
const OFFLINE_STORE_ASSETS = 'offlineAssets';

// Essential assets that should be cached for offline use
const staticAssets = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/manifest.json',
  '/einkaufslisten',
  '/einkaufsliste',
  '/sw.js',
  // Add CSS files
  '/_astro/components.*.css',
  // Add client-side JavaScript
  '/_astro/*.js',
  // Add icons
  '/icons/icon-72x72.svg',
  '/icons/icon-96x96.svg',
  '/icons/icon-128x128.svg',
  '/icons/icon-144x144.svg',
  '/icons/icon-152x152.svg',
  '/icons/icon-192x192.svg',
  '/icons/icon-384x384.svg',
  '/icons/icon-512x512.svg'
];

// Notify all clients
function notifyClients(message) {
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage(message);
    });
  });
}

// Open IndexedDB
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Create object stores if they don't exist
      if (!db.objectStoreNames.contains(OFFLINE_STORE_RECIPES)) {
        db.createObjectStore(OFFLINE_STORE_RECIPES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORE_SHOPPING_LISTS)) {
        db.createObjectStore(OFFLINE_STORE_SHOPPING_LISTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORE_ASSETS)) {
        db.createObjectStore(OFFLINE_STORE_ASSETS, { keyPath: 'url' });
      }
    };
  });
}

// Store data in IndexedDB
async function storeData(storeName, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(data);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

// Retrieve data from IndexedDB
async function getData(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

// Install service worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then(async cache => {
        // Cache static assets
        const staticCache = await cache.addAll(staticAssets);
        
        // Also try to cache all _astro/* files (they might have dynamic names)
        try {
          const response = await fetch('/');
          const html = await response.text();
          const matches = html.match(/\/_astro\/[^"']+/g) || [];
          await Promise.all(
            matches.map(async (url) => {
              try {
                const res = await fetch(url);
                if (res.ok) {
                  await cache.put(url, res);
                }
              } catch (e) {
                console.error('Failed to cache:', url, e);
              }
            })
          );
        } catch (e) {
          console.error('Failed to cache dynamic assets:', e);
        }
        return staticCache;
      }),
      openDB()
    ])
  );
  // Activate immediately
  self.skipWaiting();
});

// Fetch event handler
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Handle API requests
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(event.request));
  }
  // Handle navigation requests (HTML pages)
  else if (event.request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(event.request));
  }
  // Handle static assets
  else {
    event.respondWith(handleStaticRequest(event.request));
  }
});

// Handle navigation requests
async function handleNavigationRequest(request) {
  try {
    // Try network first
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
      return response;
    }
  } catch (error) {
    console.log('Navigation fetch failed, trying cache:', error);
  }

  // If network fails, try cache
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  // If cache fails, try to return cached home page as fallback
  const homePage = await caches.match('/');
  if (homePage) {
    return homePage;
  }

  // If all fails, return simple offline page
  return new Response(
    `<!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Offline - Kochbuch</title>
      <style>
        body { font-family: system-ui; padding: 2rem; max-width: 600px; margin: 0 auto; text-align: center; }
        .icon { font-size: 4rem; margin-bottom: 1rem; }
      </style>
    </head>
    <body>
      <div class="icon">📱</div>
      <h1>Offline</h1>
      <p>Diese Seite ist offline nicht verfügbar. Bitte stelle eine Internetverbindung her und versuche es erneut.</p>
      <p>Du kannst aber trotzdem auf deine gespeicherten Offline-Inhalte zugreifen.</p>
      <p><a href="/">Zur Startseite</a></p>
    </body>
    </html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    }
  );
}

// Handle API requests
async function handleApiRequest(request) {
  const url = new URL(request.url);
  
  try {
    // Try network first
    const response = await fetch(request);
    if (response.ok) {
      // Clone and cache successful responses
      const responseToCache = response.clone();
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, responseToCache);
      return response;
    }
  } catch (error) {
    console.log('API fetch failed, trying IndexedDB:', error);
    
    // Network failed, try offline data
    if (url.pathname.startsWith('/api/recipes/')) {
      const recipeId = url.pathname.split('/').pop();
      const offlineData = await getData(OFFLINE_STORE_RECIPES, recipeId);
      if (offlineData) {
        return new Response(JSON.stringify(offlineData), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    if (url.pathname.startsWith('/api/shopping-lists/')) {
      const listId = url.pathname.split('/').pop();
      const offlineData = await getData(OFFLINE_STORE_SHOPPING_LISTS, listId);
      if (offlineData) {
        return new Response(JSON.stringify(offlineData), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Try cache as last resort
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
  }
  
  // If all fails, return offline error response
  return new Response(JSON.stringify({ error: 'offline' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Handle static requests
async function handleStaticRequest(request) {
  // Try cache first for static assets
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    // If not in cache, try network
    const response = await fetch(request);
    if (response.ok) {
      // Cache successful responses
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
      return response;
    }
  } catch (error) {
    console.log('Static fetch failed, trying offline assets:', error);
    // For images, try offline assets store
    if (request.url.match(/\.(jpg|jpeg|png|gif|svg)$/)) {
      const offlineAsset = await getData(OFFLINE_STORE_ASSETS, request.url);
      if (offlineAsset) {
        return new Response(offlineAsset.data, {
          headers: { 'Content-Type': offlineAsset.type }
        });
      }
    }
  }
  
  // If all fails, return appropriate error response
  return new Response('Offline', { status: 503 });
}

// Activate and clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (![STATIC_CACHE, DYNAMIC_CACHE].includes(cacheName)) {
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Clean up old IndexedDB data (optional)
      openDB().then(db => {
        // You could add cleanup logic here if needed
      })
    ]).then(() => {
      // Take control immediately
      return clients.claim();
    })
  );
});

// Listen for messages from the client
self.addEventListener('message', async (event) => {
  if (event.data.action === 'CACHE_RECIPE') {
    try {
      // Cache the recipe data
      await Promise.all([
        storeData(OFFLINE_STORE_RECIPES, event.data.recipe),
        // Cache recipe images
        ...(event.data.recipe.images || []).map(async (image) => {
          try {
            const response = await fetch(image.url);
            const blob = await response.blob();
            await storeData(OFFLINE_STORE_ASSETS, {
              url: image.url,
              data: blob,
              type: blob.type
            });
          } catch (e) {
            console.error('Failed to cache recipe image:', image.url, e);
          }
        })
      ]);
      
      // Cache the recipe page
      const cache = await caches.open(DYNAMIC_CACHE);
      const recipePage = await fetch(`/rezept/${event.data.recipe.id}`);
      if (recipePage.ok) {
        await cache.put(`/rezept/${event.data.recipe.id}`, recipePage);
      }
      
      // Notify clients that caching is complete
      notifyClients({
        type: 'CACHE_COMPLETE',
        message: `Rezept "${event.data.recipe.title}" wurde für Offline-Nutzung gespeichert`
      });
    } catch (error) {
      console.error('Error caching recipe:', error);
      notifyClients({
        type: 'CACHE_ERROR',
        message: 'Fehler beim Speichern des Rezepts für Offline-Nutzung'
      });
    }
  }
  
  if (event.data.action === 'CACHE_SHOPPING_LIST') {
    try {
      // Cache the shopping list data
      await storeData(OFFLINE_STORE_SHOPPING_LISTS, event.data.shoppingList);
      
      // Cache the shopping list page
      const cache = await caches.open(DYNAMIC_CACHE);
      const listPage = await fetch(`/einkaufsliste/${event.data.shoppingList.id}`);
      if (listPage.ok) {
        await cache.put(`/einkaufsliste/${event.data.shoppingList.id}`, listPage);
      }
      
      // Notify clients that caching is complete
      notifyClients({
        type: 'CACHE_COMPLETE',
        message: `Einkaufsliste "${event.data.shoppingList.title}" wurde für Offline-Nutzung gespeichert`
      });
    } catch (error) {
      console.error('Error caching shopping list:', error);
      notifyClients({
        type: 'CACHE_ERROR',
        message: 'Fehler beim Speichern der Einkaufsliste für Offline-Nutzung'
      });
    }
  }
}); 
const CACHE_NAME = 'kochbuch-v2';
const STATIC_CACHE = 'static-v2';
const DYNAMIC_CACHE = 'dynamic-v2';
const OFFLINE_DB_NAME = 'offlineStorage';
const OFFLINE_STORE_RECIPES = 'offlineRecipes';
const OFFLINE_STORE_SHOPPING_LISTS = 'offlineShoppingLists';
const OFFLINE_STORE_ASSETS = 'offlineAssets';

const staticAssets = [
  '/favicon.svg',
  '/manifest.json',
  '/index.html',
  '/',
  '/einkaufslisten',
];

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
      caches.open(STATIC_CACHE).then(cache => cache.addAll(staticAssets)),
      openDB()
    ])
  );
});

// Fetch event handler
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Handle API requests
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(event.request));
  }
  // Handle static assets
  else {
    event.respondWith(handleStaticRequest(event.request));
  }
});

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
  // Try cache first
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
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (![STATIC_CACHE, DYNAMIC_CACHE].includes(cacheName)) {
              return caches.delete(cacheName);
            }
          })
        );
      })
    ])
  );
});

// Listen for messages from the client
self.addEventListener('message', (event) => {
  if (event.data.action === 'CACHE_RECIPE') {
    event.waitUntil(
      Promise.all([
        storeData(OFFLINE_STORE_RECIPES, event.data.recipe),
        // Cache recipe images
        ...(event.data.recipe.images || []).map(async (image) => {
          const response = await fetch(image.url);
          const blob = await response.blob();
          return storeData(OFFLINE_STORE_ASSETS, {
            url: image.url,
            data: blob,
            type: blob.type
          });
        })
      ])
    );
  }
  
  if (event.data.action === 'CACHE_SHOPPING_LIST') {
    event.waitUntil(
      storeData(OFFLINE_STORE_SHOPPING_LISTS, event.data.shoppingList)
    );
  }
}); 
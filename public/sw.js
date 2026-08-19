const CACHE_NAME = 'kochbuch-v7';
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
  // Activate updated service worker immediately
  self.skipWaiting();
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
  
  // For static assets (JS, CSS, images, etc.), use network-first so updated
  // styles/scripts are picked up immediately; fall back to cache when offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => caches.match(request))
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
      .then(() => {
        // Take control of all clients immediately
        return self.clients.claim();
      })
  );
});

// -----------------------------------------------------------------------------
// Best-effort meal-plan reminders
// -----------------------------------------------------------------------------
// The main app posts { type: 'schedule-reminder', reminder: {...} } from its
// script context. The SW keeps a small in-memory queue and shows notifications
// when the deadline is reached and the SW is still alive (visits, syncs, etc.).
// This is intentionally best-effort — without a push server, we cannot wake the
// SW from a cold state, so the tracker UI communicates this limitation clearly.
const REMINDER_QUEUE = new Map();

function scheduleReminder(reminder) {
  if (!reminder || !reminder.id || !reminder.at) return;
  const at = new Date(reminder.at).getTime();
  if (!Number.isFinite(at)) return;
  REMINDER_QUEUE.set(reminder.id, reminder);
  const delay = at - Date.now();
  if (delay <= 0) {
    fireReminder(reminder.id);
    return;
  }
  // Guard against very large timeouts (limit ~1 day).
  const timeout = Math.min(delay, 24 * 60 * 60 * 1000);
  setTimeout(() => fireReminder(reminder.id), timeout);
}

function fireReminder(id) {
  const reminder = REMINDER_QUEUE.get(id);
  if (!reminder) return;
  REMINDER_QUEUE.delete(id);
  try {
    self.registration.showNotification(reminder.title || 'Kochbuch-Erinnerung', {
      body: reminder.body || '',
      tag: `plan-${id}`,
      icon: '/favicon.svg',
      data: reminder.data || { url: '/tracker' },
      requireInteraction: false,
    });
  } catch (err) {
    console.warn('Failed to show reminder notification', err);
  }
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'schedule-reminder') scheduleReminder(data.reminder);
  if (data.type === 'clear-reminder' && data.id) REMINDER_QUEUE.delete(data.id);
});

self.addEventListener('notificationclick', (event) => {
  const targetUrl = (event.notification.data && event.notification.data.url) || '/tracker';
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((clients) => {
    for (const client of clients) {
      if ('focus' in client) { client.navigate(targetUrl); return client.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
  }));
});

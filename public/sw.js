const CACHE_NAME = 'kochbuch-v6';
const urlsToCache = [
  '/favicon.svg',
  '/manifest.json'
];

function isAppCodeRequest(request, url) {
  const dest = request.destination;
  if (dest === 'document' || dest === 'script' || dest === 'style' || dest === 'worker') return true;
  const path = url.pathname;
  if (path === '/sw.js' || path.startsWith('/api/')) return true;
  if (path.startsWith('/@vite') || path.startsWith('/@fs') || path.startsWith('/src/')) return true;
  if (path.startsWith('/_astro/') || path.startsWith('/node_modules/')) return true;
  if (request.method === 'GET' && request.headers.get('accept')?.includes('text/html')) return true;
  if (path === '/' || path === '/einkaufsliste' || path.startsWith('/rezept/') || path.startsWith('/rezepte')) return true;
  return false;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const request = event.request;

  if (request.method !== 'GET') return;

  // HTML, JS, CSS, API and Vite/dev URLs must never come from Cache Storage.
  // Stale app code was serving the old product-picker layout and skipping persist.
  if (isAppCodeRequest(request, url)) {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(() => caches.match(request))
    );
    return;
  }

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

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) return caches.delete(cacheName);
        })
      ))
      .then(() => caches.open(CACHE_NAME).then((cache) => (
        cache.keys().then((keys) => Promise.all(
          keys.map((request) => {
            const url = new URL(request.url);
            if (isAppCodeRequest(request, url)) return cache.delete(request);
          })
        ))
      )))
      .then(() => self.clients.claim())
  );
});

// -----------------------------------------------------------------------------
// Best-effort meal-plan reminders
// -----------------------------------------------------------------------------
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

const CACHE_NAME = 'ntk-note-offline-v12';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/ntk-icon.svg',
  '/apple-touch-icon.png',
  '/ntk-icon-192.png',
  '/ntk-icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
  );
  // v2.8: Do NOT automatically skipWaiting during install.
  // Wait for client message so user edits are not interrupted.
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('ntk-note-offline-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

// ── Notification deep-link handler ──
// Reads action metadata from the notification payload and navigates
// to the correct deep-link URL within the app.
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const data = event.notification.data || {};
  const { action, noteId } = data;

  // Build deep-link URL based on notification action metadata
  let targetPath = '/';
  if (action === 'open-note' && noteId) {
    targetPath = `/?action=open-note&noteId=${encodeURIComponent(noteId)}`;
  } else if (action === 'open-reminder') {
    const reminderParam = data.entityId ? `&reminderId=${encodeURIComponent(data.entityId)}` : '';
    targetPath = `/?action=open-reminder${reminderParam}`;
  } else if (action === 'open-share-center' || action === 'open-shared') {
    const noteParam = noteId ? `&noteId=${encodeURIComponent(noteId)}` : '';
    targetPath = `/?action=open-share-center${noteParam}`;
  } else if (action === 'open-calendar') {
    targetPath = '/?action=open-calendar';
  } else if (action === 'open-settings') {
    targetPath = '/?action=open-settings';
  } else if (action === 'open-trash') {
    targetPath = '/?action=open-trash';
  }

  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Find an existing app window on the same origin
        const appClient = clientList.find(client => {
          try {
            return new URL(client.url).origin === self.location.origin;
          } catch {
            return false;
          }
        });

        if (appClient) {
          // Navigate existing window to the deep-link and focus it
          return appClient.navigate(targetUrl).then(client => client?.focus());
        }

        // No existing window — open a new one
        return self.clients.openWindow(targetUrl);
      })
  );
});

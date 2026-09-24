/**
 * Service Worker for Treino PWA - Offline First Strategy
 * 
 * Caches essential assets for offline functionality.
 * Implements versioned cache strategy to avoid users being stuck
 * on old JavaScript versions.
 */

const CACHE_VERSION = 'treino-cache-v1';
const CACHE_NAME = `treino-${CACHE_VERSION}`;

// Assets to cache for offline functionality
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/service-worker.js',
  '/css/styles.css',
  '/js/app.js',
  '/js/db.js',
  '/js/workout-service.js',
  '/js/migration.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/favicon.ico',
];

// Install event - cache essential assets
self.addEventListener('install', (event) => {
  // Skip waiting to become active immediately
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // Cache all essential assets
        return cache.addAll(ASSETS_TO_CACHE)
          .then(() => {
            // Log successful caching
            console.log('[ServiceWorker] Cache static assets');
          })
          .catch((err) => {
            console.error('[ServiceWorker] Failed to cache assets:', err);
          });
      })
      .catch((err) => {
        console.error('[ServiceWorker] Failed to open cache:', err);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          // Delete caches that don't match current version
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );

  // Take control of the page immediately
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Don't cache API calls or other non-cacheable requests
  const url = new URL(event.request.url);

  // Skip caching for URLs with query parameters (dynamic content)
  if (url.search) {
    // For API requests or dynamic content, try network first
    event.respondWith(
      fetch(event.request).catch(() => {
        console.error('[ServiceWorker] Network fetch failed for', url.href);
      })
    );
    return;
  }

  // For same-origin requests, use cache-first strategy
  if (url.origin === self.location.origin || url.origin === 'null') {
    event.respondWith(
      caches.match(event.request).then((response) => {
        if (response) {
          // Return cached version
          return response;
        }

        // Fallback to network
        return fetch(event.request).then((networkResponse) => {
          // Don't cache if not a valid response
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }

          // Clone the response
          const responseToCache = networkResponse.clone();

          caches.open(CACHE_NAME).then((cache) => {
            // Don't cache if already in cache or if it's a navigation request we want to update
            cache.put(event.request, responseToCache).catch((err) => {
              console.error('[ServiceWorker] Failed to cache', url.href, err);
            });
          });

          return networkResponse;
        }).catch((err) => {
          console.error('[ServiceWorker] Network error for', url.href, err);
          // If offline and no cache, show offline page
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
    );
  } else {
    // Cross-origin requests - cache first for common assets
    event.respondWith(
      caches.match(event.request).then((response) => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
    );
  }
});

// Message event - handle messages from the page
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Background sync for data persistence when back online
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    event.waitUntil(performBackgroundSync());
  }
});

/**
 * Perform background sync when back online.
 * Retries failed operations from offline use.
 */
async function performBackgroundSync() {
  // This can be extended to retry failed IndexedDB operations
  // or sync data that was entered while offline
  console.log('[ServiceWorker] Performing background sync');
}

/**
 * Get the current cache version for debugging/versioning
 * @returns {string}
 */
self.getCacheVersion = () => CACHE_VERSION;

/**
 * Force an update of the service worker and clear old caches
 */
self.forceUpdate = () => {
  clients.clain();
  caches.keys().then((keys) => {
    keys.forEach((key) => {
      if (key !== CACHE_NAME) {
        caches.delete(key);
      }
    });
  });
};
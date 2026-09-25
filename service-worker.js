/**
 * Service Worker for Treino PWA - Offline First Strategy
 *
 * Caches essential assets for offline functionality.
 * Implements versioned cache strategy to avoid users being stuck
 * on old JavaScript versions.
 * Handles GitHub Pages subdirectory deployment correctly.
 */

// Bump the version whenever cached assets change so clients drop stale copies.
const CACHE_VERSION = 'treino-cache-v7';
let cacheName = `treino-${CACHE_VERSION}`;

// We'll determine the base path dynamically during install
const ASSETS_TO_CACHE = [];

self.addEventListener('install', (event) => {
  self.skipWaiting();

  event.waitUntil(
    (async () => {
      // Determine base path from the service worker's scope
      // The scope is set when the SW is registered and reflects the directory
      // where the SW script is located relative to the domain root.
      const scope = self.registration.scope;
      let basePath = '/';

      // If scope is not just '/', we need to extract the path prefix
      // e.g., if scope is 'https://example.com/treino/', basePath becomes '/treino/'
      if (scope && scope !== '/') {
        const url = new URL(scope, 'http://localhost');
        basePath = url.pathname; // e.g., '/treino/'
      }

      const cache = await caches.open(cacheName);

      // Build the asset list based on the base path
      // For GitHub Pages root deployment, use root-relative paths
      // For subdirectory deployment, prepend the basePath
      const assets = [
        'index.html',
        'manifest.json',
        'service-worker.js',
        'css/styles.css',
        'js/app.js',
        'js/db.js',
        'js/plano.js',
        'js/workout-service.js',
        'js/measurement-service.js',
        'js/report-service.js',
        'js/backup-service.js',
        'js/rotina-service.js',
        'js/cardio-service.js',
        'js/timer-service.js',
        'icons/icon-192.png',
        'icons/icon-512.png',
      ];

      // Cache each asset
      for (const asset of assets) {
        const url = new URL(asset, self.location.origin);
        // If we're in a subdirectory, prepend the basePath
        if (basePath !== '/') {
          url.pathname = basePath + asset;
        } else {
          // For root, make sure it's path-absolute
          url.pathname = '/' + asset;
        }
        try {
          await cache.add(url.href);
          console.log(`[ServiceWorker] Cached: ${asset}`);
        } catch (err) {
          console.warn(`[ServiceWorker] Failed to cache ${asset}:`, err);
        }
      }

      console.log('[ServiceWorker] Cache static assets complete');
    })().catch((err) => {
      console.error('[ServiceWorker] Failed during install:', err);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== cacheName) {
          return caches.delete(key);
        }
      }));
    })
  );

  // Take control of the page immediately
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // Skip caching for URLs with query parameters
  if (url.search) {
    event.respondWith(
      fetch(event.request).catch(() => {
        console.error('[ServiceWorker] Network fetch failed for', url.href);
      })
    );
    return;
  }

  // Determine if this is a same-origin request
  const isSameOrigin = url.origin === self.location.origin || url.origin === 'null';

  if (isSameOrigin) {
    event.respondWith(
      caches.match(event.request).then((response) => {
        if (response) {
          return response;
        }

        return fetch(event.request).then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }

          const responseToCache = networkResponse.clone();

          caches.open(cacheName).then((cache) => {
            // Construct the cache key the same way as during install
            const assetName = event.request.url.replace(self.location.origin, '');
            const basePath = self.registration.scope ? 
              new URL(self.registration.scope).pathname : '/';
            
            const cacheKey = new URL(assetName, self.location.origin).href;
            
            try {
              cache.put(cacheKey, responseToCache);
            } catch (err) {
              console.error('[ServiceWorker] Failed to cache', event.request.url, err);
            }
          });

          return networkResponse;
        }).catch((err) => {
          console.error('[ServiceWorker] Network error for', url.href, err);
          if (event.request.mode === 'navigate') {
            return caches.match('index.html');
          }
        });
      })
    );
  } else {
    // Cross-origin requests
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
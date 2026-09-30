/**
 * PWA glue: registers the service worker and surfaces its lifecycle messages.
 *
 * Kept out of index.html so the page has no inline scripts and the whole
 * application lives in js/.
 */

import { showToast } from './core/toast.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js')
      .then((registration) => {
        console.log('[PWA] Service Worker registered with scope:', registration.scope);

        registration.onupdatefound = () => {
          const installingWorker = registration.installing;
          installingWorker.onstatechange = () => {
            if (installingWorker.state === 'installed') {
              if (navigator.serviceWorker.controller) {
                showToast('Nova atualização disponível!');
              } else {
                showToast('Aplicação instalada!');
              }
            }
          };
        };
      })
      .catch((err) => {
        console.error('[PWA] Service Worker registration failed:', err);
        showToast('Falha ao registrar Service Worker');
      });
  });
}

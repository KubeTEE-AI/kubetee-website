// Minimal service worker: keeps KubeTEE installable without caching app data.
// Requests pass through to the network; add offline caching only with a
// deliberate versioned strategy.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Network passthrough. The presence of a fetch handler satisfies browsers
  // that still require one for PWA installability.
});

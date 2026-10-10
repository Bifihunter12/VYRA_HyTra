const APP_VERSION = "2026.10.10.7";
const CACHE_NAME = `vyra-${APP_VERSION}`;
const APP_FILES = [
  "/",
  "/index.html",
  `/manifest.json?v=${APP_VERSION}`,
  `/style.css?v=${APP_VERSION}`,
  `/workouts.js?v=${APP_VERSION}`,
  `/core.js?v=${APP_VERSION}`,
  `/challenges.js?v=${APP_VERSION}`,
  `/progress.js?v=${APP_VERSION}`,
  `/config.js?v=${APP_VERSION}`,
  `/sync.js?v=${APP_VERSION}`,
  `/compete.js?v=${APP_VERSION}`,
  `/events.js?v=${APP_VERSION}`,
  `/clubs.js?v=${APP_VERSION}`,
  `/plans.js?v=${APP_VERSION}`,
  `/coach.js?v=${APP_VERSION}`,
  `/monthly.js?v=${APP_VERSION}`,
  `/app.js?v=${APP_VERSION}`,
  `/app-version.json?v=${APP_VERSION}`,
  "/sw.js",
  `/icons/icon-192.svg?v=${APP_VERSION}`,
  `/icons/icon-512.svg?v=${APP_VERSION}`
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME && (k.startsWith("vyra-") || k.startsWith("endur-") || k.startsWith("cruise-mode-"))).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => clients.forEach((client) => client.postMessage({ type: "APP_UPDATED", version: APP_VERSION })))
  );
  self.clients.claim();
});

// Network-first: always fetch fresh, fall back to cache only when offline
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // Only the app's own files and its font/icon/library CDNs are cached. API calls
  // (e.g. Supabase sync, which carry the user's data) always go straight to the network.
  const url = new URL(event.request.url);
  const cacheable = url.origin === self.location.origin || /(^|\.)(jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);
  if (!cacheable) return;
  event.respondWith(
    fetch(new Request(event.request, { cache: "reload" }))
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});


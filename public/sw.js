// Minimal service worker — exists mainly so Chrome/Android treat CopyCreator
// as an installable PWA (a registered SW with a fetch handler is part of
// that installability check), not for offline support. Every dashboard
// page is dynamic, per-user, auth-gated content (Supabase session cookies +
// live data), so it must NEVER be served from a cache — only same-origin
// static, immutable assets (Next's hashed /_next/static bundles, the PWA
// icons, the manifest) are cached. Everything else falls straight through
// to the network exactly as if there were no service worker at all.
const CACHE_NAME = "copycreator-static-v1";
const STATIC_ASSET_PATTERNS = [/^\/icons\//, /^\/manifest\.webmanifest$/, /^\/_next\/static\//];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isStaticAsset =
    url.origin === self.location.origin && STATIC_ASSET_PATTERNS.some((pattern) => pattern.test(url.pathname));

  if (!isStaticAsset) return; // not handled here — normal network request

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
  );
});

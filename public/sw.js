const CACHE = "pi-phone-v19";
const ASSETS = [
  "/",
  "/styles.css",
  "/app.js",
  "/app/attachments.js",
  "/app/autocomplete-controller.js",
  "/app/autocomplete.js",
  "/app/bindings.js",
  "/app/command-catalog.js",
  "/app/commands.js",
  "/app/constants.js",
  "/app/formatters.js",
  "/app/handlers.js",
  "/app/main.js",
  "/app/markdown.js",
  "/app/messages.js",
  "/app/sheet-actions.js",
  "/app/sheet-navigation.js",
  "/app/sheets-view.js",
  "/app/state.js",
  "/app/tool-rendering.js",
  "/app/transport.js",
  "/app/ui.js",
  "/manifest.webmanifest",
  "/icon.svg",
];
const APP_SHELL = new Set(ASSETS);

function requestUrlHasToken(urlString) {
  try {
    return new URL(urlString).searchParams.has("token");
  } catch {
    return urlString.includes("token=");
  }
}

async function deleteTokenizedCacheEntries() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames.map(async (cacheName) => {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      await Promise.all(requests.filter((cachedRequest) => requestUrlHasToken(cachedRequest.url)).map((cachedRequest) => cache.delete(cachedRequest)));
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => deleteTokenizedCacheEntries()),
  );
  self.clients.claim();
});

async function updateCache(request) {
  if (requestUrlHasToken(request.url)) return fetch(request, { cache: "no-store" });

  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/ws") return;
  if (url.searchParams.has("token")) {
    event.waitUntil(deleteTokenizedCacheEntries());
    if (request.mode === "navigate") {
      const token = url.searchParams.get("token");
      url.searchParams.delete("token");
      if (token !== null) url.hash = `token=${encodeURIComponent(token)}`;
      event.respondWith(Response.redirect(url.toString(), 302));
      return;
    }

    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  const useNetworkFirst = request.mode === "navigate" || APP_SHELL.has(url.pathname);

  if (useNetworkFirst) {
    event.respondWith(
      updateCache(request).catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: APP_SHELL.has(url.pathname) });
        if (cached) return cached;
        return caches.match("/");
      }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return updateCache(request);
    }),
  );
});

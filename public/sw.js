/**
 * Service worker.
 *
 * Hand-written rather than generated: the caching rules here are four lines of
 * intent, and a build-time precache manifest would add a dependency without
 * making them clearer.
 *
 * Strategy:
 * - hashed build assets: cache-first (their URLs change when contents change)
 * - navigations: network-first, falling back to the cached shell offline
 * - API: network only, so the app never renders stale data as though it were
 *   fresh. Failed captures are queued client-side instead.
 */

const VERSION = "semester-os-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const SHELL_URL = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll([SHELL_URL, "/manifest.webmanifest"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

const isAsset = (url) =>
  url.pathname.startsWith("/assets/") ||
  /\.(?:png|svg|woff2?|webmanifest)$/.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never serve API responses from cache: stale capacity or grades presented
  // as current would be worse than an honest failure.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_URL, copy));
          return response;
        })
        .catch(() =>
          caches
            .match(SHELL_URL)
            .then((cached) => cached ?? Response.error()),
        ),
    );
    return;
  }

  if (isAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});

/**
 * Background Sync: flush the capture queue once connectivity returns, even if
 * the app is no longer open. The page owns the queue, so the worker just wakes
 * it up; if no client is running, the flush happens on next launch instead.
 */
self.addEventListener("sync", (event) => {
  if (event.tag !== "flush-captures") return;
  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
      for (const client of clients) client.postMessage({ type: "flush-captures" });
    }),
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Semester OS", body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? "Semester OS", {
      body: payload.body ?? "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: payload.tag ?? "semester-os",
      data: { url: payload.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(
      (clients) => {
        for (const client of clients) {
          if ("focus" in client) return client.focus();
        }
        return self.clients.openWindow(target);
      },
    ),
  );
});

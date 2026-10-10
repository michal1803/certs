/* Exam Hub service worker: offline use and faster starts.
   - Pages: network first, so a new deploy shows up when online; cached copy offline.
   - Own scripts and styles: network first too (bypassing the HTTP cache), so a
     deploy never pairs new pages with old CSS/JS; cached copy offline.
   - Fonts and icons: cache first (they never change in place).
   - Question images from other hosts: cached the first time they are seen.
   Bump VERSION when shipping changes to the precached files. */
const VERSION = "v5";
const CORE = `exam-hub-core-${VERSION}`;
const IMAGES = "exam-hub-images";
const MAX_IMAGES = 600;

const PRECACHE = [
  "./",
  "index.html",
  "terraform.html",
  "az104.html",
  "manifest.webmanifest",
  "assets/app.css",
  "assets/theme.js",
  "assets/exam-data.js",
  "assets/core.js",
  "assets/study.js",
  "assets/exam-flow.js",
  "assets/launcher.js",
  "assets/fonts/nunito-latin.woff2",
  "assets/fonts/nunito-latin-ext.woff2",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/maskable-512.png",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/favicon-32.png",
];

self.addEventListener("install", event => {
  // cache: "reload" skips the browser HTTP cache, so the precache is always fresh.
  event.waitUntil(caches.open(CORE)
    .then(c => c.addAll(PRECACHE.map(u => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("exam-hub-core-") && k !== CORE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimImages() {
  const cache = await caches.open(IMAGES);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_IMAGES; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Pages: network first, fall back to the cached page (ignoring #hash/?query).
  if (req.mode === "navigate" && sameOrigin) {
    event.respondWith(
      fetch(req, { cache: "no-cache" }).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CORE).then(c => c.put(url.pathname, copy)); }
        return res;
      }).catch(async () =>
        (await caches.match(req, { ignoreSearch: true })) ||
        (await caches.match(url.pathname)) ||
        (await caches.match("index.html")))
    );
    return;
  }

  // Fonts and icons: cache first.
  if (sameOrigin && /\/assets\/(fonts|icons)\//.test(url.pathname)) {
    event.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CORE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  // Scripts, styles, manifest: network first, bypassing the HTTP cache.
  if (sameOrigin) {
    event.respondWith(
      fetch(req, { cache: "no-cache" }).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CORE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  // Question images on other hosts: cache first.
  if (req.destination === "image") {
    event.respondWith(
      caches.open(IMAGES).then(async cache => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res.ok || res.type === "opaque") { cache.put(req, res.clone()); trimImages(); }
          return res;
        } catch (e) {
          return Response.error();
        }
      })
    );
  }
});

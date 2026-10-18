/* Exam Hub service worker: offline use and faster starts.
   - Pages: network first, so a new deploy shows up when online; the cached
     copy offline, or when the network has not answered within 3 s.
   - The shell is precached; the exam pages (large) are cached in the
     background after install, unless the connection is slow or Save-Data.
   - Own scripts and styles: network first too (bypassing the HTTP cache), so a
     deploy never pairs new pages with old CSS/JS; cached copy offline.
   - Fonts and icons: cache first (they never change in place).
   - Question images from other hosts: cached the first time they are seen.
   - Push: the daily reminder from the push Worker (push/), worded here with
     the due counts the pages copy to IndexedDB.
   Bump VERSION when shipping changes to the precached files. */
const VERSION = "v18";
const CORE = `exam-hub-core-${VERSION}`;
const IMAGES = "exam-hub-images";
// Cross-origin images are opaque, and Chrome counts each one as ~7 MB of
// quota, so keep only the most recent few (pages load images lazily, so only
// exhibits actually shown get here; the HTTP cache keeps the rest for a year).
const MAX_IMAGES = 20;

const PRECACHE = [
  "./",
  "index.html",
  "privacy.html",
  "manifest.webmanifest",
  "assets/app.css",
  "assets/theme.js",
  "assets/exam-data.js",
  "assets/core.js",
  "assets/study.js",
  "assets/exam-flow.js",
  "assets/launcher.js",
  "assets/remind.js",
  "assets/push-config.js",
  "assets/sync.js",
  "assets/fonts/nunito-latin.woff2",
  "assets/fonts/nunito-latin-ext.woff2",
  "assets/icons/icon-96.png",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/maskable-512.png",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/favicon-32.png",
];

self.addEventListener("install", event => {
  // cache: "reload" skips the browser HTTP cache, so the precache is always fresh.
  event.waitUntil(caches.open(CORE)
    // Fonts and icons never change in place: the HTTP cache copy is fine.
    .then(c => c.addAll(PRECACHE.map(u => new Request(u, { cache: /\/(fonts|icons)\//.test(u) ? "default" : "reload" }))))
    .then(() => self.skipWaiting()));
});

// Exam pages are big (az104.html ~560 KB gzip): fetch them for offline use
// only on a decent connection. The HTTP cache usually already holds the page
// just visited, so this rarely downloads it twice.
const PAGES = ["terraform.html", "az104.html"];
const frugal = () => { const c = self.navigator.connection; return !!c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || "")); };
// Started by a page message after activation, never inside `activate`:
// navigations wait for activation, so a slow warm would hold them up.
async function warmPages() {
  if (frugal()) return;
  const cache = await caches.open(CORE);
  await Promise.all(PAGES.map(async page => {
    if (await cache.match(page)) return;
    try { const res = await fetch(page, { signal: AbortSignal.timeout(15000) }); if (res.ok) await cache.put(page, res); } catch (e) {}
  }));
}
self.addEventListener("message", event => { if (event.data === "warm") event.waitUntil(warmPages()); });

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("exam-hub-core-") && k !== CORE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(trimImages)
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

  // Pages: network first; after 3 s without an answer (or offline) the cached
  // page (ignoring #hash/?query), refreshed in the background.
  if (req.mode === "navigate" && sameOrigin) {
    const network = fetch(req, { cache: "no-cache" }).then(res => {
      if (res.ok) { const copy = res.clone(); event.waitUntil(caches.open(CORE).then(c => c.put(url.pathname, copy)).catch(() => {})); }
      return res;
    });
    network.catch(() => {});
    const cached = async () => (await caches.match(req, { ignoreSearch: true })) || (await caches.match(url.pathname));
    event.respondWith((async () => {
      try {
        return await Promise.race([network, new Promise((_, fail) => setTimeout(() => fail(new Error("timeout")), 3000))]);
      } catch (e) {
        const hit = await cached();
        if (hit) { event.waitUntil(network.catch(() => {})); return hit; }
        try { return await network; } catch (e2) { return (await caches.match("index.html")) || Response.error(); }
      }
    })());
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

  // Question images on other hosts: cache first (stored only when not on Save-Data or 2G).
  if (req.destination === "image") {
    event.respondWith(
      caches.open(IMAGES).then(async cache => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if ((res.ok || res.type === "opaque") && !frugal()) event.waitUntil(cache.put(req, res.clone()).then(trimImages));
          return res;
        } catch (e) {
          return Response.error();
        }
      })
    );
  }
});

/* ---------- daily reminder (push/) ---------- */
function readDue() {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open("exam-hub", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        const get = db.transaction("kv").objectStore("kv").get("due");
        get.onsuccess = () => { db.close(); resolve(get.result || null); };
        get.onerror = () => { db.close(); resolve(null); };
      };
    } catch (e) { resolve(null); }
  });
}
const plural = (n, one, few, many) => {
  if (n === 1) return one;
  const d = n % 10, t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
};

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  event.waitUntil((async () => {
    let body = data.body || "Masz chwilę? Zrób szybką piątkę: 5 pytań, ok. 3 minuty.";
    let url = data.url || "./index.html#szybkie";
    const due = await readDue();
    if (due && due.exams) {
      const now = Date.now();
      const rows = Object.values(due.exams).map(x => ({ ...x, n: x.dues.filter(d => d <= now).length })).sort((a, b) => b.n - a.n);
      const total = rows.reduce((s, x) => s + x.n, 0);
      if (total) {
        body = `${total} ${plural(total, "pytanie czeka", "pytania czekają", "pytań czeka")} na powtórkę${rows.filter(x => x.n).length === 1 ? ` (${rows[0].title})` : ""}. Szybka piątka zajmie ok. 3 minuty.`;
        url = `./${rows[0].href}#szybkie`;
      }
      if (self.navigator.setAppBadge) (total ? self.navigator.setAppBadge(total) : self.navigator.clearAppBadge()).catch(() => {});
    }
    await self.registration.showNotification(data.title || "Exam Hub", {
      body, tag: data.tag || "daily", icon: "assets/icons/icon-192.png", lang: "pl", data: { url },
    });
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  let url = new URL(event.notification.data?.url || "./index.html#szybkie", self.registration.scope).href;
  // Only ever open this app's own pages.
  if (!url.startsWith(self.registration.scope)) url = new URL("./index.html#szybkie", self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      try { await w.focus(); await w.navigate(url); return; } catch (e) {}
    }
    await clients.openWindow(url);
  })());
});

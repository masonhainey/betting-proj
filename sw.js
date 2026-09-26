// Offline shell for the installed app. Network-first (and revalidated) for our own files
// so updates show up on the next launch; the cache only answers when there's no connection. ESPN, fonts and
// the OCR library always go straight to the network.
const CACHE = "hedgehog-v5";
const SHELL = [
  "./", "index.html", "styles.css", "manifest.webmanifest",
  "js/app.js", "js/espn.js", "js/demo.js", "js/odds.js", "js/grade.js", "js/store.js",
  "js/ui.js", "js/news.js", "js/slipparse.js", "js/ocr.js", "js/config.js", "js/cloud.js", "js/sync.js",
  "icons/icon-192.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    // "no-cache" = always ask the server (GitHub Pages otherwise lets browsers reuse files
    // for 10 minutes, which kept new versions from showing up). Unchanged files come back
    // as a tiny 304, so this stays fast.
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html")))
  );
});

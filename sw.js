// Offline shell for the installed app. Network-first (and revalidated) for our own files
// so updates show up on the next launch; the cache only answers when there's no connection. ESPN, fonts and
// the OCR library always go straight to the network.
const CACHE = "hedgehog-v16";
const SHELL = [
  "./", "index.html", "styles.css", "manifest.webmanifest", "js/account.js", "js/autopsy.js", "js/app.js",
  "js/cloud.js", "js/config.js", "js/data.js", "js/demo.js", "js/espn.js", "js/events.js",
  "js/grade.js", "js/market.js", "js/news.js", "js/ocr.js", "js/odds.js", "js/render.js",
  "js/sheets/add.js", "js/sheets/bet.js", "js/sheets/game.js", "js/sheets/import.js",
  "js/sheets/settings.js", "js/alerts.js", "js/alertrules.js", "js/friends.js", "js/leaderboard.js", "js/views/friends.js", "js/sheets/share.js", "js/share.js", "js/sharecard.js", "js/slipparse.js", "js/state.js", "js/store.js", "js/sync.js", "js/widget.js", "js/relink.js", "js/field.js", "js/fieldview.js", "js/props.js", "js/summary.js",
  "js/ui.js", "js/views/bets.js", "js/views/build.js", "js/views/live.js", "js/views/news.js",
  "js/views/schedule.js", "icons/icon-192.png", "icons/apple-touch-icon.png",
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

// Alerts pushed by the server (scripts/alerts-worker.mjs) while the app is closed.
self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { title: "hedgehog", body: e.data?.text() || "" };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || "hedgehog", {
      body: d.body || "",
      tag: d.tag,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      data: { url: d.url || "#bets" },
    })
  );
});

// Tapping an alert opens (or focuses) the app on the right tab.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "#bets", self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const win = list.find((c) => c.url.startsWith(self.registration.scope));
      if (win) return win.navigate(target).then((w) => (w || win).focus()).catch(() => win.focus());
      return self.clients.openWindow(target);
    })
  );
});

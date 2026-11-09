const CACHE = "mare-music-shell-v15";
const SHELL = [
  "/",
  "/launch.css",
  "/launch.js",
  "/music-mark.svg",
  "/music-icon-180.png",
  "/music-icon-192.png",
  "/music-icon-512.png",
  "/music-icon-maskable-512.png",
  "/style.css",
  "/account-player.css",
  "/app.js",
  "/music-actions.js",
  "/sortable.js",
  "/music-polish.css",
  "/devices-ui.js",
  "/device-link.js",
  "/icons.js",
  "/library.js",
  "/accounts.js",
  "/player-ui.js",
  "/navigation.js",
  "/manifest.webmanifest",
  "/icon-180.png",
  "/icon-192.png",
  "/icon-512.png",
];
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL))),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("mare-music-shell-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    url.origin !== self.location.origin ||
    event.request.method !== "GET" ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/media/") ||
    url.pathname.startsWith("/artwork/")
  )
    return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches
        .match(event.request)
        .then((response) => response || Response.error()),
    ),
  );
});

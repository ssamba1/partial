// Offline support: network-first for pages, cache-first for hashed assets.
// The build replaces __BUILD_ID__ with a hash of the bundle, so every release is a
// byte-different service worker: browsers install it and the old cache is dropped.
const CACHE = 'resonare-__BUILD_ID__';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-maskable.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(CORE);
      // precache.json is written by the build and lists every bundle file (scripts, styles, pdf worker).
      try {
        const files = await (await fetch('./precache.json', { cache: 'no-store' })).json();
        await cache.addAll(files.map((f) => `./${f}`));
      } catch {
        // Dev server or missing list: assets are cached as they are fetched instead.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html', { ignoreVary: true })),
    );
    return;
  }

  // ignoreVary: module imports send an Origin header the precache request did not,
  // and a server's "Vary: Origin" would otherwise make every lookup miss when offline.
  event.respondWith(
    caches.match(req, { ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

'use strict';

// The cache name comes from the app version, so shipping a new version
// replaces the old cache automatically. Bump the version in version.js.
importScripts('version.js');

var CACHE = 'magpie-v' + self.MAGPIE_VERSION;
var SHELL = [
  './',
  'index.html',
  'style.css',
  'version.js',
  'clip.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(function (cache) {
        // cache: 'reload' skips the browser's HTTP cache. GitHub Pages marks
        // files cacheable for ten minutes, so without this a new cache can be
        // filled with the previous deploy's files.
        return cache.addAll(
          SHELL.map(function (path) {
            return new Request(path, { cache: 'reload' });
          })
        );
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) {
              return k !== CACHE;
            })
            .map(function (k) {
              return caches.delete(k);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

// Serve from the cache and refresh it in the background. Share links carry a
// query string (?title=...&text=...&url=...), so lookups use the path only.
// The refresh revalidates with the server rather than trusting the HTTP cache.
self.addEventListener('fetch', function (event) {
  var req = event.request;
  var url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  var key = url.origin + url.pathname;
  event.respondWith(
    caches.match(key).then(function (cached) {
      var refresh = fetch(key, { cache: 'no-cache' }).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) {
            return cache.put(key, copy);
          });
        }
        return res;
      });
      if (cached) {
        event.waitUntil(refresh.catch(function () {}));
        return cached;
      }
      return refresh;
    })
  );
});

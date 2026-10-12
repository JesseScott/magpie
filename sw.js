'use strict';

// Bump CACHE when shipping changes so installed copies pick up new files.
var CACHE = 'magpie-v4';
var SHELL = [
  './',
  'index.html',
  'style.css',
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
        return cache.addAll(SHELL);
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

// Serve from cache and refresh in the background. Share links carry a query
// string (?title=...&text=...&url=...), so cache lookups ignore it.
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (cached) {
      var network = fetch(req)
        .then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (cache) {
              return cache.put(req.url.split('?')[0], copy);
            });
          }
          return res;
        })
        .catch(function () {
          return cached;
        });
      return cached || network;
    })
  );
});

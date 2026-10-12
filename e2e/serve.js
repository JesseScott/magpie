'use strict';
// A tiny static server for the browser tests. It serves the repo under
// /magpie/, the same subpath GitHub Pages uses, so a path that only works at
// the site root fails here too. No dependencies.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const base = '/magpie/';
const port = Number(process.env.PORT || 4173);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// Only the files GitHub Pages would serve from a deploy of this repo.
const hidden = new Set(['.git', '.github', 'node_modules', 'e2e', 'test', 'scripts', 'docs']);

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith(base)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    let rel = decodeURIComponent(url.pathname.slice(base.length));
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';

    const file = path.normalize(path.join(root, rel));
    const first = path.relative(root, file).split(path.sep)[0];
    if (!file.startsWith(root + path.sep) || hidden.has(first)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'content-type': types[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      res.end(data);
    });
  })
  .listen(port, '127.0.0.1', () => {
    console.log('Serving ' + root + ' at http://127.0.0.1:' + port + base);
  });

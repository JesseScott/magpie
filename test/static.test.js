'use strict';
// Checks that the files GitHub Pages serves agree with each other. A typo in
// a path here only shows up on a phone, as a missing icon or a share target
// that never registers, so catch it before deploy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

test('JavaScript files parse', () => {
  ['app.js', 'clip.js', 'sw.js', 'version.js'].forEach((file) => {
    assert.doesNotThrow(() => new vm.Script(read(file), { filename: file }), file);
  });
});

test('manifest is valid and installable as a share target', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.share_target.method, 'GET');
  assert.equal(manifest.share_target.action, './');
  assert.deepEqual(Object.keys(manifest.share_target.params).sort(), ['text', 'title', 'url']);

  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192'), 'needs a 192x192 icon');
  assert.ok(sizes.includes('512x512'), 'needs a 512x512 icon');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'), 'needs a maskable icon');
  manifest.icons.forEach((icon) => assert.ok(exists(icon.src), 'missing icon ' + icon.src));
});

test('paths stay relative so the app works under /magpie/', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  [manifest.start_url, manifest.scope, manifest.share_target.action]
    .concat(manifest.icons.map((i) => i.src))
    .forEach((p) => assert.ok(!p.startsWith('/'), 'absolute path: ' + p));
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  refs
    .filter((r) => !/^(https?:|#)/.test(r))
    .forEach((r) => assert.ok(!r.startsWith('/'), 'absolute path in index.html: ' + r));
});

test('index.html only references files that exist', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((r) => !/^(https?:|#)/.test(r));
  assert.ok(refs.length > 0);
  refs.forEach((r) => assert.ok(exists(r), 'missing file: ' + r));
});

test('service worker pre-caches only files that exist, and every script it needs', () => {
  const sw = read('sw.js');
  const block = sw.match(/var SHELL = \[([\s\S]*?)\];/);
  assert.ok(block, 'could not find the SHELL list in sw.js');
  const shell = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  shell.forEach((entry) => {
    const file = entry === './' ? 'index.html' : entry;
    assert.ok(exists(file), 'sw.js caches a missing file: ' + entry);
  });
  ['index.html', 'app.js', 'clip.js', 'version.js', 'style.css', 'manifest.webmanifest'].forEach(
    (needed) => {
      assert.ok(shell.includes(needed), 'sw.js does not cache ' + needed);
    }
  );
});

test('the cache name comes from the app version, with no hand-bumped name left', () => {
  const sw = read('sw.js');
  assert.match(sw, /importScripts\('version\.js'\)/);
  assert.match(sw, /var CACHE = 'magpie-v' \+ self\.MAGPIE_VERSION;/);
  assert.doesNotMatch(sw, /magpie-v\d/, 'a hard-coded cache name is back in sw.js');
});

test('installing bypasses the HTTP cache so a new cache never holds old files', () => {
  const sw = read('sw.js');
  assert.match(sw, /cache: 'reload'/);
  assert.match(sw, /cache: 'no-cache'/);
});

function appVersion() {
  const sandbox = { self: {} };
  vm.runInNewContext(read('version.js'), sandbox, { filename: 'version.js' });
  return sandbox.self.MAGPIE_VERSION;
}

test('the app version is a semantic version and matches package.json', () => {
  const version = appVersion();
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(JSON.parse(read('package.json')).version, version);
});

test('index.html loads version.js before the app and has places to show it', () => {
  const html = read('index.html');
  const order = ['version.js', 'clip.js', 'app.js'].map((f) => html.indexOf('src="' + f + '"'));
  assert.ok(order.every((i) => i >= 0), 'a script tag is missing');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'scripts are out of order');
  assert.ok((html.match(/class="app-version"/g) || []).length >= 2, 'version needs to show in the clip view and in Settings');
});

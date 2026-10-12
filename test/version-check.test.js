'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const check = require('../scripts/version-check.js');

test('only files the phone loads count as served', () => {
  ['index.html', 'app.js', 'clip.js', 'style.css', 'sw.js', 'manifest.webmanifest', 'icons/icon-192.png'].forEach(
    (f) => assert.equal(check.isServed(f), true, f)
  );
  ['README.md', 'package.json', 'version.js', 'test/clip.test.js', '.github/workflows/ci.yml', 'scripts/version-check.js'].forEach(
    (f) => assert.equal(check.isServed(f), false, f)
  );
});

test('compareVersions orders numerically, not as text', () => {
  assert.ok(check.compareVersions('0.10.0', '0.9.0') > 0);
  assert.ok(check.compareVersions('1.0.0', '0.99.99') > 0);
  assert.ok(check.compareVersions('0.3.0', '0.3.1') < 0);
  assert.equal(check.compareVersions('0.3.0', '0.3.0'), 0);
  assert.throws(() => check.compareVersions('1.0', '1.0.0'));
});

test('readVersion reads version.js without running it', () => {
  assert.equal(check.readVersion("self.MAGPIE_VERSION = '0.3.0';"), '0.3.0');
  assert.equal(check.readVersion('// nothing here'), null);
});

test('a change to served files without a bump fails and names the files', () => {
  const r = check.checkBump({ changedFiles: ['app.js', 'README.md'], baseVersion: '0.3.0', headVersion: '0.3.0' });
  assert.equal(r.ok, false);
  assert.match(r.message, /still 0\.3\.0/);
  assert.match(r.message, /app\.js/);
  assert.doesNotMatch(r.message, /README/);
});

test('lowering the version fails as well', () => {
  const r = check.checkBump({ changedFiles: ['sw.js'], baseVersion: '0.4.0', headVersion: '0.3.0' });
  assert.equal(r.ok, false);
  assert.match(r.message, /went down from 0\.4\.0 to 0\.3\.0/);
});

test('a bump with served changes passes', () => {
  const r = check.checkBump({ changedFiles: ['app.js', 'version.js'], baseVersion: '0.3.0', headVersion: '0.3.1' });
  assert.equal(r.ok, true);
  assert.match(r.message, /0\.3\.0 to 0\.3\.1/);
});

test('changes that are not served need no bump', () => {
  const r = check.checkBump({
    changedFiles: ['README.md', 'test/clip.test.js', '.github/workflows/ci.yml', 'package.json'],
    baseVersion: '0.3.0',
    headVersion: '0.3.0',
  });
  assert.equal(r.ok, true);
});

test('a missing head version fails, a missing base version passes', () => {
  assert.equal(check.checkBump({ changedFiles: ['app.js'], baseVersion: '0.3.0', headVersion: null }).ok, false);
  assert.equal(check.checkBump({ changedFiles: ['app.js'], baseVersion: null, headVersion: '0.1.0' }).ok, true);
});

'use strict';
// Smoke tests for the screen: first run, settings, and the Obsidian link the
// app builds. They run in Chromium on a phone-sized viewport against the
// static files. They cannot cover the Android share sheet, installing the app
// or the handoff into Obsidian; docs/manual-checklist.md lists those.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const SHARE =
  './?title=' +
  encodeURIComponent('A page title') +
  '&text=' +
  encodeURIComponent('Some selected words https://example.com/article');

// The app opens Obsidian through window.__magpieOpen when it exists (see
// openObsidian in app.js), because a navigation to obsidian:// can't be
// observed. Record the links instead.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__opened = [];
    window.__magpieOpen = (uri) => window.__opened.push(uri);
  });
});

async function fillSettings(page, s) {
  const fields = {
    vault: '#s-vault',
    folder: '#s-folder',
    baseTag: '#s-tag',
    sourceKey: '#s-source',
    dateKey: '#s-date',
  };
  for (const [key, selector] of Object.entries(fields)) {
    if (key in s) await page.fill(selector, s[key]);
  }
  if ('urlInBody' in s) await page.setChecked('#s-urlbody', s.urlInBody);
}

async function configure(page, settings = {}) {
  await fillSettings(page, { vault: 'test-vault', ...settings });
  await page.click('#settings-form button[type=submit]');
  await expect(page.locator('#clip-view')).toBeVisible();
}

async function openedLinks(page) {
  return page.evaluate(() => window.__opened);
}

// Waits for exactly one link to have been opened and splits it up.
async function openedLink(page) {
  await expect.poll(async () => (await openedLinks(page)).length).toBe(1);
  const [raw] = await openedLinks(page);
  const url = new URL(raw);
  return { raw, params: url.searchParams, note: url.searchParams.get('content') };
}

test('first run asks where clips go before anything else', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('#settings-view')).toBeVisible();
  await expect(page.locator('#cancel-settings')).toBeHidden();
  await expect(page.locator('#clip-view')).toBeHidden();
});

test('a page shared before setup is still filled in after saving settings', async ({ page }) => {
  await page.goto(SHARE);
  await expect(page.locator('#welcome')).toBeVisible();
  await configure(page);
  await expect(page.locator('#title')).toHaveValue('A page title');
  await expect(page.locator('#url')).toHaveValue('https://example.com/article');
  await expect(page.locator('#selection')).toHaveValue('Some selected words');
});

test('settings persist across a reload', async ({ page }) => {
  await page.goto('./');
  await fillSettings(page, { vault: 'my vault', folder: 'Web/Clips', baseTag: 'one, two' });
  await page.click('#settings-form button[type=submit]');
  await page.reload();

  await expect(page.locator('#clip-view')).toBeVisible();
  await expect(page.locator('#welcome')).toBeHidden();
  await expect(page.locator('#dest')).toHaveText('my vault / Web/Clips');

  await page.click('#open-settings');
  await expect(page.locator('#s-vault')).toHaveValue('my vault');
  await expect(page.locator('#s-folder')).toHaveValue('Web/Clips');
  await expect(page.locator('#s-tag')).toHaveValue('one, two');
});

test('saves into the configured vault and folder with the default note format', async ({ page }) => {
  await page.goto(SHARE);
  await configure(page, { vault: 'test-vault', folder: 'Web/Clips' });
  await page.click('#save');

  const { params, note } = await openedLink(page);
  expect(params.get('vault')).toBe('test-vault');
  expect(params.get('file')).toBe('Web/Clips/A page title');
  expect(params.has('clipboard')).toBe(false);
  expect(note.startsWith('---\ntitle: "A page title"\nsource: "https://example.com/article"\nclipped: ')).toBe(true);
  expect(note).toMatch(/^clipped: \d{4}-\d{2}-\d{2}$/m);
  expect(note).toContain('\ntags:\n  - clippings\n---\n');
  expect(note).toContain('\nhttps://example.com/article\n\n> Some selected words\n');
});

test('a blank vault and a blank folder leave those parts out of the link', async ({ page }) => {
  await page.goto(SHARE);
  await configure(page, { vault: '', folder: '' });
  await expect(page.locator('#dest')).toHaveText('last-used vault');
  await page.click('#save');

  const { params } = await openedLink(page);
  expect(params.has('vault')).toBe(false);
  expect(params.get('file')).toBe('A page title');
});

test('custom property names and an unticked link-in-body show up in the note', async ({ page }) => {
  await page.goto(SHARE);
  await configure(page, { sourceKey: 'url', dateKey: 'created', urlInBody: false });
  await page.click('#save');

  const { note } = await openedLink(page);
  expect(note).toContain('\nurl: "https://example.com/article"\n');
  expect(note).toMatch(/^created: \d{4}-\d{2}-\d{2}$/m);
  expect(note).not.toContain('source:');
  expect(note).not.toContain('clipped:');
  const body = note.split('\n---\n\n')[1];
  expect(body.startsWith('> Some selected words')).toBe(true);
  expect(body).not.toContain('https://example.com/article');
});

test('always-on tags come first, then extras, without duplicates', async ({ page }) => {
  await page.goto(SHARE);
  await configure(page, { baseTag: 'clippings, magpie' });
  await expect(page.locator('#base-tag')).toHaveText('clippings, magpie');
  await page.fill('#tags', 'extra, Magpie, to read');
  await page.click('#save');

  const { note } = await openedLink(page);
  expect(note).toContain('\ntags:\n  - clippings\n  - magpie\n  - extra\n  - to-read\n---\n');
});

test('reset to defaults fills the form but does not save until confirmed', async ({ page }) => {
  await page.goto('./');
  await configure(page, { vault: 'custom', folder: 'Elsewhere', baseTag: 'mine' });

  await page.click('#open-settings');
  await page.click('#reset-settings');
  await expect(page.locator('#s-vault')).toHaveValue('');
  await expect(page.locator('#s-folder')).toHaveValue('Clippings');
  await expect(page.locator('#s-tag')).toHaveValue('clippings');

  await page.click('#cancel-settings');
  await page.click('#open-settings');
  await expect(page.locator('#s-vault')).toHaveValue('custom');
  await expect(page.locator('#s-folder')).toHaveValue('Elsewhere');
  await expect(page.locator('#s-tag')).toHaveValue('mine');
});

test('a long clip goes through the clipboard instead of the link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(SHARE);
  await configure(page);
  await page.fill('#selection', 'long words '.repeat(900));
  await page.click('#save');

  const { raw, params } = await openedLink(page);
  expect(raw.endsWith('&clipboard')).toBe(true);
  expect(params.has('content')).toBe(false);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.startsWith('---\ntitle: "A page title"')).toBe(true);
  expect(copied).toContain('> long words long words');
});

test('the app loads offline once it has been opened', async ({ page, context }) => {
  await page.goto('./');
  await configure(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));

  await context.setOffline(true);
  await page.goto(SHARE);
  await expect(page.locator('#title')).toHaveValue('A page title');
  await expect(page.locator('#dest')).toHaveText('test-vault / Clippings');
});

test('Settings shows the raw share exactly as received and copies it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(SHARE);
  await configure(page);
  await page.click('#open-settings');
  await page.click('#raw-share summary');

  const expected = { title: 'A page title', text: 'Some selected words https://example.com/article', url: null };
  await expect(page.locator('#raw-share-none')).toBeHidden();
  expect(JSON.parse(await page.locator('#raw-share-text').textContent())).toEqual(expected);

  await page.click('#copy-raw-share');
  await expect(page.locator('#raw-share-status')).toHaveText('Copied.');
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(expected);
  const stored = await page.evaluate(() => Object.keys(localStorage));
  expect(stored).toEqual(['magpie.settings.v1']);
});

test('Settings says when nothing was shared', async ({ page }) => {
  await page.goto('./');
  await configure(page);
  await page.click('#open-settings');
  await page.click('#raw-share summary');
  await expect(page.locator('#raw-share-none')).toBeVisible();
  await expect(page.locator('#raw-share-text')).toBeHidden();
  await expect(page.locator('#copy-raw-share')).toBeHidden();
});

test('the version on screen matches version.js', async ({ page }) => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'version.js'), 'utf8');
  const version = /MAGPIE_VERSION\s*=\s*'([^']+)'/.exec(source)[1];
  await page.goto('./');
  await expect(page.locator('.app-version').first()).toHaveText('v' + version);
});

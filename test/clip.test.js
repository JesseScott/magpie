'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const clip = require('../clip.js');

test('parseShare pulls the URL out of text and drops a duplicate title', () => {
  const s = clip.parseShare('?title=My%20Page&text=My%20Page%20https%3A%2F%2Fexample.com%2Fa%3Fb%3D1');
  assert.equal(s.url, 'https://example.com/a?b=1');
  assert.equal(s.title, 'My Page');
  assert.equal(s.selection, '');
});

test('parseShare treats text with no title as a selection', () => {
  const s = clip.parseShare('?text=Some%20quoted%20words&url=https%3A%2F%2Fexample.com');
  assert.equal(s.selection, 'Some quoted words');
  assert.equal(s.url, 'https://example.com');
});

test('parseShare drops selection equal to title', () => {
  const s = clip.parseShare('?title=Hello&text=Hello&url=https%3A%2F%2Fexample.com');
  assert.equal(s.selection, '');
});

test('rawShare keeps the parameters exactly as sent, and null for missing ones', () => {
  const raw = clip.rawShare('?title=%20My%20Page%20&text=My%20Page%20https%3A%2F%2Fexample.com%2Fa');
  assert.deepEqual(raw, { title: ' My Page ', text: 'My Page https://example.com/a', url: null });
  assert.deepEqual(clip.rawShare('?url='), { title: null, text: null, url: '' });
});

test('rawShare is null when nothing was shared', () => {
  assert.equal(clip.rawShare(''), null);
  assert.equal(clip.rawShare('?other=1'), null);
});

test('defaultTitle falls back to selection, then hostname', () => {
  assert.equal(clip.defaultTitle({ title: '', url: '', selection: 'First line\nsecond' }), 'First line');
  assert.equal(clip.defaultTitle({ title: '', url: 'https://www.example.com/x', selection: '' }), 'example.com');
});

test('titleFromUrl turns a readable slug into a title', () => {
  const cases = [
    ['https://example.com/blog/2024/03/how-to-make-sourdough.html', 'How to make sourdough'],
    ['https://www.example.com/articles/12345-why_magpies-collect-things', 'Why magpies collect things'],
    ['https://medium.com/@someone/a-quiet-place-to-write-3f8a9c2b1d7e', 'A quiet place to write'],
    ['https://example.com/recipes/focaccia/', 'Focaccia'],
    ['https://example.com/lists/best-books-of-2024', 'Best books of 2024'],
    ['https://example.com/10-tips-for-better-notes', '10 tips for better notes'],
    ['https://example.com/news/caf%C3%A9-opens-downtown', 'Café opens downtown'],
  ];
  for (const [url, expected] of cases) {
    assert.equal(clip.titleFromUrl(url), expected, url);
  }
});

test('titleFromUrl handles link-only shares captured on a phone', () => {
  // Real payloads from the Last share received view, 2026-10-13.
  assert.equal(
    clip.titleFromUrl(
      'https://www.cbc.ca/news/canada/british-columbia/steven-galloway-testifies-faculty-student-relationships-9.7376691'
    ),
    'Steven galloway testifies faculty student relationships'
  );
  assert.equal(clip.titleFromUrl('https://www.reddit.com/r/AskGameMasters/s/WRmBtljbrT'), 'r/AskGameMasters');
  assert.equal(clip.titleFromUrl('https://www.puzzle.mu/'), '');
  assert.equal(clip.titleFromUrl('https://youtube.com/watch?v=VUGH0DMUesA&si=EMEBM1A2ErBJx9Mr'), '');
});

test('titleFromUrl drops a date at the end of a slug and cuts long titles at a word', () => {
  assert.equal(
    clip.titleFromUrl(
      'https://www.reuters.com/lifestyle/andrew-garfield-says-openai-film-artificial-turns-lens-creators-new-world-2026-10-12/'
    ),
    'Andrew garfield says openai film artificial turns lens creators new world'
  );
  assert.equal(clip.titleFromUrl('https://example.com/2026-10-12-launch-notes'), 'Launch notes');
  const long = clip.titleFromUrl('https://example.com/' + 'magpies-'.repeat(15) + 'end');
  assert.ok(long.length <= 80 && long.endsWith('magpies'), long);
});

test('titleFromUrl knows a few sites by their URL shape', () => {
  assert.equal(clip.titleFromUrl('https://en.wikipedia.org/wiki/Common_magpie'), 'Common magpie');
  assert.equal(clip.titleFromUrl('https://en.m.wikipedia.org/wiki/Eurasian_magpie'), 'Eurasian magpie');
  assert.equal(clip.titleFromUrl('https://github.com/JesseScott/magpie/pull/29'), 'JesseScott/magpie');
  assert.equal(
    clip.titleFromUrl('https://www.reddit.com/r/ObsidianMD/comments/1abc2d/my_clipping_workflow/'),
    'My clipping workflow (r/ObsidianMD)'
  );
  assert.equal(clip.titleFromUrl('https://old.reddit.com/r/ObsidianMD/'), 'r/ObsidianMD');
});

test('titleFromUrl gives up on paths with nothing readable', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://example.com/p/8f3a9c',
    'https://example.com/',
    'https://example.com/2024/03/18',
    'https://example.com/index.html',
    'https://example.com/x',
    'not a url',
    '',
  ]) {
    assert.equal(clip.titleFromUrl(url), '', url);
  }
});

test('defaultTitle uses the URL only when there is no title or selection', () => {
  const url = 'https://example.com/how-to-make-sourdough';
  assert.equal(clip.defaultTitle({ title: 'Shared title', url: url, selection: '' }), 'Shared title');
  assert.equal(clip.defaultTitle({ title: '', url: url, selection: 'Quoted words' }), 'Quoted words');
  assert.equal(clip.defaultTitle({ title: '', url: url, selection: '' }), 'How to make sourdough');
  assert.equal(clip.defaultTitle({ title: '', url: 'https://youtu.be/dQw4w9WgXcQ', selection: '' }), 'youtu.be');
});

test('sanitizeFileName removes illegal characters and trailing dots', () => {
  assert.equal(clip.sanitizeFileName('A/B: C? [D]#E.', 'x'), 'A B C D E');
  assert.equal(clip.sanitizeFileName('???', 'Clip 2026-10-11'), 'Clip 2026-10-11');
  assert.equal(clip.sanitizeFileName('a'.repeat(150), 'x').length, 100);
});

test('parseTags always leads with the base tag and dedupes', () => {
  assert.deepEqual(clip.parseTags('', 'clippings'), ['clippings']);
  assert.deepEqual(clip.parseTags('#Recipes, to read, Clippings, a/b', 'clippings'), [
    'clippings',
    'Recipes',
    'to-read',
    'a/b',
  ]);
});

test('buildNote writes frontmatter with a tag list and a quoted selection', () => {
  const note = clip.buildNote({
    title: 'Say "hi": ok',
    url: 'https://example.com/p',
    selection: 'line one\n\nline two',
    note: 'my thought',
    tags: ['clippings', 'x'],
    date: '2026-10-11',
  });
  assert.equal(
    note,
    [
      '---',
      'title: "Say \\"hi\\": ok"',
      'source: "https://example.com/p"',
      'clipped: 2026-10-11',
      'tags:',
      '  - clippings',
      '  - x',
      '---',
      '',
      'https://example.com/p',
      '',
      '> line one\n>\n> line two',
      '',
      'my thought',
      '',
    ].join('\n')
  );
});

test('buildUri puts short notes in the link and long ones on the clipboard', () => {
  const opts = { vault: 'randomized-rituals', folder: 'Clippings', fileName: 'A B', note: 'hi there', maxLength: 8000 };
  const short = clip.buildUri(opts);
  assert.equal(short.clipboard, false);
  assert.equal(
    short.uri,
    'obsidian://new?vault=randomized-rituals&file=Clippings%2FA%20B&content=hi%20there'
  );
  const long = clip.buildUri(Object.assign({}, opts, { note: 'x'.repeat(9000) }));
  assert.equal(long.clipboard, true);
  assert.equal(long.uri, 'obsidian://new?vault=randomized-rituals&file=Clippings%2FA%20B&clipboard');
});

test('normalizeSettings fills defaults and cleans values', () => {
  assert.deepEqual(clip.normalizeSettings(null), clip.DEFAULT_SETTINGS);
  const s = clip.normalizeSettings({
    vault: '  My Vault ',
    folder: '\\Web\\\\Clips/../x/',
    baseTag: '#Read Later',
    sourceKey: 'not valid!',
    dateKey: 'created',
    urlInBody: false,
  });
  assert.equal(s.vault, 'My Vault');
  assert.equal(s.folder, 'Web/Clips/x');
  assert.equal(s.baseTag, 'Read-Later');
  assert.equal(s.sourceKey, 'source');
  assert.equal(s.dateKey, 'created');
  assert.equal(s.urlInBody, false);
});

test('normalizeSettings lets the folder and base tag be blank on purpose', () => {
  const s = clip.normalizeSettings({ folder: '', baseTag: '' });
  assert.equal(s.folder, '');
  assert.equal(s.baseTag, '');
  assert.deepEqual(clip.parseTags('a, b', s.baseTag), ['a', 'b']);
});

test('buildNote honours custom property names, no tags, and a link-free body', () => {
  const note = clip.buildNote(
    { title: 'T', url: 'https://example.com', selection: '', note: '', tags: [], date: '2026-10-11' },
    { sourceKey: 'url', dateKey: 'created', urlInBody: false }
  );
  assert.equal(
    note,
    ['---', 'title: "T"', 'url: "https://example.com"', 'created: 2026-10-11', '---', '', '', ''].join('\n')
  );
});

test('buildUri omits a blank vault and a blank folder', () => {
  const r = clip.buildUri({ vault: '', folder: '', fileName: 'A', note: 'x', maxLength: 8000 });
  assert.equal(r.uri, 'obsidian://new?file=A&content=x');
  const long = clip.buildUri({ vault: '', folder: 'F', fileName: 'A', note: 'x'.repeat(9000), maxLength: 8000 });
  assert.equal(long.uri, 'obsidian://new?file=F%2FA&clipboard');
});

test('the always-on tags setting takes a comma-separated list', () => {
  assert.equal(clip.normalizeSettings({ baseTag: 'clippings, magpie' }).baseTag, 'clippings, magpie');
  assert.equal(
    clip.normalizeSettings({ baseTag: '#Clippings,  magpie ,, my tag, clippings' }).baseTag,
    'Clippings, magpie, my-tag'
  );
  assert.equal(clip.normalizeSettings({ baseTag: ' , ' }).baseTag, '');
});

test('parseTags puts always-on tags first, then extras, without duplicates', () => {
  assert.deepEqual(clip.parseTags('extra, magpie', 'clippings, magpie'), ['clippings', 'magpie', 'extra']);
  assert.deepEqual(clip.parseTags('', 'clippings, magpie'), ['clippings', 'magpie']);
  assert.deepEqual(clip.parseTags('a', ''), ['a']);
});

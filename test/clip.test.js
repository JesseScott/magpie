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

test('defaultTitle falls back to selection, then hostname', () => {
  assert.equal(clip.defaultTitle({ title: '', url: '', selection: 'First line\nsecond' }), 'First line');
  assert.equal(clip.defaultTitle({ title: '', url: 'https://www.example.com/x', selection: '' }), 'example.com');
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

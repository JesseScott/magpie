/*
 * Magpie core logic: turns whatever Chrome shares into an Obsidian note
 * and an obsidian://new link. No DOM access, so it runs in the browser
 * and in Node tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MagpieClip = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const enc = encodeURIComponent;

  function localDate(d) {
    d = d || new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function extractUrl(s) {
    const m = String(s || '').match(/https?:\/\/[^\s<>"]+/i);
    return m ? m[0] : '';
  }

  // Chrome's share sheet sends title, text and url. The URL often arrives
  // inside `text`, and for a text selection `text` is the selection itself.
  function parseShare(search) {
    const p = new URLSearchParams(search || '');
    const title = (p.get('title') || '').trim();
    const text = (p.get('text') || '').trim();
    const url = (p.get('url') || '').trim() || extractUrl(text);
    let selection = url ? text.split(url).join('').trim() : text;
    if (selection === title) selection = '';
    return { title: title, url: url, selection: selection };
  }

  function hostname(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  function defaultTitle(share) {
    if (share.title) return share.title;
    const firstLine = (share.selection || '').split(/\r?\n/)[0].trim();
    if (firstLine) return firstLine.length > 80 ? firstLine.slice(0, 80).trim() : firstLine;
    return hostname(share.url);
  }

  // Strips characters that Obsidian or Android reject in file names.
  function sanitizeFileName(title, fallback) {
    let s = String(title || '')
      .replace(/[\u0000-\u001f]/g, ' ')
      .replace(/[\\/:*?"<>|#^\[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '');
    if (s.length > 100) s = s.slice(0, 100);
    s = s.replace(/[.\s]+$/, '').trim();
    return s || fallback;
  }

  // The base tag is always first; extras are comma- or newline-separated.
  function parseTags(input, baseTag) {
    const seen = new Set();
    const tags = [];
    const add = (t) => {
      if (!t || seen.has(t.toLowerCase())) return;
      seen.add(t.toLowerCase());
      tags.push(t);
    };
    add(baseTag);
    String(input || '')
      .split(/[,\n]/)
      .forEach(function (piece) {
        const t = piece
          .trim()
          .replace(/^#+/, '')
          .replace(/\s+/g, '-')
          .replace(/[^\p{L}\p{N}_\-\/]/gu, '-')
          .replace(/-{2,}/g, '-')
          .replace(/^-+|-+$/g, '');
        add(t);
      });
    return tags;
  }

  function buildNote(clip) {
    const lines = ['---', 'title: ' + JSON.stringify(clip.title)];
    if (clip.url) lines.push('source: ' + JSON.stringify(clip.url));
    lines.push('clipped: ' + clip.date, 'tags:');
    clip.tags.forEach(function (t) {
      lines.push('  - ' + t);
    });
    lines.push('---', '');

    const body = [];
    if (clip.url) body.push(clip.url);
    if (clip.selection) {
      body.push(
        clip.selection
          .split(/\r?\n/)
          .map(function (l) {
            return l ? '> ' + l : '>';
          })
          .join('\n')
      );
    }
    if (clip.note) body.push(clip.note.trim());
    return lines.join('\n') + '\n' + body.join('\n\n') + '\n';
  }

  // Short notes travel inside the link. Long ones go through the clipboard
  // so the link stays under what Android will hand to another app.
  function buildUri(opts) {
    const base =
      'obsidian://new?vault=' + enc(opts.vault) + '&file=' + enc(opts.folder + '/' + opts.fileName);
    const full = base + '&content=' + enc(opts.note);
    if (full.length <= opts.maxLength) return { uri: full, clipboard: false };
    return { uri: base + '&clipboard', clipboard: true };
  }

  return {
    localDate: localDate,
    extractUrl: extractUrl,
    parseShare: parseShare,
    defaultTitle: defaultTitle,
    sanitizeFileName: sanitizeFileName,
    parseTags: parseTags,
    buildNote: buildNote,
    buildUri: buildUri,
  };
});

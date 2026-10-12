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

  // A blank vault means "whichever vault Obsidian opened last".
  const DEFAULT_SETTINGS = {
    vault: '',
    folder: 'Clippings',
    baseTag: 'clippings',
    sourceKey: 'source',
    dateKey: 'clipped',
    urlInBody: true,
  };

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

  // One tag: no leading #, spaces become dashes, characters Obsidian
  // doesn't allow in tags become dashes.
  function cleanTag(piece) {
    return String(piece || '')
      .trim()
      .replace(/^#+/, '')
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}_\-\/]/gu, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // The base tag (if any) is always first; extras are comma- or
  // newline-separated.
  function parseTags(input, baseTag) {
    const seen = new Set();
    const tags = [];
    const add = (t) => {
      if (!t || seen.has(t.toLowerCase())) return;
      seen.add(t.toLowerCase());
      tags.push(t);
    };
    add(cleanTag(baseTag));
    String(input || '')
      .split(/[,\n]/)
      .forEach(function (piece) {
        add(cleanTag(piece));
      });
    return tags;
  }

  // A folder path inside the vault: forward slashes, no empty or dot
  // segments, no characters Obsidian rejects. Blank means the vault root.
  function cleanFolder(value) {
    return String(value || '')
      .replace(/\\/g, '/')
      .split('/')
      .map(function (part) {
        return part.replace(/[:*?"<>|#^\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
      })
      .filter(function (part) {
        return part && part !== '.' && part !== '..';
      })
      .join('/');
  }

  // A frontmatter property name. Kept to plain characters so it needs no
  // YAML quoting.
  function cleanKey(value, fallback) {
    const s = String(value || '').trim();
    return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(s) ? s : fallback;
  }

  function normalizeSettings(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const isText = (k) => typeof raw[k] === 'string';
    return {
      vault: isText('vault') ? raw.vault.trim() : DEFAULT_SETTINGS.vault,
      folder: isText('folder') ? cleanFolder(raw.folder) : DEFAULT_SETTINGS.folder,
      baseTag: isText('baseTag') ? cleanTag(raw.baseTag) : DEFAULT_SETTINGS.baseTag,
      sourceKey: cleanKey(raw.sourceKey, DEFAULT_SETTINGS.sourceKey),
      dateKey: cleanKey(raw.dateKey, DEFAULT_SETTINGS.dateKey),
      urlInBody: typeof raw.urlInBody === 'boolean' ? raw.urlInBody : DEFAULT_SETTINGS.urlInBody,
    };
  }

  function buildNote(clip, options) {
    const o = normalizeSettings(options);
    const lines = ['---', 'title: ' + JSON.stringify(clip.title)];
    if (clip.url) lines.push(o.sourceKey + ': ' + JSON.stringify(clip.url));
    lines.push(o.dateKey + ': ' + clip.date);
    if (clip.tags.length) {
      lines.push('tags:');
      clip.tags.forEach(function (t) {
        lines.push('  - ' + t);
      });
    }
    lines.push('---', '');

    const body = [];
    if (clip.url && o.urlInBody) body.push(clip.url);
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
    const path = opts.folder ? opts.folder + '/' + opts.fileName : opts.fileName;
    const base =
      'obsidian://new?' + (opts.vault ? 'vault=' + enc(opts.vault) + '&' : '') + 'file=' + enc(path);
    const full = base + '&content=' + enc(opts.note);
    if (full.length <= opts.maxLength) return { uri: full, clipboard: false };
    return { uri: base + '&clipboard', clipboard: true };
  }

  return {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    localDate: localDate,
    extractUrl: extractUrl,
    parseShare: parseShare,
    defaultTitle: defaultTitle,
    sanitizeFileName: sanitizeFileName,
    cleanTag: cleanTag,
    parseTags: parseTags,
    cleanFolder: cleanFolder,
    cleanKey: cleanKey,
    normalizeSettings: normalizeSettings,
    buildNote: buildNote,
    buildUri: buildUri,
  };
});

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

  // What Chrome actually sent, untouched, so a new payload shape can be
  // copied into a test. A parameter that wasn't sent is null, not ''.
  // Returns null when nothing was shared.
  function rawShare(search) {
    const p = new URLSearchParams(search || '');
    const raw = { title: p.get('title'), text: p.get('text'), url: p.get('url') };
    return raw.title === null && raw.text === null && raw.url === null ? null : raw;
  }

  function hostname(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  }

  // Path words that name a kind of page rather than the page itself.
  const NOT_TITLES = new Set([
    'a', 'amp', 'article', 'articles', 'blog', 'comments', 'default', 'en', 'home', 'index',
    'item', 'news', 'p', 'page', 'post', 'posts', 'status', 'story', 'video', 'videos',
    'view', 'watch', 'wiki',
  ]);

  // An ID or a hash: a long number (CBC's "9.7376691" counts), or long and
  // mixing letters and digits. Short numbers stay, so "10-tips" and
  // "books-of-2024" keep them.
  function isIdLike(word) {
    return /^[\d.]{5,}$/.test(word) || (word.length >= 6 && /\d/.test(word) && /^[a-z0-9]+$/i.test(word));
  }

  // The readable words in one path segment, or [] if there are none.
  // A date at either end (Reuters ends slugs with 2026-10-12) is dropped.
  function slugWords(segment) {
    const words = safeDecode(segment)
      .replace(/\.(s?html?|php|aspx?|jsp)$/i, '')
      .replace(/^\d{4}-\d{2}-\d{2}(?=[-_]|$)|(^|[-_])\d{4}-\d{2}-\d{2}$/g, '')
      .split(/[-_+\s]+/)
      .reduce(function (all, w) {
        // Dots join words ("file.name") except inside a number ("9.7376691").
        return all.concat(/^[\d.]+$/.test(w) ? [w] : w.split('.'));
      }, [])
      .filter(function (w) {
        return w && !isIdLike(w);
      });
    if (!words.some((w) => /\p{L}/u.test(w))) return [];
    if (words.length === 1 && (words[0].length < 4 || NOT_TITLES.has(words[0].toLowerCase()))) return [];
    return words;
  }

  function capitalise(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // A title built from the link alone, for shares that arrive without one.
  // Returns '' when the path has nothing readable (IDs, hashes, a bare host).
  function titleFromUrl(url) {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return '';
    }
    const host = u.hostname.replace(/^(www|m|old|mobile)\./, '');
    const parts = u.pathname.split('/').filter(Boolean);

    if (/(^|\.)wikipedia\.org$/.test(host) && parts[0] === 'wiki' && parts[1]) {
      return safeDecode(parts.slice(1).join('/')).replace(/_/g, ' ').trim();
    }
    if (host === 'github.com' && parts.length >= 2) {
      return parts[0] + '/' + parts[1];
    }
    if (host === 'reddit.com' && parts[0] === 'r' && parts[1]) {
      const sub = 'r/' + parts[1];
      const words = parts[2] === 'comments' && parts[4] ? slugWords(parts[4]) : [];
      return words.length ? capitalise(words.join(' ')) + ' (' + sub + ')' : sub;
    }

    for (let i = parts.length - 1; i >= 0; i--) {
      const words = slugWords(parts[i]);
      if (words.length) {
        const title = capitalise(words.join(' '));
        if (title.length <= 80) return title;
        const cut = title.slice(0, 81);
        return cut.slice(0, cut.lastIndexOf(' ')).trim() || title.slice(0, 80);
      }
    }
    return '';
  }

  function defaultTitle(share) {
    if (share.title) return share.title;
    const firstLine = (share.selection || '').split(/\r?\n/)[0].trim();
    if (firstLine) return firstLine.length > 80 ? firstLine.slice(0, 80).trim() : firstLine;
    return titleFromUrl(share.url) || hostname(share.url);
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

  // A comma- or newline-separated list of tags, cleaned and de-duplicated
  // (ignoring case). Blank pieces are dropped.
  function cleanTagList(input) {
    const seen = new Set();
    const tags = [];
    String(input || '')
      .split(/[,\n]/)
      .forEach(function (piece) {
        const t = cleanTag(piece);
        if (!t || seen.has(t.toLowerCase())) return;
        seen.add(t.toLowerCase());
        tags.push(t);
      });
    return tags;
  }

  // The always-on tags (a comma-separated list, possibly blank) come first,
  // then the extras typed for this clip.
  function parseTags(input, baseTags) {
    return cleanTagList(String(baseTags || '') + ',' + String(input || ''));
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
      baseTag: isText('baseTag') ? cleanTagList(raw.baseTag).join(', ') : DEFAULT_SETTINGS.baseTag,
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
    rawShare: rawShare,
    titleFromUrl: titleFromUrl,
    defaultTitle: defaultTitle,
    sanitizeFileName: sanitizeFileName,
    cleanTag: cleanTag,
    cleanTagList: cleanTagList,
    parseTags: parseTags,
    cleanFolder: cleanFolder,
    cleanKey: cleanKey,
    normalizeSettings: normalizeSettings,
    buildNote: buildNote,
    buildUri: buildUri,
  };
});

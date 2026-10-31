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

  // Query parameters that only track where a click came from. Exact names,
  // plus anything starting with utm_. YouTube's `si` is dropped on YouTube
  // hosts only, since other sites use `si` for real things.
  const TRACKING_PARAMS = new Set([
    'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid', 'ref_src',
  ]);

  function isTrackingParam(name, host) {
    const n = name.toLowerCase();
    if (n.indexOf('utm_') === 0 || TRACKING_PARAMS.has(n)) return true;
    return n === 'si' && /(^|\.)(youtube\.com|youtu\.be)$/.test(host);
  }

  // A shared link without tracking parameters, and a Google redirect
  // (google.com/url?q=...) unwrapped to where it points. Everything else,
  // including the order of the other parameters and the #fragment, is kept.
  // Anything that isn't an http(s) URL comes back unchanged.
  function cleanUrl(url) {
    const raw = String(url || '').trim();
    let u;
    try {
      u = new URL(raw);
    } catch (e) {
      return raw;
    }
    if (!/^https?:$/.test(u.protocol)) return raw;

    if (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname === '/url') {
      const target = u.searchParams.get('q') || u.searchParams.get('url');
      if (target && /^https?:\/\//i.test(target)) return cleanUrl(target);
    }

    const host = u.hostname;
    const kept = raw
      .replace(/#.*$/, '')
      .replace(/^[^?]*\??/, '')
      .split('&')
      .filter(function (pair) {
        if (!pair) return false;
        const name = safeDecode(pair.split('=')[0].replace(/\+/g, ' '));
        return !isTrackingParam(name, host);
      });
    // Rebuilt by hand so the kept parameters stay byte-for-byte as shared.
    return u.origin + u.pathname + (kept.length ? '?' + kept.join('&') : '') + u.hash;
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

  // Site names that appear on other hosts too (custom domains, embeds).
  const KNOWN_SITES = ['github', 'medium', 'reddit', 'substack', 'wikipedia', 'youtube'];

  // Words a site adds after its name: "CBC News", "Wired Magazine".
  const SITE_WORDS = ['', 'news', 'online', 'blog', 'magazine', 'com'];

  // Separators sites put between the page title and their own name.
  const TITLE_SEPARATORS = [' | ', ' - ', ' \u2013 ', ' \u2014 ', ' \u00b7 ', ' :: '];

  function squash(s) {
    return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  }

  // Does this piece of a title name the site at this URL? "Reuters" for
  // reuters.com, "The Kitchen" for thekitchen.com, "CBC News" for cbc.ca.
  function namesSite(piece, url) {
    const name = squash(piece);
    if (!name || piece.length > 40) return false;
    if (KNOWN_SITES.indexOf(name) >= 0) return true;
    let labels;
    try {
      labels = new URL(url).hostname.split('.').slice(0, -1);
    } catch (e) {
      return false;
    }
    return labels.some(function (label) {
      label = squash(label);
      if (label.length < 3) return false;
      return name === label || SITE_WORDS.some((w) => name === label + w || name === 'the' + label + w);
    });
  }

  // Removes the site's name from a shared title when it is clearly there:
  // "How to bake bread | The Kitchen" becomes "How to bake bread". Only the
  // last piece (or the first, for "GitHub - owner/repo") is ever removed,
  // and only when it names the site, so "Part 2 - Getting started" stays.
  function tidyTitle(title, url) {
    const t = String(title || '').replace(/\s+/g, ' ').trim();
    let best = null;
    TITLE_SEPARATORS.forEach(function (sep) {
      const last = t.lastIndexOf(sep);
      if (last > 0 && (!best || last > best.at) && namesSite(t.slice(last + sep.length), url)) {
        best = { at: last, keep: t.slice(0, last) };
      }
    });
    if (best) return best.keep.trim();
    for (let i = 0; i < TITLE_SEPARATORS.length; i++) {
      const sep = TITLE_SEPARATORS[i];
      const first = t.indexOf(sep);
      if (first > 0 && namesSite(t.slice(0, first), url)) return t.slice(first + sep.length).trim();
    }
    return t;
  }

  function defaultTitle(share) {
    if (share.title) return tidyTitle(share.title, share.url) || share.title;
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

  // The quiet line under the header: where clips go, then the always-on
  // tags. A blank vault means whichever vault Obsidian opened last.
  function destination(settings) {
    const vault = settings.vault || 'last-used vault';
    return settings.folder ? vault + ' / ' + settings.folder : vault;
  }

  function hashTags(tagList) {
    return cleanTagList(tagList)
      .map(function (t) {
        return '#' + t;
      })
      .join(' ');
  }

  // ---- Recent tags ------------------------------------------------------

  // Extra tags used before, kept on the device as
  // { "<tag>": { "count": n, "last": "YYYY-MM-DD", "hosts": { "<host>": n } } }
  // and offered as chips. Records saved before hosts existed have none.
  const RECENT_TAG_CAP = 50;
  const HOSTS_PER_TAG = 10;

  // A stored record, with anything unreadable dropped.
  function cleanRecent(record) {
    const out = {};
    if (!record || typeof record !== 'object' || Array.isArray(record)) return out;
    Object.keys(record).forEach(function (key) {
      const tag = cleanTag(key);
      const entry = record[key];
      if (!tag || !entry || typeof entry !== 'object') return;
      const count = Math.floor(Number(entry.count));
      if (!(count > 0)) return;
      out[tag] = {
        count: count,
        last: typeof entry.last === 'string' ? entry.last : '',
        hosts: cleanHosts(entry.hosts),
      };
    });
    return out;
  }

  function cleanHosts(hosts) {
    const out = {};
    if (!hosts || typeof hosts !== 'object' || Array.isArray(hosts)) return out;
    Object.keys(hosts).forEach(function (host) {
      const n = Math.floor(Number(hosts[host]));
      if (host && n > 0) out[host] = n;
    });
    return out;
  }

  // Keeps the hosts a tag was used on most, dropping the rest.
  function capHosts(hosts) {
    const out = {};
    Object.keys(hosts)
      .sort(function (a, b) {
        return hosts[b] - hosts[a] || a.localeCompare(b);
      })
      .slice(0, HOSTS_PER_TAG)
      .forEach(function (host) {
        out[host] = hosts[host];
      });
    return out;
  }

  // Lower case, with anything that isn't a letter or digit as a single
  // space, padded so a phrase can be matched as whole words.
  function wordsOf(s) {
    return ' ' + String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ';
  }

  // Most used first, then most recently used, then alphabetical.
  function byUse(record) {
    return function (a, b) {
      return (
        record[b].count - record[a].count ||
        (record[a].last < record[b].last ? 1 : record[a].last > record[b].last ? -1 : 0) ||
        a.localeCompare(b)
      );
    };
  }

  // Counts one more use of each tag on the given date, and on the site of
  // the given link, and returns a new record. A tag matches an earlier one
  // ignoring case, and keeps the spelling used last. Past the cap, the
  // least used tags are dropped.
  function recordTags(record, tags, date, url) {
    const next = cleanRecent(record);
    const host = hostname(url);
    cleanTagList((tags || []).join(',')).forEach(function (tag) {
      let count = 0;
      const hosts = {};
      Object.keys(next).forEach(function (key) {
        if (key.toLowerCase() !== tag.toLowerCase()) return;
        count += next[key].count;
        Object.keys(next[key].hosts).forEach(function (h) {
          hosts[h] = (hosts[h] || 0) + next[key].hosts[h];
        });
        delete next[key];
      });
      if (host) hosts[host] = (hosts[host] || 0) + 1;
      next[tag] = { count: count + 1, last: String(date || ''), hosts: capHosts(hosts) };
    });
    const keys = Object.keys(next).sort(byUse(next));
    keys.slice(RECENT_TAG_CAP).forEach(function (key) {
      delete next[key];
    });
    return next;
  }

  // Up to `limit` tags to suggest, best first, leaving out any in `exclude`
  // (ignoring case). With a clip's `url` and `title`, tags used on the same
  // site come first (most used there first), then tags that appear as words
  // in the title (`-` and `_` count as spaces), then the rest by use.
  function rankTags(record, exclude, limit, clip) {
    const recent = cleanRecent(record);
    const skip = new Set(
      (exclude || []).map(function (t) {
        return String(t).toLowerCase();
      })
    );
    const host = hostname(clip && clip.url);
    const title = wordsOf(clip && clip.title);
    function onSite(tag) {
      return (host && recent[tag].hosts[host]) || 0;
    }
    function inTitle(tag) {
      const phrase = wordsOf(tag);
      return phrase.trim() !== '' && title.indexOf(phrase) !== -1;
    }
    const use = byUse(recent);
    return Object.keys(recent)
      .filter(function (tag) {
        return !skip.has(tag.toLowerCase());
      })
      .sort(function (a, b) {
        return (
          (onSite(a) ? 0 : 1) - (onSite(b) ? 0 : 1) ||
          onSite(b) - onSite(a) ||
          (inTitle(a) ? 0 : 1) - (inTitle(b) ? 0 : 1) ||
          use(a, b)
        );
      })
      .slice(0, limit === undefined ? 8 : limit);
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
    cleanUrl: cleanUrl,
    titleFromUrl: titleFromUrl,
    tidyTitle: tidyTitle,
    defaultTitle: defaultTitle,
    sanitizeFileName: sanitizeFileName,
    cleanTag: cleanTag,
    cleanTagList: cleanTagList,
    parseTags: parseTags,
    destination: destination,
    hashTags: hashTags,
    recordTags: recordTags,
    rankTags: rankTags,
    cleanFolder: cleanFolder,
    cleanKey: cleanKey,
    normalizeSettings: normalizeSettings,
    buildNote: buildNote,
    buildUri: buildUri,
  };
});

(function () {
  'use strict';

  var clip = window.MagpieClip;

  var STORE_KEY = 'magpie.settings.v1';
  var RECENT_KEY = 'magpie.recent.v1';
  var MAX_URI_LENGTH = 8000;

  var settings = clip.normalizeSettings(null);

  var $ = function (id) {
    return document.getElementById(id);
  };

  // ---- Settings storage -------------------------------------------------

  // Returns true if settings were found. Storage can be unavailable (private
  // windows, blocked site data), in which case Magpie still works for the
  // session and asks again next time.
  function loadSettings() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        settings = clip.normalizeSettings(JSON.parse(raw));
        return true;
      }
    } catch (e) {
      /* fall through to defaults */
    }
    return false;
  }

  function persistSettings() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(settings));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---- Recent tags ------------------------------------------------------

  // Kept under its own key so the settings shape doesn't change. Without
  // storage there are simply no chips.
  function loadRecent() {
    try {
      return JSON.parse(window.localStorage.getItem(RECENT_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function rememberTags() {
    var base = clip.cleanTagList(settings.baseTag);
    var extras = clip.cleanTagList($('tags').value).filter(function (t) {
      return !hasTag(base, t);
    });
    if (!extras.length) return;
    try {
      var next = clip.recordTags(loadRecent(), extras, clip.localDate());
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch (e) {
      /* Suggestions are a convenience; saving the clip matters more. */
    }
  }

  function forgetTags() {
    try {
      window.localStorage.removeItem(RECENT_KEY);
    } catch (e) {
      /* Nothing stored to forget. */
    }
    renderChips();
    setStatus('forget-status', 'Recent tags forgotten.');
  }

  function hasTag(list, tag) {
    return list.some(function (t) {
      return t.toLowerCase() === tag.toLowerCase();
    });
  }

  function renderChips() {
    var box = $('tag-chips');
    var tags = clip.rankTags(loadRecent(), clip.cleanTagList(settings.baseTag));
    box.textContent = '';
    tags.forEach(function (tag) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = tag;
      chip.dataset.tag = tag;
      box.appendChild(chip);
    });
    box.hidden = !tags.length;
    markChips();
  }

  // A chip shows as pressed while its tag is in the field.
  function markChips() {
    var typed = clip.cleanTagList($('tags').value);
    var chips = $('tag-chips').querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].setAttribute('aria-pressed', hasTag(typed, chips[i].dataset.tag) ? 'true' : 'false');
    }
  }

  function toggleChip(event) {
    var chip = event.target.closest('.chip');
    if (!chip) return;
    var tag = chip.dataset.tag;
    var typed = clip.cleanTagList($('tags').value);
    var next = hasTag(typed, tag)
      ? typed.filter(function (t) {
          return t.toLowerCase() !== tag.toLowerCase();
        })
      : typed.concat(tag);
    $('tags').value = next.join(', ');
    markChips();
  }

  // ---- Views ------------------------------------------------------------

  function showView(name) {
    $('settings-view').hidden = name !== 'settings';
    $('clip-view').hidden = name !== 'clip';
    $('open-settings').hidden = name === 'settings';
    $('summary').hidden = name === 'settings';
  }

  function renderDestination() {
    var tags = clip.hashTags(settings.baseTag);
    $('dest').textContent = clip.destination(settings);
    $('base-tags').textContent = tags ? ' · ' + tags : '';
  }

  function fillSettingsForm(s) {
    $('s-vault').value = s.vault;
    $('s-folder').value = s.folder;
    $('s-tag').value = s.baseTag;
    $('s-source').value = s.sourceKey;
    $('s-date').value = s.dateKey;
    $('s-urlbody').checked = s.urlInBody;
  }

  function readSettingsForm() {
    return clip.normalizeSettings({
      vault: $('s-vault').value,
      folder: $('s-folder').value,
      baseTag: $('s-tag').value,
      sourceKey: $('s-source').value,
      dateKey: $('s-date').value,
      urlInBody: $('s-urlbody').checked,
    });
  }

  function setStatus(id, message, isError) {
    var el = $(id);
    el.textContent = message;
    el.className = isError ? 'error' : '';
  }

  var firstRun = false;

  function openSettings() {
    fillSettingsForm(settings);
    setStatus('settings-status', '');
    setStatus('forget-status', '');
    $('welcome').hidden = !firstRun;
    $('cancel-settings').hidden = firstRun;
    showView('settings');
    window.scrollTo(0, 0);
  }

  function closeSettings() {
    renderDestination();
    renderChips();
    showView('clip');
  }

  function saveSettingsForm(event) {
    event.preventDefault();
    settings = readSettingsForm();
    var stored = persistSettings();
    firstRun = false;
    closeSettings();
    if (!stored) {
      setStatus(
        'status',
        "Couldn't store settings on this device, so they last until you close Magpie.",
        true
      );
    }
  }

  function resetSettings() {
    fillSettingsForm(clip.normalizeSettings(null));
    setStatus('settings-status', 'Defaults filled in. Tap Save settings to keep them.');
  }

  // ---- Clipping ---------------------------------------------------------

  function currentClip() {
    var date = clip.localDate();
    var title = $('title').value.trim();
    return {
      title: title || 'Clip ' + date,
      url: $('url').value.trim(),
      selection: $('selection').value.trim(),
      note: $('note').value.trim(),
      tags: clip.parseTags($('tags').value, settings.baseTag),
      date: date,
    };
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return Promise.reject(new Error('Clipboard is not available'));
  }

  // Opens an obsidian:// link. Browser tests can't observe a navigation to a
  // custom scheme, so they replace this by defining window.__magpieOpen.
  function openObsidian(uri) {
    if (typeof window.__magpieOpen === 'function') window.__magpieOpen(uri);
    else window.location.href = uri;
  }

  function save(event) {
    event.preventDefault();
    rememberTags();
    var c = currentClip();
    var note = clip.buildNote(c, settings);
    var result = clip.buildUri({
      vault: settings.vault,
      folder: settings.folder,
      fileName: clip.sanitizeFileName(c.title, 'Clip ' + c.date),
      note: note,
      maxLength: MAX_URI_LENGTH,
    });

    function launch() {
      setStatus('status', 'Sent to Obsidian. If nothing opened, check that Obsidian is installed.');
      openObsidian(result.uri);
    }

    if (!result.clipboard) {
      launch();
      return;
    }
    // Long notes: put the Markdown on the clipboard, then ask Obsidian to
    // create the note from it.
    copyText(note).then(launch, function () {
      setStatus('status', 'This clip is too long to send in a link and the clipboard is blocked.', true);
    });
  }

  function copyNote() {
    rememberTags();
    copyText(clip.buildNote(currentClip(), settings)).then(
      function () {
        setStatus('status', 'Copied. Paste it into a new note.');
      },
      function () {
        setStatus('status', 'Could not access the clipboard.', true);
      }
    );
  }

  // The selection box only shows when something was selected, or after
  // Add a quote is tapped. Most shares are a whole page with no selection.
  function showSelectionField(show) {
    $('selection-field').hidden = !show;
    $('add-quote').hidden = show;
  }

  function addQuote() {
    showSelectionField(true);
    $('selection').focus();
  }

  // ---- Last share received ----------------------------------------------

  // Shown in Settings so a new payload shape can be copied into a test.
  // Kept in memory for this launch only.
  var rawShareJson = '';

  function showRawShare(raw) {
    rawShareJson = raw ? JSON.stringify(raw, null, 2) : '';
    $('raw-share-none').hidden = !!raw;
    $('raw-share-text').hidden = !raw;
    $('copy-raw-share').hidden = !raw;
    $('raw-share-text').textContent = rawShareJson;
  }

  function copyRawShare() {
    copyText(rawShareJson).then(
      function () {
        setStatus('raw-share-status', 'Copied.');
      },
      function () {
        setStatus('raw-share-status', 'Could not access the clipboard.', true);
      }
    );
  }

  // ---- Start up ---------------------------------------------------------

  function showVersion() {
    var text = 'v' + (window.MAGPIE_VERSION || '?');
    var spots = document.querySelectorAll('.app-version');
    for (var i = 0; i < spots.length; i++) spots[i].textContent = text;
  }

  function init() {
    showVersion();
    var share = clip.parseShare(window.location.search);
    // Tracking parameters always come off the shared link.
    share.url = clip.cleanUrl(share.url);
    $('title').value = clip.defaultTitle(share);
    $('url').value = share.url;
    $('selection').value = share.selection;
    showSelectionField(!!share.selection);
    $('hint').hidden = !!(share.title || share.url || share.selection);
    showRawShare(clip.rawShare(window.location.search));

    $('clip-form').addEventListener('submit', save);
    $('copy').addEventListener('click', copyNote);
    $('add-quote').addEventListener('click', addQuote);
    $('open-settings').addEventListener('click', openSettings);
    $('summary').addEventListener('click', openSettings);
    $('cancel-settings').addEventListener('click', closeSettings);
    $('reset-settings').addEventListener('click', resetSettings);
    $('settings-form').addEventListener('submit', saveSettingsForm);
    $('copy-raw-share').addEventListener('click', copyRawShare);
    $('tag-chips').addEventListener('click', toggleChip);
    $('tags').addEventListener('input', markChips);
    $('forget-tags').addEventListener('click', forgetTags);

    // First run: ask where clips go before anything else. A page that was
    // just shared stays filled in behind the settings screen.
    firstRun = !loadSettings();
    renderDestination();
    renderChips();
    if (firstRun) openSettings();
    else showView('clip');

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {
        /* Offline support is optional; the app works without it. */
      });
    }
  }

  init();
})();

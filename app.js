(function () {
  'use strict';

  var clip = window.MagpieClip;

  // The vault name is fixed. Change these if the vault or folder ever move.
  var CONFIG = {
    vault: 'randomized-rituals',
    folder: 'Clippings',
    baseTag: 'clippings',
    maxUriLength: 8000,
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  function setStatus(message, isError) {
    var el = $('status');
    el.textContent = message;
    el.className = isError ? 'error' : '';
  }

  function currentClip() {
    var date = clip.localDate();
    var title = $('title').value.trim();
    return {
      title: title || 'Clip ' + date,
      url: $('url').value.trim(),
      selection: $('selection').value.trim(),
      note: $('note').value.trim(),
      tags: clip.parseTags($('tags').value, CONFIG.baseTag),
      date: date,
    };
  }

  function fileNameFor(c) {
    return clip.sanitizeFileName(c.title, 'Clip ' + c.date);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return Promise.reject(new Error('Clipboard is not available'));
  }

  function save(event) {
    event.preventDefault();
    var c = currentClip();
    var note = clip.buildNote(c);
    var result = clip.buildUri({
      vault: CONFIG.vault,
      folder: CONFIG.folder,
      fileName: fileNameFor(c),
      note: note,
      maxLength: CONFIG.maxUriLength,
    });

    function launch() {
      setStatus('Sent to Obsidian. If nothing opened, check that Obsidian is installed.');
      window.location.href = result.uri;
    }

    if (!result.clipboard) {
      launch();
      return;
    }
    // Long notes: put the Markdown on the clipboard, then ask Obsidian to
    // create the note from it.
    copyText(note).then(launch, function () {
      setStatus('This clip is too long to send in a link and the clipboard is blocked.', true);
    });
  }

  function copyNote() {
    var note = clip.buildNote(currentClip());
    copyText(note).then(
      function () {
        setStatus('Copied. Paste it into a new note.');
      },
      function () {
        setStatus('Could not access the clipboard.', true);
      }
    );
  }

  function init() {
    $('dest').textContent = CONFIG.vault + ' / ' + CONFIG.folder;
    $('base-tag').textContent = CONFIG.baseTag;

    var share = clip.parseShare(window.location.search);
    $('title').value = clip.defaultTitle(share);
    $('url').value = share.url;
    $('selection').value = share.selection;
    $('hint').hidden = !!(share.title || share.url || share.selection);

    $('clip-form').addEventListener('submit', save);
    $('copy').addEventListener('click', copyNote);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {
        /* Offline support is optional; the app works without it. */
      });
    }
  }

  init();
})();

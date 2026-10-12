# magpie

An Android web clipper for Obsidian.

Chrome on Android can't run the Obsidian Web Clipper extension. Magpie is a small installable web app (a PWA) that adds itself to Chrome's Share menu. Share a page or a text selection, tap **Save to Obsidian**, and a note lands in your vault.

## What a clip looks like

By default, notes are created in a `Clippings` folder in your vault:

```markdown
---
title: "Page title"
source: "https://example.com/page"
clipped: 2026-10-11
tags:
  - clippings
  - any-extra-tags
---

https://example.com/page

> Selected text, if any

Your note, if any
```

`clippings` is applied to every clip. The share screen has an optional field for extra tags, which are written to the same list. The folder, tag and property names are all configurable (see Settings).

## Install

1. In Chrome on Android, open the hosted app (GitHub Pages URL below).
2. Chrome menu, then **Install app**.
3. Share any page from Chrome and pick **Magpie**.

The app is served from `https://jessescott.github.io/magpie/`. All paths in the code are relative so it works under that `/magpie/` subpath.

Choose **Install**, not **Create shortcut**. A shortcut is only a bookmark and won't appear in the Share menu.

## Settings

The first time you open Magpie it asks where to save clips. Open **Settings** any time to change it.

| Setting | Default | Notes |
| --- | --- | --- |
| Vault name | blank | Exactly as Obsidian shows it (case matters). Blank uses whichever vault you opened last. |
| Folder | `Clippings` | A folder inside the vault. Blank saves to the vault root. |
| Tag added to every clip | `clippings` | Blank adds no automatic tag. |
| Property name for the link | `source` | Letters, digits, `_` and `-`. |
| Property name for the clip date | `clipped` | Same rule. |
| Link at the top of the note | on | The link is always in the frontmatter. |

Settings are stored on your device and survive closing the app.

## Privacy

Everything runs on your phone. Magpie has no server, no analytics and no account, and nothing you clip is sent anywhere except to Obsidian on the same device. The only network requests are the ones that load the app itself.

## How it works

The share target in `manifest.webmanifest` receives `title`, `text` and `url`. `clip.js` builds the note and an `obsidian://new` link, and `app.js` opens it. Short notes travel inside the link. Notes too long for a link are copied to the clipboard and created with `obsidian://new?...&clipboard`.

No server and no build step. Phase 2 (full-article extraction through a Cloudflare Worker) is not built yet.

## Develop

```sh
npm test            # unit tests for clip.js, uses Node's built-in runner
python -m http.server 8000
```

Chrome only treats `localhost` and HTTPS as installable, so test sharing on a phone from the GitHub Pages deployment. After changing cached files, bump `CACHE` in `sw.js` so installed copies update.


## Files

| File | Purpose |
| --- | --- |
| `index.html`, `style.css`, `app.js` | The share screen |
| `clip.js` | Parsing the share, building the note and the Obsidian link |
| `manifest.webmanifest` | Install metadata and the share target |
| `sw.js` | Offline cache, required for installing |
| `test/` | Tests for `clip.js` |

## License

MIT

# AGENTS.md

Guidance for AI coding agents working in this repo. Humans: the README is the better start.

## What this is

Magpie is an Android web clipper for Obsidian. It's an installable web app (a PWA) that registers as a share target in Chrome on Android. Sharing a page opens a short screen, and **Save to Obsidian** builds an `obsidian://new` link that creates a Markdown note in the user's vault.

- Live: https://jessescott.github.io/magpie/ (GitHub Pages, deployed from `main`, served under the `/magpie/` subpath)
- Repo: https://github.com/JesseScott/magpie
- Everything runs on the user's phone. There is no server, no analytics and no account. Keep it that way unless an issue says otherwise.

## Commands

```sh
npm test               # unit and static checks. Node's built-in runner. Nothing to install.
npm run test:e2e       # Playwright smoke tests in Chromium (needs: npm ci && npx playwright install chromium)
npm run check:version  # would CI ask for a version bump on this branch? (compares with origin/main)
```

Run `npm test` before every commit. Run `npm run test:e2e` when you touch `index.html`, `app.js`, `style.css` or `sw.js`.

## Layout

| Path | What it is |
| --- | --- |
| `index.html`, `style.css`, `app.js` | The screen: first-run setup, Settings, and the clip form |
| `clip.js` | Pure logic: parsing a share, cleaning settings and tags, building the note and the Obsidian link. No DOM access, so Node tests can load it |
| `version.js` | The single source of truth for the app version |
| `sw.js` | Service worker: offline cache, named after the version |
| `manifest.webmanifest` | Install metadata and the GET share target |
| `icons/` | `icon.svg` is the source. The three PNGs are rendered from it |
| `test/` | Unit and static tests (`npm test`) |
| `e2e/` | Browser smoke tests and the tiny server they use |
| `scripts/` | `version-check.js`, used by CI |
| `docs/manual-checklist.md` | What the automated tests can't cover. Check it before a release |

## Rules that matter

1. **No build step and no runtime dependencies.** Files are served as written. `@playwright/test` is a dev dependency only. Don't add a bundler, a framework or a runtime package without an issue that asks for it.
2. **Keep paths relative.** The app lives under `/magpie/`, so `/something` breaks it. `test/static.test.js` checks this.
3. **Bump the version when you change a served file.** Served files are `index.html`, `app.js`, `clip.js`, `style.css`, `sw.js`, `manifest.webmanifest` and `icons/`. Bump `version.js` and `package.json` together (patch for fixes, minor for features). The service worker names its cache after the version, so an unbumped change never reaches installed copies. CI fails the PR with `npm run check:version`. Docs, tests, scripts and workflows need no bump.
4. **Don't hard-code a user's setup.** Vault, folder, tags and property names are settings, stored in `localStorage` under `magpie.settings.v1`. If you change the shape of the stored settings, keep old saved values working (`normalizeSettings` fills defaults) or add a migration.
5. **Put logic in `clip.js` and test it there.** `app.js` should stay thin wiring between the DOM and `clip.js`. New behaviour gets a unit test. New screen behaviour gets an e2e scenario.
6. **One small seam for tests.** `app.js` opens Obsidian through `openObsidian()`, which calls `window.__magpieOpen` if a test defined it. Tests read the exact link that way, because a navigation to `obsidian://` can't be observed. Don't remove it.
7. **LF line endings.** Don't commit CRLF.

## Things that have bitten us

- **GitHub Pages caches files for ten minutes.** The service worker precaches with `cache: 'reload'` and refreshes with `cache: 'no-cache'` so a new cache never holds the previous deploy's files. Don't "simplify" those options away. `test/static.test.js` guards them.
- **The first launch after a deploy still shows the old version.** The service worker serves the cache first and updates behind it. Verify a deploy by opening the installed app twice and reading the version in the footer.
- **Install, not Create shortcut.** A home screen shortcut is a bookmark and never appears in the Share menu. Only the installed app does.
- **Chrome's share data is messy.** The page title and URL sometimes arrive together in `text`, and a text selection arrives as `text`. `parseShare` handles the known cases. Add a test with the real payload when you find a new one.
- **Long notes.** Link length is limited, so over 8000 characters Magpie copies the note to the clipboard and uses `obsidian://new?...&clipboard`.
- **Unverified:** what Obsidian does when a note with the same name already exists. Don't write code that assumes either behaviour.

## Working in the repo

- Branch from `main`. One concern per pull request. Link the issue with `Closes #n`.
- Use the existing style: semicolons, 2-space indent, single quotes, plain `var` and functions in `app.js` and `sw.js`.
- Write the PR description for a reviewer who has only the PR in front of them: what changed, how you checked it, what you couldn't check, and a test plan.
- Say plainly what you couldn't test. Workflows, Dependabot config and the Android share sheet only run on GitHub or a real phone.
- In sandboxes where `gh issue create` and `gh pr create` fail (GraphQL blocked), use the REST API: `gh api repos/JesseScott/magpie/issues --method POST --input body.json`.
- Don't commit `node_modules/`, `playwright-report/` or `test-results/`. They are ignored.

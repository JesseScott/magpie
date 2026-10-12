# Manual checklist

The automated tests cover the screen and the link Magpie builds. They can't cover anything that needs a real Android phone or Obsidian. Run through this before a release, on the phone, using the deployed GitHub Pages site.

## After a deploy

- [ ] Open Magpie, close it fully, open it again. The footer shows the new version number. (The first launch after a deploy still shows the old version while the new one downloads.)

## Install

- [ ] In Chrome, the menu offers **Install app**. Choose it, not **Create shortcut**.
- [ ] The app icon on the home screen is the magpie icon, with no white corners or squashed shape.
- [ ] Opening the installed app shows no browser address bar.

## Share sheet

- [ ] Sharing a page from Chrome lists **Magpie**.
- [ ] Sharing a page fills in the title and the link.
- [ ] Sharing selected text fills in the selection and the link, and the title looks right (Chrome sometimes sends the title and link together).
- [ ] On first run, a shared page is still filled in after saving settings.

## Handoff into Obsidian

- [ ] **Save to Obsidian** opens Obsidian and creates the note in the right vault and folder.
- [ ] Properties are right: title, link, date, and a `tags` list showing as separate tags.
- [ ] Saving with a blank vault puts the note in the vault you opened last.
- [ ] A long clip (a few thousand words of selected text) still creates the note, through the clipboard.
- [ ] Saving the same page twice does the sensible thing. Record what Obsidian does when the note name already exists.

## Settings

- [ ] Settings survive fully closing and reopening the app.
- [ ] Clearing Magpie's site data in Chrome brings back the first-run screen.

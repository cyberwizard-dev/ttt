# TizenTube Mod — Continue Watching

A patched build of the [TizenTube userscript](https://github.com/reisxd/TizenTube)
(GPL-3.0) that adds a **Continue watching** shelf to the YouTube TV home page.

The built file is `userScript.js`; the modified source is in `source/`.
Upstream project and license: https://github.com/reisxd/TizenTube (GPL-3.0-only).

## What changed

- Added `source/mods/features/continueWatching.js`.
- The feature reads YouTube TV's `FEhistory` grid, converts the partially
  watched items into a shelf, caches it with resume progress, and prepends it
  to the home response.
- Added a **Continue Watching on Home** toggle under TizenTube Settings → Misc.
- The row is cached in `localStorage`, so it survives app restarts and
  background/resume.

## A-B repeat

Open the player **Settings** menu or the **Speed Controls** modal and choose
**A-B Repeat** (or press the yellow remote key):

1. set point A at the current position,
2. set point B and start looping the segment,
3. press again to clear the loop.

The feature can be disabled under TizenTube Settings → Video Player → Patch
Video Player UI.

## Release tags

The patched APK loads a tagged build, currently `@cw01`:

```
https://cdn.jsdelivr.net/gh/cyberwizard-dev/ttt@cw01/userScript.js
```

Cobalt and jsDelivr cache this URL, so publish each new userscript under a new
five-character tag (`cw02`, `cw03`, …) and re-patch the APK with that tag.
`@main` is not used for the TV build because it can serve a stale copy for
hours. Keep the tag at five characters so the embedded URL stays exactly 66
bytes (69 with `?v=`).

## Build

```sh
cd source/mods
npm install
npm run build
# output: ../dist/userScript.js
```

This repository exists only to host the userscript for the patched Cobalt APK.

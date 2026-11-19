# TizenTube Mod — Continue Watching

A patched build of the [TizenTube userscript](https://github.com/reisxd/TizenTube)
(GPL-3.0) that adds a **Continue watching** shelf to the YouTube TV home page.

The built file is `userScript.js`; the modified source is in `source/`.
Upstream project and license: https://github.com/reisxd/TizenTube (GPL-3.0-only).

## What changed

- Added `source/mods/features/continueWatching.js`.
- The feature reads YouTube TV's `FEhistory` feed, caches the shelf with
  resume progress, and prepends it to the home response.
- Added a **Continue Watching on Home** toggle under TizenTube Settings → Misc.

## A-B repeat

Press the **A-B Repeat** player button (or the yellow remote key) to:

1. set point A at the current position,
2. set point B and start looping the segment,
3. press again to clear the loop.

The feature can be disabled under TizenTube Settings → Video Player → Patch Video Player UI.

## Build

```sh
cd source/mods
npm install
npm run build
# output: ../dist/userScript.js
```

This repository exists only to host the userscript for the patched Cobalt APK.

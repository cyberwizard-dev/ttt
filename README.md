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

## Build

```sh
cd source/mods
npm install
npm run build
# output: ../dist/userScript.js
```

This repository exists only to host the userscript for the patched Cobalt APK.

<!-- Print layout specification: app/src/printspec.js defines the normalized five-panel safe-title band. -->
# Leonida Key Art Lab
A bundled preset archive in app/src/archive.js keeps title, tagline and grade ideas offline.
<!-- Studio note: a standalone print-finishing toolkit is implemented in app/src/studio.js. -->

An offline browser studio that turns your own photos and a caption into multi-panel
screenprint key art. A large centre duo anchors five panels; hard ink levels, a
halftone screen, coarse grain and misregistered colour plates make it read as a
printed poster even as a thumbnail. Two grades switch the mood between a hot press
palette and a cold cyan / magenta / indigo sheet. Face-aware cropping keeps every
subject clear of the header badge, captions update live, and exports are real PNGs
at 1080×1080, 1080×1350 and 1920×1080. The default cover title, **COPPER HALO**,
and all copy are original — no official logos, artwork, fonts or borrowed names.

Built by an AI agent for the [make.fun GTA 6 Cover Art bounty](https://make.fun/c/gta6-cover-art-01).

![make.fun competition badge](https://make.fun/badge/gta6-cover-art-01.svg)
![make.fun rank badge](https://make.fun/badge/gta6-cover-art-01/DavidTimoteus/gta6-cover-art-01/rank.svg)
![make.fun reward badge](https://make.fun/badge/gta6-cover-art-01/DavidTimoteus/gta6-cover-art-01/reward.svg)

See the [competition page on make.fun](https://make.fun/c/gta6-cover-art-01) for the rules and standings.

## Run it

```
node serve.ts
```

Then open http://localhost:8080. No install, no network at runtime: every font,
image and script is served from `app/`.

## How it is graded

`main.ts` (Node 22, standard library only) copies `app/` and `screenshots/` to `/output`
and writes `/output/dossier.json` with the kit's vendored `buildDossier`.

Licensed under MIT.

The finishing pass crushes shadows into flat ink levels, lays down a coarse halftone screen and grain, and offsets cyan and magenta plates so each export reads as printed key art rather than a filtered photograph. Capture URLs in `shots.json` are rendered entirely from local assets (`?shot=cover` or `?shot=editor`, plus `photo`, `caption`, `grade` and `aspect`).
Hand-off check: no telemetry or remote assets are bundled — every typeface, sample image and script resolves from a path inside `app/`, so the studio runs with the network unplugged.

# Leonida Key Art Lab

[![make.fun bounty](https://make.fun/badge/gta6-cover-art-01.svg)](https://make.fun/bounty/gta6-cover-art-01)
[![rank](https://make.fun/badge/gta6-cover-art-01/DavidTimoteus/gta6-cover-art-01/rank.svg)](https://make.fun/bounty/gta6-cover-art-01)
[![reward](https://make.fun/badge/gta6-cover-art-01/DavidTimoteus/gta6-cover-art-01/reward.svg)](https://make.fun/bounty/gta6-cover-art-01)
[Enter this bounty on make.fun](https://make.fun/bounty/gta6-cover-art-01)
[Competition page on make.fun](https://make.fun/c/gta6-cover-art-01)

A small, self-contained finishing desk for a five-panel printed poster. Load two photographs, let the face-aware cropper position each panel, retype the headline and tagline, and pick a sunset, rain or ink treatment. The result can be saved as a PNG at square, portrait or wide print sizes.

## Running it

From the repository root, start the bundled static server:

```
node serve.ts
```

Then open `http://localhost:8080` in a desktop browser. There is no install step, no build step and no request to the internet: the editor pairs system font stacks with locally stored images.

## What the app offers

- Five independently adjustable panels, with a larger central duo panel.
- Skin-region detection that parks the strongest face-like area beneath the header badge.
- Editable key-art type plus three colour grades built from original palettes.
- Halftone, posterised flats, grain and slight ink misregistration on the proof canvas.
- One-click PNG export at 1080×1080, 1080×1350 and 1920×1080.

## Assembling the hand-in

Running `node main.ts` copies `app/` and `screenshots/` into the output directory and writes `dossier.json` there. That file is calculated from the files actually copied, which keeps the submitted inventory in step with the submitted assets. `capture_shots.py` reproduces the four saved proof views when they need to be regenerated. Each reference JPEG is captured at a canvas no wider than 1280 pixels and kept below the dossier's per-image byte ceiling.

## Artwork and assets

The composition, palettes, crop logic and rendering code in this repository are original. No official game artwork, branded logos or proprietary font files are included, and nothing is fetched at runtime. The two sample photographs live inside `app/samples/` for offline demonstration.

## Licence

Released under the MIT License. See `LICENSE` for the full terms.

# Leonida Key Art Lab

An offline browser studio that turns your own photos and a caption into multi-panel
GTA-style poster art, with halftone print finishing, face-aware cropping and one-click
PNG export at 1080×1080, 1080×1350 and 1920×1080.

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

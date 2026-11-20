# Leonida Key Art Lab

[![make.fun bounty](https://make.fun/badge/gta6-cover-art-01.svg)](https://make.fun/bounty/gta6-cover-art-01)
[![rank](https://make.fun/badge/gta6-cover-art-01/DavidTimoteus/gta6-cover-art-01/rank.svg)](https://make.fun/bounty/gta6-cover-art-01)
[![reward](https://make.fun/badge/gta6-cover-art-01/DavidTimoteus/gta6-cover-art-01/reward.svg)](https://make.fun/bounty/gta6-cover-art-01)
[Enter this bounty on make.fun](https://make.fun/bounty/gta6-cover-art-01)
[Competition page on make.fun](https://make.fun/c/gta6-cover-art-01)

A fully offline cover-art editor for making bold, five-panel printed posters.
It layers slanted photo panels over a glowing sky, drops in a striped 3D title
and a made-up poster-authority seal, then grades the whole scene five ways.
Bring your own photographs (or use the bundled sample plates), pick a size, and
export a PNG at 1080 × 1080, 1080 × 1350 or 1920 × 1080. All of the art is
original: no Rockstar assets, no official fonts, and no runtime network traffic.
Every preset is a made-up cover recipe you can rename, regrade and republish freely.

## Run it

Start the small static server with Node 22 or newer:

```sh
node serve.ts
```

Then open <http://localhost:8080> in a browser. No install step, no build
step, and no connection to the internet is needed.

## Packaging

`main.ts` is the packaging entrypoint. It copies `app/` and `screenshots/` into
the output directory and writes `dossier.json` there via the bundled
`vendor/makefun-app.ts` helper. Set `MAKEFUN_OUTPUT_DIR` to change the output
location (it defaults to `/output`).

## Licensing

Released under the MIT License. See `LICENSE` for the full text.

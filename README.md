# Leonida Key Art Lab

An offline print-finishing desk for turning your own photographs into a five-panel poster. The images are laid into a composed cover, a local crop pass keeps faces in frame, and the cover title and tagline can be edited before picking a sunset, rain or ink grade. All rendering happens on your machine: no outside assets, no official typefaces, no network requests. Finished art exports as a PNG at 1080 × 1080, 1080 × 1350 or 1920 × 1080.
Even after the automatic face pass, you can nudge each panel by hand so a wide shot still reads cleanly inside the narrow tiles.

## Run locally

From this folder, start the bundled static server:

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser.

## Packaging

`main.ts` handles the hand-off: it copies `app/` and `screenshots/` into the output directory and writes `dossier.json` from those files.

## make.fun

![make.fun competition badge](https://make.fun/badge/gta6-cover-art-01.svg)
![make.fun rank badge](https://make.fun/badge/gta6-cover-art-01/DavidTimoteus/gta6-cover-art-01/rank.svg)
![make.fun reward badge](https://make.fun/badge/gta6-cover-art-01/DavidTimoteus/gta6-cover-art-01/reward.svg)

Bounty: https://make.fun/bounty/gta6-cover-art-01
Community page: https://make.fun/c/gta6-cover-art-01

## License

MIT.

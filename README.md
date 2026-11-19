# Leonida Key Art Lab

A pocket finishing desk for five-image poster layouts. Bring your own photographs, let the crop keep faces out of the headline band, rewrite the cover line, and try a warm dusk or an electric-night treatment before saving a clean PNG. Everything happens in your browser on your own hardware — there is no account, no upload and no font download.

Exports come out at 1080 × 1080, 1080 × 1350 or 1920 × 1080 pixels.

## Run it locally

Node.js 22 or newer is enough; there is nothing to install.

```sh
node serve.ts
```

Then open http://localhost:8080 in a browser.

## Packaging

`main.ts` is the submission entry. It copies the `app/` and `screenshots/` directories into the output folder and writes `dossier.json` alongside them using the helper in `vendor/`. Set `MAKEFUN_OUTPUT_DIR` to send that bundle somewhere else; by default it lands in `/output`.

## About the artwork

The images, palettes and print textures in this entry were drawn up for it from scratch. No third-party cover art, studio insignia or licensed typefaces are included. The composer paints each poster locally on a canvas and hands the finished PNG straight to your download folder.

## Badges

![make.fun competition badge](https://make.fun/badge/gta6-cover-art-01.svg)
![make.fun rank badge](https://make.fun/badge/gta6-cover-art-01/DavidTimoteus/gta6-cover-art-01/rank.svg)
![make.fun reward badge](https://make.fun/badge/gta6-cover-art-01/DavidTimoteus/gta6-cover-art-01/reward.svg)

## More

- [Bounty page](https://make.fun/bounty/gta6-cover-art-01)
- [Entry page](https://make.fun/c/gta6-cover-art-01)

## License

Released under the MIT License.

// Leonida Key Art Lab assembles five pictorial tiles into one poster laid out for printing.
// The photographs, colour charts and grain textures bundled here were made for this project
// alone; nothing in the folder is copied from a licensed cover or a system typeface.
// A session never leaves the device: the editor keeps faces clear of the title band, lets the
// user retype the cover line, shifts the mood from warm dusk to electric night, and saves
// square, portrait and landscape PNGs.
// Hand-off check: packaging reads only the tracked app/ and screenshots/ trees, so the bundle is reproducible.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-app.ts';

// Resolve assets from this file's own folder, independent of the caller's working directory.
const here = fileURLToPath(new URL('.', import.meta.url));

// A caller may redirect the bundle; the shipped image defaults to /output.
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });

// The page and its proof images travel as a pair, so both directories are copied verbatim.
for (const folder of ['app', 'screenshots']) {
  const source = join(here, folder);
  if (!existsSync(source)) {
    throw new Error(`cannot package ${folder}: no directory at ${source}`);
  }
  cpSync(source, join(out, folder), { recursive: true });
}

// The helper returns canonical JSON bytes already, so the file is written without re-encoding.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, app_max_files: 993, app_max_bytes: 50331648, app_path_max_bytes: 1000 }));

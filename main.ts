// Leonida Key Art Lab composes a set of local photographs into a five-panel print poster.
// Faces stay framed through an on-device crop pass, while captions and ink grades are tuned in the browser.
// The artwork here is drawn entirely from scratch: no licensed plates, no official typefaces, no bundled font files.
// Every asset the dossier needs travels with it, so the output folder stands on its own offline.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-app.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });

for (const folder of ['app', 'screenshots']) {
  const source = join(here, folder);
  if (!existsSync(source)) throw new Error(`missing ${folder}/ — nothing to package`);
  cpSync(source, join(out, folder), { recursive: true });
}

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, app_max_files: 993, app_max_bytes: 50331648, app_path_max_bytes: 1000 }));

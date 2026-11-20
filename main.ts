// Leonida Key Art Lab is a self-contained poster bench: five slanted photo
// panels, a striped extruded title and a printed-authority badge are composed
// into cover art entirely inside the browser, with no server behind them.
// The artwork is original — every plate, gradient, grain pass and lockup is
// generated here rather than lifted from a released game or its marketing.
// Nothing in this build ships a font file, a studio asset, or a network call.
// The packer is deliberately boring: it copies local folders and writes metadata.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-app.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });

for (const folder of ['app', 'screenshots']) {
  const source = join(here, folder);
  if (existsSync(source)) {
    cpSync(source, join(out, folder), { recursive: true });
  }
}

const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 50331648,
  app_path_max_bytes: 1000,
});

writeFileSync(join(out, 'dossier.json'), dossier);

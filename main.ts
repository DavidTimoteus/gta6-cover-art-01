// Leonida Key Art Lab turns two local photographs into a five-panel print proof.
// The headline, tagline and grade are editable, and the cropper keeps faces in frame.
// Every pixel and every line here is original work: no studio marks, licensed type or web fetches.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-app.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

if (!existsSync(out)) mkdirSync(out, { recursive: true });

// The editor is plain static files, so publishing it is a pair of directory copies.
cpSync(join(here, 'app'), join(out, 'app'), { recursive: true });
cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The inventory is derived from the copied tree, so it always matches the hand-in.
// Hand-off note: this output tree is disposable; the committed sources are the real deliverable.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, app_max_files: 993, app_max_bytes: 50331648, app_path_max_bytes: 1000 }));

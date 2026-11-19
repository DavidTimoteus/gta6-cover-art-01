/**
 * archive.js
 * ---------------------------------------------------------------------------
 * A curated, side-effect-free library for the offline cover-art studio.
 *
 * It bundles four things the finishing pipeline keeps needing:
 *   1. Poster presets (title / tagline / grade / panel hints).
 *   2. Print export-size definitions for the three supported canvases.
 *   3. A deterministic pseudo-random generator used to seed film grain.
 *   4. A caption wrapper plus a sunset <-> neon palette mixer.
 *
 * Design rules for this file:
 *   - No imports and no I/O: it is safe to use in a browser, a worker, a test
 *     runner, or a Node build script.
 *   - Every exported value is either frozen data or a pure function. Calling
 *     the functions twice with the same arguments gives identical results.
 *   - Nothing here touches the DOM, so importing it can never change what the
 *     editor renders on screen.
 */

// ===========================================================================
// Section 1 - small numeric and colour primitives
// ===========================================================================

/**
 * Restrict a number to the closed interval [min, max].
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  if (min > max) return min;
  return Math.min(max, Math.max(min, n));
}

/**
 * Linear interpolation: returns a when t = 0 and b when t = 1.
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
export function lerp(a, b, t) {
  const amount = clamp(t, 0, 1);
  return a + (b - a) * amount;
}

/**
 * Parse a hex colour into its three byte channels. Accepts #RGB and #RRGGBB.
 * Malformed input resolves to opaque black so callers never get NaN.
 * @param {string} hex
 * @returns {{r: number, g: number, b: number}}
 */
export function hexToRgb(hex) {
  const raw = String(hex ?? '').trim().replace(/^#/, '');
  const expanded = raw.length === 3
    ? raw.split('').map((digit) => digit + digit).join('')
    : raw;

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    return { r: 0, g: 0, b: 0 };
  }

  const packed = parseInt(expanded, 16);
  return {
    r: (packed >> 16) & 0xff,
    g: (packed >> 8) & 0xff,
    b: packed & 0xff,
  };
}

/**
 * Format three byte channels back into an upper-case #RRGGBB string.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string}
 */
export function rgbToHex(r, g, b) {
  const channel = (n) => clamp(Math.round(n), 0, 255)
    .toString(16)
    .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

// ===========================================================================
// Section 2 - export size definitions
// ===========================================================================

/**
 * The three canvas sizes the finishing pipeline can render to.
 * Each record is frozen so downstream code cannot mutate the shared catalog.
 */
export const EXPORT_SIZES = Object.freeze({
  SQUARE: Object.freeze({
    key: 'SQUARE',
    label: 'Square / Social Feed',
    width: 1080,
    height: 1080,
    aspect: '1:1',
    ratio: 1,
    safeMargin: 0.06,
    minDpi: 72,
    note: 'Balanced grid post; keep the grade mark near the lower third.',
  }),
  PORTRAIT: Object.freeze({
    key: 'PORTRAIT',
    label: 'Portrait / Story',
    width: 1080,
    height: 1350,
    aspect: '4:5',
    ratio: 1080 / 1350,
    safeMargin: 0.08,
    minDpi: 72,
    note: 'Taller canvas reserves extra headroom for the caption block.',
  }),
  LANDSCAPE: Object.freeze({
    key: 'LANDSCAPE',
    label: 'Landscape / Wide',
    width: 1920,
    height: 1080,
    aspect: '16:9',
    ratio: 1920 / 1080,
    safeMargin: 0.05,
    minDpi: 96,
    note: 'Wide banner; favour horizontal panel arrangements here.',
  }),
});

/** Stable iteration order for UI dropdowns and export queues. */
export const EXPORT_SIZE_ORDER = Object.freeze([
  'SQUARE',
  'PORTRAIT',
  'LANDSCAPE',
]);

/**
 * Look up an export size by key, falling back to the square canvas.
 * @param {string} key
 * @returns {{key: string, label: string, width: number, height: number}}
 */
export function getExportSize(key) {
  const resolved = EXPORT_SIZES[key] ? key : 'SQUARE';
  return EXPORT_SIZES[resolved];
}

/**
 * Human-readable label for an export-size key, for the editor's toolbar.
 * @param {string} key
 * @returns {string}
 */
export function sizeLabel(key) {
  return getExportSize(key).label;
}

/**
 * Compute the safe drawing rectangle for a given canvas and margin ratio.
 * @param {string} sizeKey
 * @param {number} [marginRatio]
 * @returns {{left: number, top: number, right: number, bottom: number,
 *            width: number, height: number}}
 */
export function safeArea(sizeKey, marginRatio = 0.06) {
  const size = getExportSize(sizeKey);
  const ratio = clamp(marginRatio, 0, 0.4);
  const insetX = Math.round(size.width * ratio);
  const insetY = Math.round(size.height * ratio);
  return {
    left: insetX,
    top: insetY,
    right: size.width - insetX,
    bottom: size.height - insetY,
    width: size.width - insetX * 2,
    height: size.height - insetY * 2,
  };
}

/**
 * Convenience: total pixel count for an export target.
 * @param {string} sizeKey
 * @returns {number}
 */
export function pixelCount(sizeKey) {
  const size = getExportSize(sizeKey);
  return size.width * size.height;
}

// ===========================================================================
// Section 3 - sunset and neon palettes + mixer
// ===========================================================================

/** Warm dusk tones: honey, ember, and deep violet. */
export const SUNSET_PALETTE = Object.freeze({
  sky: '#F6A35C',
  glow: '#F26455',
  mid: '#8E3B6B',
  ink: '#241335',
  accent: '#FFD08A',
});

/** Cool electric tones: cyan, magenta, and electric blue. */
export const NEON_PALETTE = Object.freeze({
  sky: '#25E0D0',
  glow: '#FF2E88',
  mid: '#5A2BD9',
  ink: '#0A0A1F',
  accent: '#B6FF3C',
});

/** Ordered slot names so the mixer always returns the same shape. */
export const PALETTE_SLOTS = Object.freeze([
  'sky',
  'glow',
  'mid',
  'ink',
  'accent',
]);

/**
 * Blend two hex colours in sRGB space. t = 0 returns a, t = 1 returns b.
 * @param {string} a
 * @param {string} b
 * @param {number} t
 * @returns {string} #RRGGBB
 */
export function mixHex(a, b, t) {
  const amount = clamp(t, 0, 1);
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex(
    lerp(ca.r, cb.r, amount),
    lerp(ca.g, cb.g, amount),
    lerp(ca.b, cb.b, amount),
  );
}

/**
 * Mix the whole sunset palette into the neon palette at strength t.
 * @param {number} t - 0 = pure sunset, 1 = pure neon
 * @returns {{sky: string, glow: string, mid: string, ink: string, accent: string}}
 */
export function mixPalette(t) {
  const amount = clamp(t, 0, 1);
  const result = {};
  for (const slot of PALETTE_SLOTS) {
    result[slot] = mixHex(SUNSET_PALETTE[slot], NEON_PALETTE[slot], amount);
  }
  return result;
}

/**
 * Produce a row of palette mixtures from sunset to neon.
 * @param {number} t - overall push toward neon (0..1)
 * @param {number} [steps] - number of swatches (2..16)
 * @returns {Array<{sky: string, glow: string, mid: string,
 *                  ink: string, accent: string}>}
 */
export function paletteSwatches(t, steps = 5) {
  const count = clamp(Math.floor(steps), 2, 16);
  const push = clamp(t, 0, 1);
  const swatches = [];
  for (let i = 0; i < count; i += 1) {
    const local = count === 1 ? push : push * (i / (count - 1));
    swatches.push(mixPalette(local));
  }
  return swatches;
}

/**
 * Resolve a preset's palette mix using its own stored blend weight.
 * @param {{palette?: {sunset: number, neon: number}}} preset
 * @returns {{sky: string, glow: string, mid: string, ink: string, accent: string}}
 */
export function paletteForPreset(preset) {
  const weights = preset && preset.palette ? preset.palette : null;
  if (!weights) return mixPalette(0.5);
  const sunset = Math.max(0, Number(weights.sunset) || 0);
  const neon = Math.max(0, Number(weights.neon) || 0);
  const total = sunset + neon;
  return mixPalette(total === 0 ? 0.5 : neon / total);
}

// ===========================================================================
// Section 4 - deterministic pseudo-random helpers for grain seeds
// ===========================================================================

/**
 * Mulberry32: a compact, fast 32-bit PRNG. Same seed => same stream.
 * @param {number} seed
 * @returns {() => number} function producing floats in [0, 1)
 */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * FNV-style string hash. Useful for turning names into stable integer seeds.
 * @param {...*} parts
 * @returns {number} unsigned 32-bit hash
 */
export function hashSeed(...parts) {
  let hash = 2166136261 >>> 0;
  for (const part of parts) {
    const text = String(part ?? '');
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    hash ^= 0x9e3779b9;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Generate a list of deterministic 32-bit grain seeds.
 * @param {number|string} seed - base seed or name
 * @param {number} count - how many seeds to emit
 * @returns {number[]}
 */
export function grainSeeds(seed, count) {
  const random = mulberry32(hashSeed('grain', seed));
  const total = Math.max(0, Math.floor(count));
  const seeds = new Array(total);
  for (let i = 0; i < total; i += 1) {
    seeds[i] = Math.floor(random() * 4294967296) >>> 0;
  }
  return seeds;
}

/**
 * Build a full deterministic grain field of normalized intensities.
 * @param {number|string} seed
 * @param {number} width
 * @param {number} height
 * @returns {Float32Array} length = width * height, values in [0, 1)
 */
export function grainField(seed, width, height) {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  const random = mulberry32(hashSeed('field', seed, w, h));
  const field = new Float32Array(w * h);
  for (let i = 0; i < field.length; i += 1) {
    field[i] = random();
  }
  return field;
}

// ===========================================================================
// Section 5 - caption formatter
// ===========================================================================

/**
 * Wrap a tagline into at most two short lines. Long single words are split,
 * and any text that does not fit is trimmed with a trailing ellipsis.
 * @param {string} tagline
 * @param {{maxWidth?: number, maxLines?: number}} [options]
 * @returns {string[]} one or two lines
 */
export function wrapTagline(tagline, options = {}) {
  const width = Math.max(6, Math.floor(options.maxWidth ?? 22));
  const limit = clamp(Math.floor(options.maxLines ?? 2), 1, 2);
  const words = String(tagline ?? '').trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) return [''];

  const lines = [];
  let current = '';

  for (const word of words) {
    if (lines.length >= limit) break;
    const candidate = current ? `${current} ${word}` : word;

    if (candidate.length <= width) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      current = '';
      if (lines.length >= limit) break;
    }

    if (word.length > width) {
      lines.push(word.slice(0, width));
      current = word.slice(width);
    } else {
      current = word;
    }
  }

  if (current && lines.length < limit) {
    lines.push(current);
  }

  if (lines.length === limit) {
    const used = lines.reduce((sum, line) => sum + line.length, 0);
    const total = words.join('').length;
    const last = lines.length - 1;
    if (used < total || lines[last].length > width) {
      let trimmed = lines[last];
      if (trimmed.length > width - 1) {
        trimmed = trimmed.slice(0, width - 1);
      }
      lines[last] = `${trimmed.trimEnd()}…`;
    }
  }

  return lines;
}

/**
 * Compose a ready-to-print caption from a preset, using its title + tagline.
 * @param {{title: string, tagline: string}} preset
 * @param {{maxWidth?: number, withTitle?: boolean}} [options]
 * @returns {string} newline-joined caption (at most two lines)
 */
export function formatCaption(preset, options = {}) {
  if (!preset) return '';
  const lines = wrapTagline(preset.tagline, options);
  if (options.withTitle) {
    lines[0] = `${preset.title} — ${lines[0]}`;
  }
  return lines.join('\n');
}

// ===========================================================================
// Section 6 - curated poster presets
// ===========================================================================

/**
 * Each preset carries a display title, a punchy tagline, a grade name, and a
 * small panel-arrangement hint the studio can use when laying out frames.
 */
export const POSTER_PRESETS = Object.freeze([
  Object.freeze({
    id: 'midnight-drive',
    title: 'Midnight Drive',
    tagline: 'Chase the horizon where the streetlights end.',
    grade: 'Neon Noir',
    panels: Object.freeze({
      arrangement: 'triptych',
      columns: 3,
      rows: 1,
      heroPanel: 0,
      hint: 'Wide hero frame left; two narrow frames stacked right.',
    }),
    seed: 10427,
    palette: Object.freeze({ sunset: 35, neon: 65 }),
  }),
  Object.freeze({
    id: 'last-sunrise',
    title: 'Last Sunrise',
    tagline: 'Every ending borrows the colour of a beginning.',
    grade: 'Ember Fade',
    panels: Object.freeze({
      arrangement: 'split-diagonal',
      columns: 2,
      rows: 2,
      heroPanel: 1,
      hint: 'Cut the canvas corner-to-corner; place the mark on the warm half.',
    }),
    seed: 21871,
    palette: Object.freeze({ sunset: 80, neon: 20 }),
  }),
  Object.freeze({
    id: 'static-bloom',
    title: 'Static Bloom',
    tagline: 'Signals flower in the noise between stations.',
    grade: 'Magenta Haze',
    panels: Object.freeze({
      arrangement: 'grid-2x2',
      columns: 2,
      rows: 2,
      heroPanel: 3,
      hint: 'Four equal tiles; let the lower-right tile bleed past its edge.',
    }),
    seed: 30265,
    palette: Object.freeze({ sunset: 25, neon: 75 }),
  }),
  Object.freeze({
    id: 'dust-and-diesel',
    title: 'Dust & Diesel',
    tagline: 'The road remembers every engine that crossed it.',
    grade: 'Amber Grit',
    panels: Object.freeze({
      arrangement: 'letterbox',
      columns: 1,
      rows: 3,
      heroPanel: 1,
      hint: 'Cinematic bands; the centre band holds the hero image.',
    }),
    seed: 41988,
    palette: Object.freeze({ sunset: 70, neon: 30 }),
  }),
  Object.freeze({
    id: 'glass-city',
    title: 'Glass City',
    tagline: 'A thousand windows, one restless skyline.',
    grade: 'Cyan Steel',
    panels: Object.freeze({
      arrangement: 'mosaic',
      columns: 4,
      rows: 3,
      heroPanel: 5,
      hint: 'Uneven mosaic; vary tile widths by one third for rhythm.',
    }),
    seed: 51203,
    palette: Object.freeze({ sunset: 15, neon: 85 }),
  }),
  Object.freeze({
    id: 'velvet-hour',
    title: 'Velvet Hour',
    tagline: 'The city softens just before it goes electric.',
    grade: 'Violet Dusk',
    panels: Object.freeze({
      arrangement: 'hero-plus-strip',
      columns: 3,
      rows: 2,
      heroPanel: 0,
      hint: 'One dominant frame with a thin caption strip along the base.',
    }),
    seed: 63740,
    palette: Object.freeze({ sunset: 55, neon: 45 }),
  }),
  Object.freeze({
    id: 'afterimage',
    title: 'Afterimage',
    tagline: 'Look away; the light stays a little longer.',
    grade: 'Acid Bloom',
    panels: Object.freeze({
      arrangement: 'offset-stack',
      columns: 2,
      rows: 2,
      heroPanel: 2,
      hint: 'Stack two offset frames with a soft ghost copy behind each.',
    }),
    seed: 78156,
    palette: Object.freeze({ sunset: 30, neon: 70 }),
  }),
  Object.freeze({
    id: 'northbound',
    title: 'Northbound',
    tagline: 'Cold air, warm headlights, open distance.',
    grade: 'Frost Neon',
    panels: Object.freeze({
      arrangement: 'panorama',
      columns: 1,
      rows: 2,
      heroPanel: 0,
      hint: 'One sweeping panorama above a slim text band.',
    }),
    seed: 89314,
    palette: Object.freeze({ sunset: 45, neon: 55 }),
  }),
]);

/** Fast lookup index built once from the frozen preset list. */
const PRESET_INDEX = Object.freeze(
  POSTER_PRESETS.reduce((index, preset) => {
    index[preset.id] = preset;
    return index;
  }, Object.create(null)),
);

/**
 * Find a preset by its id.
 * @param {string} id
 * @returns {object|undefined}
 */
export function getPreset(id) {
  return PRESET_INDEX[id];
}

/** @returns {string[]} all preset ids in catalog order. */
export function listPresetIds() {
  return POSTER_PRESETS.map((preset) => preset.id);
}

/** @returns {string[]} all preset titles in catalog order. */
export function listPresetTitles() {
  return POSTER_PRESETS.map((preset) => preset.title);
}

/**
 * Filter presets whose grade name contains a case-insensitive fragment.
 * @param {string} fragment
 * @returns {object[]}
 */
export function presetsByGrade(fragment) {
  const needle = String(fragment ?? '').toLowerCase();
  return POSTER_PRESETS.filter((preset) =>
    preset.grade.toLowerCase().includes(needle));
}

/**
 * Recommend an export size based on a preset's arrangement hint.
 * Wide arrangements prefer the landscape canvas; everything else portrait.
 * @param {{panels?: {columns?: number, rows?: number}}} preset
 * @returns {string} an EXPORT_SIZES key
 */
export function recommendExportSize(preset) {
  const panels = preset && preset.panels ? preset.panels : {};
  const columns = Number(panels.columns) || 1;
  const rows = Number(panels.rows) || 1;
  return columns > rows ? 'LANDSCAPE' : 'PORTRAIT';
}

/**
 * Assemble a complete, deterministic render recipe for a preset + canvas.
 * @param {string} presetId
 * @param {string} sizeKey
 * @returns {{preset: object, size: object, area: object, palette: object,
 *            caption: string, grain: number[]}}
 */
export function buildRecipe(presetId, sizeKey) {
  const preset = getPreset(presetId) || POSTER_PRESETS[0];
  const size = getExportSize(sizeKey);
  return {
    preset,
    size,
    area: safeArea(size.key, size.safeMargin),
    palette: paletteForPreset(preset),
    caption: formatCaption(preset, { maxWidth: 22, withTitle: false }),
    grain: grainSeeds(preset.seed, 8),
  };
}

// archive.js
// An offline archive of poster design data and tiny pure helpers for the
// cover-art studio. Nothing in this file reads or writes the DOM, the
// network, or the filesystem. Importing it has no side effects at all.
//
// The module is split into five small sections:
//   1. Curated poster presets (editorial skeletons, not finished art).
//   2. Export size definitions for the three supported canvases.
//   3. A deterministic pseudo-random helper for repeatable grain seeds.
//   4. A caption formatter that wraps a tagline to at most two short lines.
//   5. A palette mixer that blends the sunset and neon colour families.

// ---------------------------------------------------------------------------
// Section 1 — Poster presets
// ---------------------------------------------------------------------------

/**
 * Each preset describes the "skeleton" of a cover: a working title, a short
 * tagline, the name of a colour grade, and a set of panel arrangement hints.
 * It is deliberately not a pixel-perfect template. The studio uses these
 * values to seed a layout and the artist paints over the result.
 *
 * Panel hint fields:
 *   - hint   : the editorial role of the panel (hero, skyline, badge, ...)
 *   - weight : relative size, where 1 is small and 3 is dominant
 *   - align  : the canvas edge the panel gravitates toward
 *
 * All copy below is original writing and is intended as a creative nudge,
 * not as a transcription of any existing design kit.
 */
export const POSTER_PRESETS = [
  {
    id: 'amber-run',
    title: 'AMBER RUN',
    tagline: 'The highway remembers every name it takes.',
    grade: 'Amber Dusk',
    panels: [
      { hint: 'hero', weight: 3, align: 'left' },
      { hint: 'skyline', weight: 2, align: 'right' },
      { hint: 'badge', weight: 1, align: 'right' },
    ],
  },
  {
    id: 'neon-tide',
    title: 'NEON TIDE',
    tagline: 'The city glows long after the rain stops.',
    grade: 'Cyan Static',
    panels: [
      { hint: 'hero', weight: 3, align: 'center' },
      { hint: 'reflection', weight: 2, align: 'bottom' },
      { hint: 'badge', weight: 1, align: 'left' },
    ],
  },
  {
    id: 'last-light',
    title: 'LAST LIGHT',
    tagline: 'We had one hour and a sky full of signals.',
    grade: 'Ember Fade',
    panels: [
      { hint: 'horizon', weight: 3, align: 'top' },
      { hint: 'hero', weight: 2, align: 'left' },
      { hint: 'badge', weight: 1, align: 'right' },
    ],
  },
  {
    id: 'velvet-static',
    title: 'VELVET STATIC',
    tagline: 'Every channel is a door left slightly open.',
    grade: 'Magenta Bloom',
    panels: [
      { hint: 'grid', weight: 2, align: 'center' },
      { hint: 'hero', weight: 3, align: 'right' },
      { hint: 'badge', weight: 1, align: 'left' },
    ],
  },
  {
    id: 'dust-and-chrome',
    title: 'DUST & CHROME',
    tagline: 'Rust ages honestly. So do we.',
    grade: 'Oxide Warm',
    panels: [
      { hint: 'hero', weight: 3, align: 'left' },
      { hint: 'texture', weight: 2, align: 'bottom' },
      { hint: 'badge', weight: 1, align: 'right' },
    ],
  },
  {
    id: 'midnight-exchange',
    title: 'MIDNIGHT EXCHANGE',
    tagline: 'Nothing honest happens before the clocks reset.',
    grade: 'Indigo Hum',
    panels: [
      { hint: 'skyline', weight: 3, align: 'top' },
      { hint: 'hero', weight: 2, align: 'center' },
      { hint: 'badge', weight: 1, align: 'bottom' },
    ],
  },
  {
    id: 'paper-sun',
    title: 'PAPER SUN',
    tagline: 'A small warmth against a very large dark.',
    grade: 'Soft Solar',
    panels: [
      { hint: 'hero', weight: 3, align: 'center' },
      { hint: 'halo', weight: 2, align: 'top' },
      { hint: 'badge', weight: 1, align: 'left' },
    ],
  },
  {
    id: 'signal-lost',
    title: 'SIGNAL LOST',
    tagline: 'Somewhere between the tower and the truth.',
    grade: 'Green Noise',
    panels: [
      { hint: 'grid', weight: 2, align: 'bottom' },
      { hint: 'hero', weight: 3, align: 'right' },
      { hint: 'badge', weight: 1, align: 'left' },
    ],
  },
  {
    id: 'afterimage',
    title: 'AFTERIMAGE',
    tagline: 'Look away. The colour stays a little longer.',
    grade: 'Rose Ghost',
    panels: [
      { hint: 'echo', weight: 2, align: 'left' },
      { hint: 'hero', weight: 3, align: 'center' },
      { hint: 'badge', weight: 1, align: 'right' },
    ],
  },
  {
    id: 'low-orbit',
    title: 'LOW ORBIT',
    tagline: 'Close enough to see the seams in the world.',
    grade: 'Steel Blue',
    panels: [
      { hint: 'horizon', weight: 3, align: 'bottom' },
      { hint: 'hero', weight: 2, align: 'left' },
      { hint: 'badge', weight: 1, align: 'top' },
    ],
  },
  {
    id: 'quiet-frequency',
    title: 'QUIET FREQUENCY',
    tagline: 'Turn the volume down and listen harder.',
    grade: 'Mono Violet',
    panels: [
      { hint: 'wave', weight: 2, align: 'center' },
      { hint: 'hero', weight: 3, align: 'right' },
      { hint: 'badge', weight: 1, align: 'left' },
    ],
  },
  {
    id: 'gold-hour-again',
    title: 'GOLD HOUR, AGAIN',
    tagline: 'We keep meeting the same light in new places.',
    grade: 'Honey Haze',
    panels: [
      { hint: 'halo', weight: 3, align: 'top' },
      { hint: 'hero', weight: 2, align: 'center' },
      { hint: 'badge', weight: 1, align: 'right' },
    ],
  },
];

/** A lookup map so callers can resolve a preset by its stable id. */
export const PRESET_BY_ID = Object.freeze(
  POSTER_PRESETS.reduce((acc, preset) => {
    acc[preset.id] = preset;
    return acc;
  }, Object.create(null)),
);

/** Pick a preset deterministically from a seed (see the RNG section). */
export function presetFromSeed(seed) {
  const next = createGrainRng(seed);
  const index = Math.floor(next() * POSTER_PRESETS.length);
  return POSTER_PRESETS[index % POSTER_PRESETS.length];
}

// ---------------------------------------------------------------------------
// Section 2 — Export sizes
// ---------------------------------------------------------------------------

/**
 * The three canvas sizes the offline editor can export. Width and height
 * are stored as numbers so callers can feed them straight to a canvas or
 * an image encoder without parsing strings.
 */
export const EXPORT_SIZES = Object.freeze([
  { id: 'square', label: 'Square', width: 1080, height: 1080, ratio: '1:1' },
  { id: 'portrait', label: 'Portrait', width: 1080, height: 1350, ratio: '4:5' },
  { id: 'landscape', label: 'Landscape', width: 1920, height: 1080, ratio: '16:9' },
]);

/** Return one size definition by id, or null when the id is unknown. */
export function findExportSize(id) {
  for (const size of EXPORT_SIZES) {
    if (size.id === id) return size;
  }
  return null;
}

/** A plain "WIDTHxHEIGHT" label used in file names and export menus. */
export function sizeLabel(size) {
  if (!size) return '';
  return `${size.width}x${size.height}`;
}

// ---------------------------------------------------------------------------
// Section 3 — Deterministic pseudo-random grain helper
// ---------------------------------------------------------------------------

/**
 * Create a tiny deterministic random-number generator. The same seed always
 * yields the same sequence, which keeps film-grain overlays reproducible
 * between the preview and the final export. Returns a function that gives a
 * floating point value in the half-open range [0, 1).
 */
export function createGrainRng(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fold an arbitrary string into a 32-bit seed using a simple FNV-style loop.
 * Handy for deriving a stable grain seed from a preset id or a title.
 */
export function grainSeedFrom(text) {
  let hash = 2166136261 >>> 0;
  if (typeof text !== 'string') return hash;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Produce `count` deterministic integer grain seeds from one master seed.
 * The values are spread across the full unsigned 32-bit range.
 */
export function grainSeeds(seed, count) {
  const next = createGrainRng(seed);
  const seeds = [];
  const safeCount = Math.max(0, Math.floor(count) || 0);
  for (let i = 0; i < safeCount; i += 1) {
    seeds.push(Math.floor(next() * 0x100000000) >>> 0);
  }
  return seeds;
}

// ---------------------------------------------------------------------------
// Section 4 — Caption formatter
// ---------------------------------------------------------------------------

/** Trim a single word down to `limit` characters with a trailing ellipsis. */
function clipWord(word, limit) {
  if (word.length <= limit) return word;
  if (limit <= 1) return '.';
  return `${word.slice(0, limit - 1)}…`;
}

/** Append a word to a line, clipping once the limit would be exceeded. */
function appendWord(line, word, limit) {
  if (!word) return line;
  const candidate = line ? `${line} ${word}` : word;
  if (candidate.length <= limit) return candidate;
  const room = Math.max(0, limit - line.length - 1);
  if (room <= 0) return line;
  return `${line} ${word.slice(0, room)}…`;
}

/**
 * Wrap a tagline into at most TWO short lines. Each line is capped at
 * `maxChars` characters. Words that do not fit on the second line are cut
 * off with an ellipsis rather than spilling into a third line. The return
 * value is always a two-element array so callers can index it safely.
 */
export function formatCaption(tagline, maxChars = 24) {
  if (typeof tagline !== 'string' || tagline.trim() === '') {
    return ['', ''];
  }
  const limit = Math.max(6, Math.floor(maxChars) || 24);
  const words = tagline.trim().split(/\s+/);
  const lines = ['', ''];
  let lineIndex = 0;

  for (const word of words) {
    const candidate = lines[lineIndex]
      ? `${lines[lineIndex]} ${word}`
      : word;

    if (candidate.length <= limit) {
      lines[lineIndex] = candidate;
      continue;
    }

    if (lineIndex === 0) {
      lineIndex = 1;
      lines[1] = clipWord(word, limit);
      continue;
    }

    lines[1] = appendWord(lines[1], word, limit);
    break;
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Section 5 — Palette mixer
// ---------------------------------------------------------------------------

/** The warm "sunset" family, ordered from bright highlight to deep shadow. */
export const SUNSET_PALETTE = Object.freeze({
  name: 'Sunset',
  colors: Object.freeze(['#ff9a3c', '#ff5e5b', '#c2368b', '#2b1055']),
});

/** The cool "neon" family, ordered to line up with the sunset stops. */
export const NEON_PALETTE = Object.freeze({
  name: 'Neon',
  colors: Object.freeze(['#00f5d4', '#00bbf9', '#f15bb5', '#fee440']),
});

/** Parse "#RRGGBB" into an {r, g, b} object. Invalid input yields black. */
export function hexToRgb(hex) {
  if (typeof hex !== 'string') return { r: 0, g: 0, b: 0 };
  const clean = hex.replace(/^#/, '');
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** Turn an {r, g, b} object back into a normalised "#RRGGBB" string. */
export function rgbToHex({ r, g, b }) {
  const byte = (value) => Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/** Linearly blend two hex colours; amount 0 returns `a`, 1 returns `b`. */
export function mixColor(a, b, amount) {
  const t = Math.max(0, Math.min(1, amount));
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  });
}

/**
 * Blend the whole sunset palette toward the neon palette. `amount` is
 * clamped to [0, 1]; colours are paired by their index so the warm-to-cool
 * progression is preserved. The returned array is always a fresh copy.
 */
export function mixPalette(amount) {
  const t = Math.max(0, Math.min(1, amount));
  const stops = Math.min(SUNSET_PALETTE.colors.length, NEON_PALETTE.colors.length);
  const result = [];
  for (let i = 0; i < stops; i += 1) {
    result.push(mixColor(SUNSET_PALETTE.colors[i], NEON_PALETTE.colors[i], t));
  }
  return result;
}

/** Convenience wrapper that returns a named blended palette object. */
export function blendedPalette(amount, name = 'Sunset / Neon') {
  return { name, colors: mixPalette(amount) };
}

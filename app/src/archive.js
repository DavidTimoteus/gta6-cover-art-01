/*
 * Cover archive.
 *
 * A small, self-contained catalogue of poster presets, size definitions and
 * text/layout helpers.  It is intentionally data-heavy and deterministic: the
 * grain seed for a given key never changes, so re-exporting a cover reproduces
 * the same speckle pattern exactly.
 */

import { mixColors, toHex, PALETTE, getGrade } from './palette.js';

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/* ------------------------------------------------------------------ *
 * poster preset metadata
 * ------------------------------------------------------------------ */

export const POSTER_PRESETS = Object.freeze({
  'copper-halo': Object.freeze({
    id: 'copper-halo',
    title: 'COPPER HALO',
    tagline: 'EVERY EMPIRE HAS A PRICE',
    badge: 'LK-01',
    grade: 'sunset',
    layout: 'five-panel',
    edition: 'first printing',
    year: 2026,
    note: 'Warm duo plate with a cyan accent and heavy corner registration.'
  }),
  'night-drive': Object.freeze({
    id: 'night-drive',
    title: 'NIGHT DRIVE',
    tagline: 'THE CITY ONLY SLEEPS AT DAWN',
    badge: 'LK-02',
    grade: 'rain',
    layout: 'five-panel',
    edition: 'second printing',
    year: 2026,
    note: 'Cool three-ink build with a soft cyan halo over the skyline.'
  }),
  'false-gold': Object.freeze({
    id: 'false-gold',
    title: 'FALSE GOLD',
    tagline: 'NOTHING SHINES FOREVER',
    badge: 'LK-03',
    grade: 'ink',
    layout: 'five-panel',
    edition: 'artist proof',
    year: 2026,
    note: 'Monochrome ink with amber pop and a very fine screen.'
  }),
  'low-tide': Object.freeze({
    id: 'low-tide',
    title: 'LOW TIDE',
    tagline: 'THE HARBOUR KEEPS ITS SECRETS',
    badge: 'LK-04',
    grade: 'rain',
    layout: 'five-panel',
    edition: 'harbour series',
    year: 2025,
    note: 'Green-leaning duotone built for a broad newsprint dot.'
  })
});

export function presetIds() {
  return Object.keys(POSTER_PRESETS);
}

export function getPosterPreset(id = 'copper-halo') {
  return POSTER_PRESETS[id] || POSTER_PRESETS['copper-halo'];
}

/** Turn preset metadata into a config skeleton without any image data. */
export function presetToConfig(id = 'copper-halo', width = 1080, height = 1350) {
  const preset = getPosterPreset(id);
  return {
    width: Math.max(1, Math.round(finite(width, 1080))),
    height: Math.max(1, Math.round(finite(height, 1350))),
    grade: getGrade(preset.grade),
    title: preset.title,
    tagline: preset.tagline,
    badge: preset.badge,
    layout: preset.layout,
    panels: []
  };
}

/* ------------------------------------------------------------------ *
 * export-size definitions
 * ------------------------------------------------------------------ */

export const EXPORT_SIZES = Object.freeze({
  square: Object.freeze({ id: 'square', label: 'Square', width: 1080, height: 1080, slug: 'sq' }),
  portrait: Object.freeze({ id: 'portrait', label: 'Portrait', width: 1080, height: 1350, slug: 'pt' }),
  wide: Object.freeze({ id: 'wide', label: 'Wide', width: 1920, height: 1080, slug: 'wd' })
});

export function exportSizeIds() {
  return Object.keys(EXPORT_SIZES);
}

export function getExportSize(id = 'portrait') {
  return EXPORT_SIZES[id] || EXPORT_SIZES.portrait;
}

export function aspectRatio(sizeOrId) {
  const size = typeof sizeOrId === 'string' ? getExportSize(sizeOrId) : sizeOrId;
  return finite(size.width, 1) / Math.max(1, finite(size.height, 1));
}

/** Filename helper that never includes a path separator or network token. */
export function exportFilename(presetId, sizeId, extension = 'png') {
  const preset = getPosterPreset(presetId);
  const size = getExportSize(sizeId);
  const safe = String(preset.id).replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const ext = String(extension).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
  return `${safe}-${size.slug}-${size.width}x${size.height}.${ext}`;
}

/* ------------------------------------------------------------------ *
 * deterministic grain seed
 * ------------------------------------------------------------------ */

/** FNV-1a style string hash, returned as a positive 32-bit integer. */
export function seedFromString(text = '') {
  let hash = 2166136261;
  const value = String(text);
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}

/**
 * Combine a logical key with a target size into one stable seed.  Exporting
 * the same poster at the same size twice yields identical grain.
 */
export function grainSeed(key = 'copper-halo', width = 0, height = 0) {
  const first = seedFromString(key);
  const mixed = Math.imul(first ^ (finite(width, 0) >>> 0), 2246822519);
  const final = Math.imul(mixed ^ (finite(height, 0) >>> 0), 3266489917);
  return ((final >>> 0) || first);
}

/** Normalised 0..1 jitter derived from a seed, for deterministic placement. */
export function seededUnit(key, index = 0) {
  const seed = grainSeed(key, index, 1);
  return (seed % 100000) / 100000;
}

/* ------------------------------------------------------------------ *
 * tagline wrapping
 * ------------------------------------------------------------------ */

/**
 * Greedy word wrap that also breaks over-long single words.  The result is a
 * list of headline-ready lines, never wider than `maxChars`.
 */
export function wrapTagline(text, maxChars = 18) {
  const limit = clamp(Math.round(finite(maxChars, 18)), 6, 120);
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [''];

  const lines = [];
  let current = '';

  const flush = () => {
    if (current) lines.push(current);
    current = '';
  };

  const pushWord = (word) => {
    if (word.length <= limit) {
      if (!current) current = word;
      else if (current.length + 1 + word.length <= limit) current += ' ' + word;
      else { flush(); current = word; }
      return;
    }
    // Split a word that cannot fit on any single line.
    flush();
    for (let i = 0; i < word.length; i += limit) {
      const piece = word.slice(i, i + limit);
      if (piece.length === limit) lines.push(piece);
      else current = piece;
    }
  };

  words.forEach(pushWord);
  flush();
  return lines.length ? lines : [''];
}

/** Join wrapped lines back together with an en-dash, for captions. */
export function taglineCaption(text, maxChars = 18) {
  return wrapTagline(text, maxChars).join(' — ');
}

/* ------------------------------------------------------------------ *
 * palette mixing
 * ------------------------------------------------------------------ */

/** Mix an ordered palette into a single ink using trailing weights. */
export function mixPalette(colors = [], weights = []) {
  const list = colors.filter(Boolean);
  if (!list.length) return PALETTE.plum;
  let result = list[0];
  for (let i = 1; i < list.length; i += 1) {
    const ratio = clamp(finite(weights[i - 1], 1 / list.length), 0, 1);
    result = toHex(mixColors(result, list[i], ratio));
  }
  return result;
}

/** Blend two registered palette names from PALETTE. */
export function palettePair(first = 'plum', second = 'cream', t = 0.5) {
  const a = PALETTE[first] || PALETTE.plum;
  const b = PALETTE[second] || PALETTE.cream;
  return toHex(mixColors(a, b, clamp(finite(t, 0.5), 0, 1)));
}

/** Return a five-step palette ramp derived from a grade's inks. */
export function archivePalette(gradeOrId = 'sunset', steps = 5) {
  const grade = typeof gradeOrId === 'string' ? getGrade(gradeOrId) : gradeOrId;
  const inks = grade.ink.length ? grade.ink : [PALETTE.plum];
  const total = clamp(Math.round(finite(steps, 5)), 2, 12);
  const ramp = [];
  for (let i = 0; i < total; i += 1) {
    const position = (i / (total - 1)) * (inks.length - 1);
    const index = Math.min(inks.length - 2, Math.floor(position));
    ramp.push(toHex(mixColors(inks[index], inks[index + 1], position - index)));
  }
  return ramp;
}

/** Stamp a short archive identifier used in the footer of exported proofs. */
export function archiveStamp(presetId = 'copper-halo', sizeId = 'portrait') {
  const preset = getPosterPreset(presetId);
  const size = getExportSize(sizeId);
  const seed = grainSeed(preset.id, size.width, size.height);
  return `${preset.badge}/${size.slug.toUpperCase()}/${String(seed).slice(-5)}`;
}

export default {
  POSTER_PRESETS,
  EXPORT_SIZES,
  getPosterPreset,
  presetToConfig,
  getExportSize,
  grainSeed,
  wrapTagline,
  mixPalette,
  archivePalette,
  archiveStamp
};

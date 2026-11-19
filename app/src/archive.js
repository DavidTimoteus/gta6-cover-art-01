/* ============================================================================
 * archive.js
 * Static metadata and small deterministic helpers for the cover archive.
 *
 * This module holds no rendering state.  It stores poster presets, export
 * size definitions, and pure utilities for seeds, captions and palettes so
 * both the editor and any offline tooling can share the same catalogue.
 * ==========================================================================*/

import { PALETTES, getPalette, mixColors } from './palette.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

/* --------------------------------------------------------- poster presets */
/**
 * Each preset is a frozen recipe.  The panel keys mirror the ids in layouts.js
 * so an archive entry can be replayed into the editor without translation.
 */
export const POSTER_PRESETS = Object.freeze({
  copperHalo: Object.freeze({
    id: 'copperHalo',
    name: 'Copper Halo',
    title: 'COPPER HALO',
    tagline: 'EVERY EMPIRE HAS A PRICE',
    badge: 'LK-01',
    grade: 'sunset',
    duo: Object.freeze({ a: 'boulevard', b: 'pier' }),
    panels: Object.freeze({
      upper: 'boulevard', center: 'duo',
      lowerLeft: 'pier', lowerRight: 'boulevard', side: 'pier',
    }),
    note: 'Warm two-plate duo with a coral halo and fine cream screen.',
  }),
  midnightRun: Object.freeze({
    id: 'midnightRun',
    name: 'Midnight Run',
    title: 'MIDNIGHT RUN',
    tagline: 'NO ROAD GOES BOTH WAYS',
    badge: 'LK-02',
    grade: 'rain',
    duo: Object.freeze({ a: 'pier', b: 'boulevard' }),
    panels: Object.freeze({
      upper: 'pier', center: 'duo',
      lowerLeft: 'boulevard', lowerRight: 'pier', side: 'boulevard',
    }),
    note: 'Cool cyan cast, coarse rain-grade grain, offset colour plates.',
  }),
  paperEmpire: Object.freeze({
    id: 'paperEmpire',
    name: 'Paper Empire',
    title: 'PAPER EMPIRE',
    tagline: 'BUILT ON BORROWED TIME',
    badge: 'LK-03',
    grade: 'ink',
    duo: Object.freeze({ a: 'boulevard', b: 'pier' }),
    panels: Object.freeze({
      upper: 'boulevard', center: 'duo',
      lowerLeft: 'boulevard', lowerRight: 'pier', side: 'pier',
    }),
    note: 'Neutral high-contrast ink, four flat levels, heavy misregistration.',
  }),
});

export const POSTER_PRESET_IDS = Object.freeze(Object.keys(POSTER_PRESETS));

/** Look up a poster preset, falling back to the primary recipe. */
export function getPosterPreset(id) {
  if (!id) return POSTER_PRESETS.copperHalo;
  return POSTER_PRESETS[id] || POSTER_PRESETS[String(id).toLowerCase()] || POSTER_PRESETS.copperHalo;
}

/** Turn a preset into the option shape the renderer expects. */
export function presetToRenderOptions(id, width, height) {
  const preset = getPosterPreset(id);
  return {
    width,
    height,
    title: preset.title,
    tagline: preset.tagline,
    badge: preset.badge,
    grade: preset.grade,
    palette: getPalette(preset.grade),
    duo: Object.assign({}, preset.duo),
  };
}

/* ------------------------------------------------------------ export sizes */
/** Export definitions used by the toolbar and by offline batch jobs. */
export const EXPORT_SIZES = Object.freeze({
  square: Object.freeze({
    key: 'square', width: 1080, height: 1080, label: '1080 × 1080', use: 'social square',
  }),
  portrait: Object.freeze({
    key: 'portrait', width: 1080, height: 1350, label: '1080 × 1350', use: 'portrait feed',
  }),
  wide: Object.freeze({
    key: 'wide', width: 1920, height: 1080, label: '1920 × 1080', use: 'desktop wallpaper',
  }),
  printA3: Object.freeze({
    key: 'printA3', width: 2480, height: 3508, label: '2480 × 3508', use: 'A3 at 300 dpi',
  }),
});

export const EXPORT_SIZE_KEYS = Object.freeze(Object.keys(EXPORT_SIZES));

/** Resolve an export definition by key, with square as a safe default. */
export function getExportSize(key) {
  return EXPORT_SIZES[key] || EXPORT_SIZES.square;
}

/** Format a width/height pair as a human label. */
export function formatDimensions(width, height) {
  return `${Math.round(width)} × ${Math.round(height)}`;
}

/** Estimate an uncompressed RGBA buffer size in mebibytes. */
export function estimateBufferBytes(width, height) {
  return Math.round(width * height * 4);
}

/** Estimate a PNG's size very roughly from its pixel count (for UI hints). */
export function estimatePngBytes(width, height) {
  return Math.round(width * height * 0.42);
}

/* -------------------------------------------------------------- grain seed */
/**
 * Deterministic FNV-1a style hash.  The same string always produces the same
 * unsigned 32-bit seed, which keeps grain patterns stable between exports.
 */
export function grainSeed(key) {
  const text = String(key == null ? 'halo' : key);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Combine a base seed with an index to get a distinct per-panel seed. */
export function panelSeed(baseKey, index) {
  return (grainSeed(baseKey) + Math.imul(Math.max(0, index) + 1, 2654435761)) >>> 0;
}

/* ----------------------------------------------------------- tagline wrap */
/**
 * Wrap a tagline into lines no longer than `maxChars`, preferring word
 * boundaries.  A single over-long word is split at the character limit.
 */
export function wrapTagline(text, options) {
  const opts = typeof options === 'number' ? { maxChars: options } : (options || {});
  const maxChars = Math.max(6, Math.round(opts.maxChars || 18));
  const maxLines = Math.max(1, Math.round(opts.maxLines || 3));
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars) {
      line = candidate;
      return;
    }
    if (line) lines.push(line);
    if (word.length > maxChars) {
      let rest = word;
      while (rest.length > maxChars) {
        lines.push(rest.slice(0, maxChars));
        rest = rest.slice(maxChars);
      }
      line = rest;
    } else {
      line = word;
    }
  });
  if (line) lines.push(line);

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] = last.length > maxChars - 1
      ? `${last.slice(0, maxChars - 1)}…`
      : `${last}…`;
    return kept;
  }
  return lines.length ? lines : [''];
}

/** Join wrapped lines back into a caption with a separator. */
export function formatTagline(text, options) {
  return wrapTagline(text, options).join(options && options.separator ? options.separator : ' / ');
}

/* ------------------------------------------------------------ palette mixer */
/**
 * Blend two grades into a new palette object.  Names or palette objects are
 * both accepted; t = 0 returns a, t = 1 returns b.
 */
export function mixPalette(a, b, t) {
  const left = typeof a === 'string' ? getPalette(a) : (a || PALETTES.sunset);
  const right = typeof b === 'string' ? getPalette(b) : (b || PALETTES.sunset);
  const keys = ['plum', 'magenta', 'coral', 'amber', 'cream', 'cyan'];
  const mix = { name: `${left.name || 'a'}+${right.name || 'b'}` };
  keys.forEach((key) => {
    mix[key] = mixColors(left[key], right[key], t);
  });
  return Object.freeze(mix);
}

/** Produce a sequence of blended palettes between two grades. */
export function paletteInterpolation(a, b, steps) {
  const count = Math.max(2, Math.round(steps || 5));
  const result = [];
  for (let i = 0; i < count; i += 1) {
    result.push(mixPalette(a, b, i / (count - 1)));
  }
  return result;
}

/** Pick a grade by index from the known palette names. */
export function paletteByIndex(index) {
  const names = Object.keys(PALETTES);
  const i = ((Math.round(index) % names.length) + names.length) % names.length;
  return getPalette(names[i]);
}

/** Clamp helper re-exported for archive consumers. */
export function clampUnit(value) {
  return clamp(value, 0, 1);
}

/** Count the panels declared by a preset. */
export function presetPanelCount(id) {
  return Object.keys(getPosterPreset(id).panels || {}).length;
}

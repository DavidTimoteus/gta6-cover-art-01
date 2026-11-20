/*
 * archive.js — static metadata and deterministic utilities for the poster
 * archive. Nothing here touches the network or the DOM: presets, export
 * targets, a string hash for reproducible grain, a tagline wrapper and a
 * palette mixer. Keeping these values in one place means a preset can be
 * recreated identically months later from its id alone.
 */

import { PALETTE, mixColors, GRADES_BY_ID } from './palette.js';

export const ARCHIVE_VERSION = '1.4.0';

/** The three supported print targets. Keys match the export buttons in the UI. */
export const EXPORT_SIZES = Object.freeze({
  square: Object.freeze({ id: 'square', w: 1080, h: 1080, label: 'SQUARE', ratio: '1:1' }),
  portrait: Object.freeze({ id: 'portrait', w: 1080, h: 1350, label: 'PORTRAIT', ratio: '4:5' }),
  wide: Object.freeze({ id: 'wide', w: 1920, h: 1080, label: 'WIDE', ratio: '16:9' }),
});

/** Array form for menus and iterators. */
export const EXPORT_LIST = Object.freeze(Object.values(EXPORT_SIZES));

/** Order used when batching exports from a single preset. */
export const EXPORT_ORDER = Object.freeze(['square', 'portrait', 'wide']);

/** Fictional billing copy — deliberately invented, no real names or studios. */
export const CREDITS = Object.freeze([
  'LEONIDA PICTURES PRESENTS  A COPPER HALO PRODUCTION  “ONE LAST SUMMER”',
  'DIRECTED BY A. MARQUEZ  PRODUCED BY R. VALE  WRITTEN BY L. OKONKWO',
  'DIRECTOR OF PHOTOGRAPHY S. RUIZ  EDITED BY N. FOSTER  MUSIC BY T. ADEYEMI',
  'PRODUCTION DESIGN BY M. BISHOP  COSTUME BY J. PARK  ART DIRECTION BY D. HALL',
  'ALL CHARACTERS AND EVENTS ARE FICTIONAL  © LEONIDA KEY ART LAB  VOL. 06',
]);

/** The fixed press quote used on every cover. */
export const PRESS_QUOTE = Object.freeze({
  stars: 5,
  line: '“Pure sun-bleached cinema.”',
  source: 'LEONIDA TRIBUNE',
});

/** Small set of archived cover recipes. Each is fully deterministic. */
export const POSTER_PRESETS = Object.freeze({
  copperHalo: Object.freeze({
    id: 'copperHalo',
    name: 'Copper Halo',
    title: 'COPPER HALO',
    subtitle: 'one last summer',
    tagline: 'EVERY EMPIRE HAS A PRICE.',
    chip: 'VOL. 06',
    gradeId: 'sunset',
    seed: 'copper-halo-master',
    accent: PALETTE.cyan,
    spot: PALETTE.coral,
    roles: [
      'THE CITY / NIGHT RUN',
      'THE GETAWAY / MARINA HEAT',
      'THE DRIVER / OCEAN DRIVE · 6:42 PM',
      'THE SCORE / VELVET HARBOR',
      'THE ESCAPE / NEON MILE',
    ],
  }),
  marinaHeat: Object.freeze({
    id: 'marinaHeat',
    name: 'Marina Heat',
    title: 'MARINA HEAT',
    subtitle: 'the tide remembers',
    tagline: 'THE WATER KEEPS ITS OWN SECRETS.',
    chip: 'VOL. 03',
    gradeId: 'ember',
    seed: 'marina-heat-plate',
    accent: PALETTE.amber,
    spot: PALETTE.coral,
    roles: [
      'THE DOCKS / LOW TIDE',
      'THE BOAT / HURRICANE GIRL',
      'THE PILOT / MARINA HEAT',
      'THE CARGO / COLD STEEL',
      'THE EXIT / HARBOR LIGHTS',
    ],
  }),
  neonMile: Object.freeze({
    id: 'neonMile',
    name: 'Neon Mile',
    title: 'NEON MILE',
    subtitle: 'after the rain',
    tagline: 'NOBODY SLEEPS ON THIS STREET.',
    chip: 'VOL. 09',
    gradeId: 'rain',
    seed: 'neon-mile-night',
    accent: PALETTE.cyan,
    spot: PALETTE.magenta,
    roles: [
      'THE SIGNAL / ROOFTOP',
      'THE RUNNER / ALLEY NINE',
      'THE COURIER / NEON MILE',
      'THE DEAL / UNDERPASS',
      'THE GETAWAY / WET ASPHALT',
    ],
  }),
  velvetDusk: Object.freeze({
    id: 'velvetDusk',
    name: 'Velvet Dusk',
    title: 'VELVET DUSK',
    subtitle: 'one more night',
    tagline: 'EVERY LIGHT HAS A PRICE.',
    chip: 'VOL. 12',
    gradeId: 'dusk',
    seed: 'velvet-dusk-final',
    accent: PALETTE.coral,
    spot: PALETTE.magenta,
    roles: [
      'THE CITY / LAST LIGHT',
      'THE LOVER / ROSE DISTRICT',
      'THE DRIVER / VELVET DUSK',
      'THE DEBT / BACK ROOM',
      'THE DAWN / OUT OF RANGE',
    ],
  }),
  inkDistrict: Object.freeze({
    id: 'inkDistrict',
    name: 'Ink District',
    title: 'INK DISTRICT',
    subtitle: 'black and blue',
    tagline: 'THE CITY WRITES IT DOWN.',
    chip: 'VOL. 15',
    gradeId: 'ink',
    seed: 'ink-district-proof',
    accent: PALETTE.cyan,
    spot: PALETTE.cream,
    roles: [
      'THE WIRE / NORTH TOWER',
      'THE WITNESS / GRAND HALL',
      'THE EDITOR / INK DISTRICT',
      'THE PRINT / MIDNIGHT PRESS',
      'THE TRAIL / EMPTY STREETS',
    ],
  }),
});

export const PRESET_IDS = Object.freeze(Object.keys(POSTER_PRESETS));

/** Look up a preset by id, falling back to the flagship cover. */
export function getPreset(id) {
  return POSTER_PRESETS[id] || POSTER_PRESETS.copperHalo;
}

/** Presets as an array, handy for building a picker. */
export function listPresets() {
  return PRESET_IDS.map((id) => POSTER_PRESETS[id]);
}

/** Resolve an export key to a { w, h } pair with a safe fallback. */
export function resolveExport(key) {
  const size = EXPORT_SIZES[key] || EXPORT_SIZES.wide;
  return { w: size.w, h: size.h, id: size.id, label: size.label };
}

/*
 * xmur3-style string hash. The same string always yields the same 32-bit
 * seed, which keeps grain patterns and barcode bars stable across reloads.
 */
export function makeSeed(str) {
  const text = String(str == null ? '' : str);
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Mulberry32 PRNG driven by a numeric (or string) seed. */
export function seededRandom(seed) {
  let s = (typeof seed === 'string' ? makeSeed(seed) : Number(seed)) >>> 0;
  if (!s) s = 0x9e3779b9;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic grain seed for a preset in a given export size. */
export function grainSeed(presetOrId, sizeKey) {
  const preset = typeof presetOrId === 'string' ? getPreset(presetOrId) : (presetOrId || getPreset('copperHalo'));
  return makeSeed(`${preset.seed}|${sizeKey || 'wide'}|${ARCHIVE_VERSION}`);
}

/**
 * Wrap tagline copy into balanced lines no longer than `max` characters.
 * Long single words are kept whole so nothing is silently truncated.
 */
export function wrapTagline(text, max = 30) {
  const limit = Math.max(6, Math.round(max));
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let current = '';
  words.forEach((word) => {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= limit) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  });
  if (current) lines.push(current);
  return lines;
}

/** Balance already-wrapped lines so the band looks typeset, not ragged. */
export function balanceLines(lines) {
  if (!lines || lines.length < 2) return lines || [''];
  const sorted = [...lines].sort((a, b) => a.length - b.length);
  const longest = sorted[sorted.length - 1];
  return lines.map((line) => {
    const pad = Math.max(0, longest.length - line.length);
    return ' '.repeat(Math.floor(pad / 2)) + line;
  });
}

/** Mix two palette-like objects key by key; missing keys come from `a`. */
export function mixPalette(a = PALETTE, b = PALETTE, t = 0.5) {
  const out = {};
  Object.keys(a).forEach((key) => {
    const other = b[key] != null ? b[key] : a[key];
    out[key] = key === 'accent' || key === 'cyan' ? mixColors(a[key], other, t) : mixColors(a[key], other, t);
  });
  return out;
}

/** Build a small tint ramp from a palette key for gradients and stripes. */
export function paletteRamp(key = 'coral', palette = PALETTE, steps = 5) {
  const n = Math.max(2, Math.round(steps));
  const base = palette[key] || palette.coral;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const k = i / (n - 1);
    out.push(k < 0.5
      ? mixColors(palette.plum, base, k * 2)
      : mixColors(base, palette.cream, (k - 0.5) * 2));
  }
  return out;
}

/** Resolve the grade definition referenced by a preset. */
export function presetGrade(presetOrId) {
  const preset = typeof presetOrId === 'string' ? getPreset(presetOrId) : (presetOrId || getPreset('copperHalo'));
  return GRADES_BY_ID[preset.gradeId] || null;
}

/** A compact index record used by the archive viewer. */
export function archiveRecord(id) {
  const preset = getPreset(id);
  return {
    id: preset.id,
    name: preset.name,
    title: preset.title,
    chip: preset.chip,
    gradeId: preset.gradeId,
    seed: preset.seed,
    sizes: EXPORT_ORDER.slice(),
  };
}

/** Build the full archive index in a stable order. */
export function buildArchiveIndex() {
  return PRESET_IDS.map((id) => archiveRecord(id));
}

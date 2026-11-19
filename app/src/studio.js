/* ============================================================================
 * studio.js
 * Print-finishing toolkit: presets, screening controls, contrast ramps and a
 * batch runner.  This module is a layer above effects.js — it never draws to
 * a canvas and never reads the DOM.  Everything here works on ImageData-like
 * buffers { width, height, data } and returns fresh buffers.
 * ==========================================================================*/

import {
  posterize,
  halftone,
  channelOffset,
  paperGrain,
  finishImageData,
} from './effects.js';
import { parseColor, mixColors, rgbToHex, hexToRgb } from './palette.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

/* --------------------------------------------------------------- settings */
const DEFAULT_SETTINGS = Object.freeze({
  angle: 18,
  pitch: 5,
  levels: 5,
  registration: 1.5,
  grain: 0.055,
  seed: 0x2f6e2b1,
  paper: Object.freeze([255, 226, 154]),
});

/**
 * Named production presets.  Each preset is a partial settings object merged
 * over the defaults by normalizeSettings().
 */
export const PRINT_PRESETS = Object.freeze({
  newsprint: Object.freeze({
    label: 'Newsprint',
    angle: 32, pitch: 7, levels: 3, registration: 2.1, grain: 0.085,
  }),
  risograph: Object.freeze({
    label: 'Risograph',
    angle: 22, pitch: 6, levels: 4, registration: 2.6, grain: 0.07,
  }),
  glossy: Object.freeze({
    label: 'Glossy',
    angle: 15, pitch: 3, levels: 6, registration: 0.8, grain: 0.028,
  }),
  silkscreen: Object.freeze({
    label: 'Silkscreen',
    angle: 45, pitch: 5, levels: 4, registration: 1.2, grain: 0.04,
  }),
  duotone: Object.freeze({
    label: 'Duotone',
    angle: 12, pitch: 4, levels: 5, registration: 1.8, grain: 0.06,
  }),
});

export const PRINT_PRESET_NAMES = Object.freeze(Object.keys(PRINT_PRESETS));

/** Resolve a preset name (or preset object) into a partial settings object. */
export function getPrintPreset(name) {
  if (!name) return {};
  if (typeof name === 'string') {
    return PRINT_PRESETS[name] || PRINT_PRESETS[name.toLowerCase()] || {};
  }
  return name;
}

/** Merge defaults, a preset and user overrides into a normalized settings copy. */
export function normalizeSettings(settings) {
  const input = settings || {};
  const preset = getPrintPreset(input.preset);
  const merged = Object.assign({}, DEFAULT_SETTINGS, preset, input);
  const paper = merged.paper && merged.paper.length
    ? merged.paper
    : DEFAULT_SETTINGS.paper;
  return {
    preset: input.preset || null,
    angle: ((Number(merged.angle) % 180) + 180) % 180,
    pitch: clamp(merged.pitch, 2, 24),
    levels: Math.round(clamp(merged.levels, 2, 12)),
    registration: clamp(merged.registration, 0, 6),
    grain: clamp(merged.grain, 0, 0.4),
    seed: Number(merged.seed) >>> 0,
    paper: [clamp(paper[0], 0, 255), clamp(paper[1], 0, 255), clamp(paper[2], 0, 255)],
    palette: merged.palette || null,
  };
}

/** Update just the screen angle, keeping the rest of the settings intact. */
export function withAngle(settings, angle) {
  return normalizeSettings(Object.assign({}, settings, { angle }));
}

/** Update just the dot pitch, keeping the rest of the settings intact. */
export function withPitch(settings, pitch) {
  return normalizeSettings(Object.assign({}, settings, { pitch }));
}

/** Alter registration offset while leaving screening untouched. */
export function withRegistration(settings, registration) {
  return normalizeSettings(Object.assign({}, settings, { registration }));
}

/* --------------------------------------------------------- contrast ramp */
/**
 * Build a contrast ramp between two inks.  When gamma is omitted the stops
 * are evenly spaced; gamma > 1 biases toward the dark end.
 */
export function buildContrastRamp(darkInk, lightInk, stops, gamma) {
  const count = Math.max(2, Math.round(stops || 6));
  const g = Number(gamma) > 0 ? Number(gamma) : 1;
  const ramp = [];
  for (let i = 0; i < count; i += 1) {
    const linear = i / (count - 1);
    const eased = Math.pow(linear, g);
    ramp.push({
      t: Number(linear.toFixed(4)),
      color: mixColors(darkInk, lightInk, eased),
    });
  }
  return ramp;
}

/** Build a ramp straight from a palette object's named inks. */
export function paletteRamp(palette, keys, stops) {
  const order = Array.isArray(keys) && keys.length
    ? keys
    : ['plum', 'magenta', 'coral', 'amber', 'cream'];
  const anchors = order.map((key) => palette && palette[key]).filter(Boolean);
  if (anchors.length < 2) return buildContrastRamp('#1B1035', '#FFE29A', stops);

  const wanted = Math.max(2, Math.round(stops || anchors.length));
  const result = [];
  for (let i = 0; i < wanted; i += 1) {
    const position = (i / (wanted - 1)) * (anchors.length - 1);
    const low = Math.floor(position);
    const high = Math.min(anchors.length - 1, low + 1);
    const t = position - low;
    result.push({
      t: Number((i / (wanted - 1)).toFixed(4)),
      color: mixColors(anchors[low], anchors[high], t),
    });
  }
  return result;
}

/** Adjust the gamma of a buffer without disturbing alpha. */
export function applyContrastCurve(source, gamma) {
  const out = {
    width: source.width,
    height: source.height,
    data: new Uint8ClampedArray(source.data.length),
  };
  const g = Number(gamma) > 0 ? Number(gamma) : 1;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i += 1) {
    lut[i] = Math.round(255 * Math.pow(i / 255, g));
  }
  for (let i = 0; i < source.data.length; i += 4) {
    out.data[i] = lut[source.data[i]];
    out.data[i + 1] = lut[source.data[i + 1]];
    out.data[i + 2] = lut[source.data[i + 2]];
    out.data[i + 3] = source.data[i + 3];
  }
  return out;
}

/* --------------------------------------------------------- finishing steps */
/**
 * Apply a single named stage to a buffer.  Used by runStages() for callers
 * that want explicit control over the finishing order.
 */
export function applyStage(name, source, settings) {
  const s = normalizeSettings(settings);
  switch (name) {
    case 'posterize':
      return posterize(source, {
        levels: s.levels,
        colors: s.palette
          ? [s.palette.plum, s.palette.magenta, s.palette.coral, s.palette.amber, s.palette.cream]
          : null,
      });
    case 'halftone':
      return halftone(source, { pitch: s.pitch, angle: s.angle, paper: s.paper });
    case 'register':
      return channelOffset(source, {
        redShift: s.registration,
        blueShift: -s.registration,
        greenShift: 0,
      });
    case 'grain':
      return paperGrain(source, s.seed, s.grain);
    default:
      return source;
  }
}

/** Default stage order, matching finishImageData(). */
export const DEFAULT_STAGES = Object.freeze([
  'posterize', 'halftone', 'register', 'grain',
]);

/** Run an explicit list of stages over one buffer. */
export function runStages(source, stages, settings) {
  const list = Array.isArray(stages) && stages.length ? stages : DEFAULT_STAGES;
  let current = source;
  list.forEach((name) => {
    current = applyStage(name, current, settings);
  });
  return current;
}

/**
 * Finish one buffer with a preset + overrides.  This is the high-level entry
 * most callers need; finishOne() preserves the source buffer.
 */
export function finishOne(source, settings) {
  const s = normalizeSettings(settings);
  return finishImageData(source, {
    palette: s.palette,
    levels: s.levels,
    pitch: s.pitch,
    angle: s.angle,
    grain: s.grain,
    seed: s.seed,
    registration: s.registration,
    paper: s.paper,
  });
}

/**
 * Apply finishing to several ImageData buffers.  Returns a new array in the
 * same order; mismatched sizes are handled independently.  A per-buffer
 * settings override may be supplied as the third argument.
 */
export function finishBatch(buffers, settings, overrides) {
  const list = Array.isArray(buffers) ? buffers : [];
  return list.map((buffer, index) => {
    if (!buffer || !buffer.data) return buffer;
    const extra = Array.isArray(overrides) && overrides[index] ? overrides[index] : {};
    return finishOne(buffer, Object.assign({}, settings, extra));
  });
}

/* -------------------------------------------------------------- diagnostics */
/**
 * Estimate the mean luminance of a buffer.  Useful for auto-selecting a
 * screen pitch: dark plates can tolerate a coarser dot than bright ones.
 */
export function meanLuminance(source) {
  if (!source || !source.data || !source.data.length) return 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < source.data.length; i += 16) {
    const alpha = source.data[i + 3];
    if (alpha === 0) continue;
    sum += (source.data[i] + source.data[i + 1] + source.data[i + 2]) / (3 * 255);
    count += 1;
  }
  return count ? sum / count : 0;
}

/** Suggest a pitch from a plate's brightness: brighter plate = finer dots. */
export function suggestPitch(source) {
  const lum = meanLuminance(source);
  return Math.round(clamp(8 - lum * 6, 2, 9));
}

/**
 * Describe a settings object as a compact, stable string.  Deterministic so
 * it can be used as a cache key for finished buffers.
 */
export function describeSettings(settings) {
  const s = normalizeSettings(settings);
  return [
    s.preset || 'custom',
    `a${s.angle}`,
    `p${s.pitch}`,
    `l${s.levels}`,
    `r${s.registration.toFixed(1)}`,
    `g${s.grain.toFixed(3)}`,
    `s${s.seed}`,
  ].join('-');
}

/** Convert a paper colour to the RGB triple the halftone filter expects. */
export function paperFromColor(color) {
  const c = parseColor(color);
  return [c.r, c.g, c.b];
}

/** Build a two-ink split-tone recipe (shadow ink + highlight ink). */
export function splitToneRecipe(shadow, highlight, settings) {
  const s = normalizeSettings(settings);
  return Object.assign({}, s, {
    paper: (() => {
      const c = hexToRgb(highlight);
      return [c.r, c.g, c.b];
    })(),
    shadowInk: shadow,
    highlightInk: highlight,
  });
}

/** Preview hex of the centre of a ramp, handy for swatch UI. */
export function rampMidpoint(darkInk, lightInk) {
  const mixed = parseColor(mixColors(darkInk, lightInk, 0.5));
  return rgbToHex(mixed.r, mixed.g, mixed.b);
}

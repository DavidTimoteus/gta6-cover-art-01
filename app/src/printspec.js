/*
 * printspec.js
 * A normalized, validated description of a poster and the small bits of
 * geometry that connect a detected face to a panel and a title to its band.
 *
 * A spec is plain data: it can be serialized to a saved job, checked before a
 * render, and passed to the geometry helpers without any canvas present.
 */

import { PANELS, SIZE_PRESETS, computeTitleBand, panelToCanvasRect } from './layouts.js';

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, lo, hi) {
  const n = numberOr(value, lo);
  return n < lo ? lo : (n > hi ? hi : n);
}

/** Version tag so older saved jobs can be migrated later. */
export const SPEC_VERSION = 1;

/**
 * The canonical normalized spec.  All geometry is in 0..1 unit space; only
 * the `canvas` block holds device pixels.
 */
export const DEFAULT_SPEC = Object.freeze({
  version: SPEC_VERSION,
  canvas: Object.freeze({ w: 1080, h: 1080, preset: 'square' }),
  page: Object.freeze({ margin: 0.035, gutter: 0.012, bleed: 0.012 }),
  panels: PANELS,
  grade: 'sunset',
  typography: Object.freeze({
    title: 'COPPER HALO',
    tagline: 'EVERY EMPIRE HAS A PRICE',
    badge: 'LK-01',
    titleScale: 0.66,
    taglineScale: 0.16,
    condense: 0.84,
  }),
  crop: Object.freeze({ targetX: 0.5, targetY: 0.58, minZoom: 1.05, maxZoom: 2.9 }),
  finish: Object.freeze({
    halftoneAngleDeg: 45,
    dotPitch: 5.2,
    posterizeLevels: 5,
    grainAmount: 0.05,
    offsetX: 1.2,
    offsetY: -0.7,
    seed: 20261119,
  }),
});

/** Shallow copy helper for plain objects. */
function copy(value) {
  if (Array.isArray(value)) return value.slice();
  if (value && typeof value === 'object') return { ...value };
  return value;
}

/** Merge a partial spec over DEFAULT_SPEC, section by section. */
export function normalizeSpec(partial) {
  const input = partial || {};
  const preset = SIZE_PRESETS[input.size || (input.canvas && input.canvas.preset)] || SIZE_PRESETS.square;
  const canvas = { ...copy(DEFAULT_SPEC.canvas), ...copy(input.canvas) };
  if (!numberOr(canvas.w, 0)) canvas.w = preset.w;
  if (!numberOr(canvas.h, 0)) canvas.h = preset.h;
  canvas.preset = input.size || canvas.preset || 'square';

  return {
    version: numberOr(input.version, SPEC_VERSION),
    canvas,
    page: { ...copy(DEFAULT_SPEC.page), ...copy(input.page) },
    panels: Array.isArray(input.panels) && input.panels.length ? input.panels.map(copy) : PANELS.map(copy),
    grade: input.grade || DEFAULT_SPEC.grade,
    typography: { ...copy(DEFAULT_SPEC.typography), ...copy(input.typography) },
    crop: { ...copy(DEFAULT_SPEC.crop), ...copy(input.crop) },
    finish: { ...copy(DEFAULT_SPEC.finish), ...copy(input.finish) },
  };
}

/**
 * Validate a spec.  Returns { valid, errors } so callers can show every
 * problem at once instead of throwing on the first one.
 */
export function validateSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object') {
    return { valid: false, errors: ['spec must be an object'] };
  }
  if (numberOr(spec.version, 0) !== SPEC_VERSION) {
    errors.push(`version must be ${SPEC_VERSION}`);
  }
  const c = spec.canvas || {};
  if (!(numberOr(c.w, 0) >= 64 && numberOr(c.w, 0) <= 8192)) errors.push('canvas.w out of range');
  if (!(numberOr(c.h, 0) >= 64 && numberOr(c.h, 0) <= 8192)) errors.push('canvas.h out of range');
  if (spec.grade && !['sunset', 'rain', 'ink'].includes(spec.grade)) errors.push('unknown grade');

  if (!Array.isArray(spec.panels) || spec.panels.length !== 5) {
    errors.push('exactly five panels are required');
  } else {
    spec.panels.forEach((panel, index) => {
      if (!panel || typeof panel !== 'object') {
        errors.push(`panel ${index} is not an object`);
        return;
      }
      ['x', 'y', 'w', 'h'].forEach((key) => {
        const v = numberOr(panel[key], NaN);
        if (!Number.isFinite(v) || v < 0 || v > 1) errors.push(`panel ${index}.${key} must be 0..1`);
      });
      if (numberOr(panel.x, 0) + numberOr(panel.w, 0) > 1.001) errors.push(`panel ${index} exceeds right edge`);
      if (numberOr(panel.y, 0) + numberOr(panel.h, 0) > 1.001) errors.push(`panel ${index} exceeds bottom edge`);
    });
    if (!spec.panels.some((p) => p && p.id === 2 && p.duo)) {
      errors.push('panel id 2 must be the duo hero');
    }
  }

  const crop = spec.crop || {};
  if (numberOr(crop.targetX, -1) < 0 || numberOr(crop.targetX, -1) > 1) errors.push('crop.targetX must be 0..1');
  if (numberOr(crop.targetY, -1) < 0 || numberOr(crop.targetY, -1) > 1) errors.push('crop.targetY must be 0..1');

  return { valid: errors.length === 0, errors };
}

/**
 * Map a normalized face region onto a panel rectangle.
 *
 * The face is centre-fit into the panel while preserving its aspect ratio,
 * then nudged so its centre lands near the crop target (below the badge).
 * The result is a normalized source region in 0..1 image space.
 */
export function faceRegionToPanelRect(faceRegion, panelRect, options) {
  const opts = options || {};
  const face = faceRegion || { x: 0.38, y: 0.3, w: 0.24, h: 0.4 };
  const panel = panelRect || { x: 0, y: 0, w: 1, h: 1 };
  const fx = clamp(face.x + numberOr(face.w, 0.2) / 2, 0, 1);
  const fy = clamp(face.y + numberOr(face.h, 0.2) / 2, 0, 1);

  const panelAspect = numberOr(panel.w, 1) / Math.max(0.0001, numberOr(panel.h, 1));
  const faceAspect = numberOr(face.w, 0.2) / Math.max(0.0001, numberOr(face.h, 0.2));

  let w = clamp(numberOr(face.w, 0.2) * numberOr(opts.padding, 1.35), 0.02, 1);
  let h = clamp(numberOr(face.h, 0.2) * numberOr(opts.padding, 1.35), 0.02, 1);
  if (faceAspect > panelAspect) h = w / Math.max(0.0001, faceAspect);
  else w = h * faceAspect;

  const targetX = clamp(numberOr(opts.targetX, 0.5), 0.15, 0.85);
  const targetY = clamp(Math.max(numberOr(opts.targetY, 0.58), 0.5), 0.3, 0.9);
  const cx = clamp(fx + (0.5 - targetX) * w, w / 2, 1 - w / 2);
  const cy = clamp(fy + (0.5 - targetY) * h, h / 2, 1 - h / 2);

  return {
    x: cx - w / 2,
    y: cy - h / 2,
    w,
    h,
    focus: { x: fx, y: fy },
    panelAspect,
    target: { x: targetX, y: targetY },
  };
}

/** Resolve the title band for a spec into device pixels. */
export function specTitleBand(spec) {
  const s = spec || DEFAULT_SPEC;
  return computeTitleBand(numberOr(s.canvas && s.canvas.w, 1080), numberOr(s.canvas && s.canvas.h, 1080), s.panels);
}

/**
 * Title placement math: given a band and a title, return the baseline and a
 * font size that will fit the condensed headline inside the safe area.
 */
export function titlePlacement(spec, measuredWidth) {
  const s = spec || DEFAULT_SPEC;
  const band = specTitleBand(s);
  const type = s.typography || DEFAULT_SPEC.typography;
  const inset = numberOr(band.safeInset, 0) * 0.4;
  const x = numberOr(band.x, 0) + inset;
  const maxWidth = Math.max(1, numberOr(band.w, 100) - inset * 2);
  const bandH = Math.max(1, numberOr(band.h, 100));
  let fontSize = bandH * clamp(numberOr(type.titleScale, 0.66), 0.3, 0.9);

  const measured = Math.max(1, numberOr(measuredWidth, 0));
  if (measured > 0) {
    const condense = clamp(numberOr(type.condense, 0.84), 0.4, 1);
    const needed = fontSize * (maxWidth / (measured * condense));
    fontSize = Math.min(fontSize, needed);
  }

  return {
    x,
    y: numberOr(band.y, 0),
    w: maxWidth,
    h: bandH,
    fontSize,
    baseline: numberOr(band.y, 0) + bandH * 0.72,
    ruleY: numberOr(band.y, 0) + bandH * 0.86,
    taglineY: numberOr(band.y, 0) + bandH * 0.92,
    taglineSize: clamp(bandH * numberOr(type.taglineScale, 0.16), 10, 46),
  };
}

/** Pixel rects for all panels of a spec, handy for hit-testing and proofs. */
export function specPanelRects(spec) {
  const s = spec || DEFAULT_SPEC;
  const w = numberOr(s.canvas && s.canvas.w, 1080);
  const h = numberOr(s.canvas && s.canvas.h, 1080);
  return (s.panels || PANELS).map((panel) => panelToCanvasRect(panel, w, h));
}

/** Convenience constructor for a spec targeting one of the export sizes. */
export function specForSize(sizeKey, overrides) {
  const preset = SIZE_PRESETS[sizeKey] || SIZE_PRESETS.square;
  return normalizeSpec({
    canvas: { w: preset.w, h: preset.h, preset: sizeKey },
    size: sizeKey,
    ...(overrides || {}),
  });
}

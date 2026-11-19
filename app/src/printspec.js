/* ============================================================================
 * printspec.js
 * A normalized poster specification and the maths that supports it.
 *
 * Coordinates in a spec are always 0..1 relative to the canvas.  This makes a
 * spec portable across the square, portrait and wide formats.  The validator
 * checks structural correctness, and the mapping helpers translate detected
 * face regions / title boxes into concrete panel rectangles.
 * ==========================================================================*/

import { PANEL_IDS, COVER_SIZES } from './layouts.js';
import { getPalette, PALETTES } from './palette.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

/* -------------------------------------------------------------- normalized */
/**
 * Build the canonical normalized spec.  All geometry is in unit space; the
 * title band deliberately sits above y = 0.18 to stay clear of the panels.
 */
export function createPosterSpec(overrides) {
  const extra = overrides || {};
  const spec = {
    version: 1,
    id: extra.id || 'copper-halo',
    size: extra.size || 'square',
    title: extra.title || 'COPPER HALO',
    tagline: extra.tagline || 'EVERY EMPIRE HAS A PRICE',
    badge: extra.badge || 'LK-01',
    grade: extra.grade || 'sunset',
    background: extra.background || { from: 'plum', to: 'magenta' },
    safeFrame: { x: 0.018, y: 0.018, w: 0.964, h: 0.964 },
    titleBand: { x: 0.035, y: 0.030, w: 0.930, h: 0.145 },
    taglineBand: { x: 0.035, y: 0.952, w: 0.930, h: 0.036 },
    panels: {},
    screens: { angle: 18, pitch: 5, levels: 5 },
    registration: { red: 1.5, green: 0, blue: -1.5 },
  };

  const panelLayout = {
    upper: { x: 0.035, y: 0.195, w: 0.775, h: 0.145 },
    center: { x: 0.035, y: 0.350, w: 0.775, h: 0.420 },
    lowerLeft: { x: 0.035, y: 0.785, w: 0.375, h: 0.160 },
    lowerRight: { x: 0.435, y: 0.785, w: 0.375, h: 0.160 },
    side: { x: 0.835, y: 0.195, w: 0.130, h: 0.750 },
  };

  PANEL_IDS.forEach((id) => {
    const base = panelLayout[id] || { x: 0, y: 0, w: 0.2, h: 0.2 };
    spec.panels[id] = Object.assign({ id, duo: id === 'center' }, base);
  });

  if (extra.panels) {
    Object.keys(extra.panels).forEach((id) => {
      if (spec.panels[id]) {
        spec.panels[id] = Object.assign({}, spec.panels[id], extra.panels[id]);
      }
    });
  }
  if (extra.screens) Object.assign(spec.screens, extra.screens);
  if (extra.registration) Object.assign(spec.registration, extra.registration);
  return spec;
}

/* ---------------------------------------------------------------- validator */
function isUnit(value) {
  return typeof value === 'number' && isFinite(value) && value >= -0.001 && value <= 1.001;
}

function isRect(rect) {
  return Boolean(rect)
    && isUnit(rect.x) && isUnit(rect.y)
    && isUnit(rect.w) && isUnit(rect.h)
    && rect.w > 0 && rect.h > 0
    && rect.x + rect.w <= 1.001
    && rect.y + rect.h <= 1.001;
}

/**
 * Validate a spec and return { valid, errors, warnings }.
 * Nothing here throws; callers can surface the messages directly in a UI.
 */
export function validatePosterSpec(spec) {
  const errors = [];
  const warnings = [];

  if (!spec || typeof spec !== 'object') {
    return { valid: false, errors: ['spec is not an object'], warnings };
  }
  if (spec.version !== 1) errors.push('spec version must be 1');
  if (!spec.title || typeof spec.title !== 'string') errors.push('title must be a non-empty string');
  if (spec.title && spec.title.length > 24) warnings.push('title exceeds 24 characters');
  if (spec.tagline && spec.tagline.length > 40) warnings.push('tagline exceeds 40 characters');
  if (!PALETTES[spec.grade]) errors.push(`unknown grade: ${spec.grade}`);
  if (!COVER_SIZES[spec.size]) errors.push(`unknown size: ${spec.size}`);

  if (!isRect(spec.safeFrame)) errors.push('safeFrame is not a valid unit rect');
  if (!isRect(spec.titleBand)) errors.push('titleBand is not a valid unit rect');
  if (!isRect(spec.taglineBand)) errors.push('taglineBand is not a valid unit rect');

  if (!spec.panels || typeof spec.panels !== 'object') {
    errors.push('panels must be an object');
  } else {
    PANEL_IDS.forEach((id) => {
      if (!spec.panels[id]) {
        errors.push(`missing panel: ${id}`);
      } else if (!isRect(spec.panels[id])) {
        errors.push(`panel ${id} is not a valid unit rect`);
      }
    });
  }

  if (spec.screens) {
    if (!isFinite(spec.screens.angle)) errors.push('screen angle must be numeric');
    const pitch = Number(spec.screens.pitch);
    if (!isFinite(pitch) || pitch < 2 || pitch > 24) errors.push('screen pitch must be between 2 and 24');
    const levels = Number(spec.screens.levels);
    if (!isFinite(levels) || levels < 2 || levels > 12) errors.push('ink levels must be between 2 and 12');
  } else {
    errors.push('screens settings missing');
  }

  if (spec.titleBand && spec.panels && spec.panels.upper) {
    if (spec.titleBand.y + spec.titleBand.h > spec.panels.upper.y + 0.01) {
      warnings.push('title band overlaps the upper panel');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Assert-style validator: throws with the first error, else returns the spec. */
export function requireValidSpec(spec) {
  const result = validatePosterSpec(spec);
  if (!result.valid) throw new Error(result.errors[0]);
  return spec;
}

/* --------------------------------------------------------- face -> panel */
/** Convert a unit rect to pixel space. */
export function unitRectToPixels(rect, width, height) {
  return {
    x: rect.x * width,
    y: rect.y * height,
    w: rect.w * width,
    h: rect.h * height,
  };
}

/**
 * Map a detected face region (unit coords from smartcrop) into a panel rect.
 * The result positions a face-sized box at `focusY` of the panel and returns
 * the pan offsets needed to land it there.
 */
export function faceRegionToPanel(faceRegion, panel, focusY) {
  const region = faceRegion || { x: 0.5, y: 0.42, w: 0.18, h: 0.24 };
  const targetY = clamp(focusY == null ? 0.34 : focusY, 0.08, 0.9);
  const faceCx = clamp(region.x + (region.w || 0) / 2, 0, 1);
  const faceCy = clamp(region.y + (region.h || 0) / 2, 0, 1);

  const boxW = Math.max(0.01, clamp(region.w || 0.18, 0.01, 1));
  const boxH = Math.max(0.01, clamp(region.h || 0.24, 0.01, 1));

  return {
    x: panel.x + faceCx * panel.w - boxW * panel.w / 2,
    y: panel.y + targetY * panel.h - boxH * panel.h / 2,
    w: boxW * panel.w,
    h: boxH * panel.h,
    panX: clamp((faceCx - 0.5) * 2, -1, 1),
    panY: clamp((faceCy - targetY) * 2, -1, 1),
  };
}

/** Reflow a face box so it stays fully inside the panel bounds. */
export function keepFaceInPanel(faceBox, panel, margin) {
  const pad = Math.max(0, margin || 0) * Math.min(panel.w, panel.h);
  let { x, y } = faceBox;
  if (x < panel.x + pad) x = panel.x + pad;
  if (y < panel.y + pad) y = panel.y + pad;
  if (x + faceBox.w > panel.x + panel.w - pad) x = panel.x + panel.w - pad - faceBox.w;
  if (y + faceBox.h > panel.y + panel.h - pad) y = panel.y + panel.h - pad - faceBox.h;
  return Object.assign({}, faceBox, { x, y });
}

/* -------------------------------------------------------------- title math */
/**
 * Compute a centered title box for a given text length and band.
 * `aspect` is the average glyph width ratio used for the condensed face.
 */
export function computeTitlePlacement(text, band, options) {
  const opts = options || {};
  const label = String(text || '');
  const aspect = Number(opts.aspect) > 0 ? Number(opts.aspect) : 0.52;
  const tracking = Number(opts.tracking) > 0 ? Number(opts.tracking) : 0.02;
  const units = Math.max(1, label.length) * (aspect + tracking);

  const heightByWidth = band.w / units;
  const heightByBand = band.h * 0.9;
  const fontSize = Math.min(heightByWidth, heightByBand);
  const textWidth = units * fontSize;

  return {
    fontSize,
    textWidth,
    x: band.x + (band.w - textWidth) / 2,
    y: band.y + (band.h - fontSize * 0.72) / 2,
    baseline: band.y + band.h * 0.78,
    centerX: band.x + band.w / 2,
  };
}

/** Scale a title font down until it fits the band width. */
export function fitTitleSize(text, band, maxSize, minSize) {
  const placement = computeTitlePlacement(text, band);
  const floor = Math.max(8, minSize || 8);
  return Math.max(floor, Math.min(placement.fontSize, maxSize || Infinity));
}

/** Compute a tagline box given a number of wrapped lines. */
export function computeTaglinePlacement(band, lines) {
  const count = Math.max(1, lines || 1);
  return {
    x: band.x,
    y: band.y,
    w: band.w,
    h: band.h,
    lineHeight: band.h / count,
    centerX: band.x + band.w / 2,
    centerY: band.y + band.h / 2,
  };
}

/* -------------------------------------------------------------- spec utils */
/** Materialize every panel of a spec into pixels for the given canvas. */
export function specToPixelPanels(spec, width, height) {
  if (!spec || !spec.panels) return [];
  return PANEL_IDS.map((id) => {
    const panel = spec.panels[id];
    return panel
      ? Object.assign({ id }, unitRectToPixels(panel, width, height))
      : null;
  }).filter(Boolean);
}

/** Read the palette a spec refers to, resolved through the palette module. */
export function specPalette(spec) {
  return getPalette(spec && spec.grade ? spec.grade : 'sunset');
}

/** Clone a spec deeply enough for safe editing. */
export function cloneSpec(spec) {
  return JSON.parse(JSON.stringify(spec));
}

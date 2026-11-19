/*
 * Normalised print specification.
 *
 * The spec is a single source of truth for margins, safe areas, badge space
 * and type proportions.  It is validated before use, and it provides the two
 * pieces of maths that are easy to get wrong: fitting a detected face into a
 * panel without cropping the chin, and sizing a title so it clears the frame.
 */

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/** Restrict a number to the 0..1 interval used throughout the spec. */
export function clamp01(value) {
  return clamp(finite(value, 0), 0, 1);
}

/** The stock poster specification, expressed entirely in 0..1 units. */
export const POSTER_SPEC = Object.freeze({
  version: 2,
  margin: Object.freeze({ x: 0.045, y: 0.045 }),
  frame: Object.freeze({ x: 0.012, y: 0.012, w: 0.976, h: 0.976 }),
  badge: Object.freeze({ x: 0.045, y: 0.012, w: 0.115, h: 0.038 }),
  title: Object.freeze({
    top: 0.605,
    bottom: 0.935,
    maxWidth: 0.92,
    maxLines: 2,
    sizeRatio: 0.40,
    lineGap: 0.90
  }),
  tagline: Object.freeze({ y: 0.86, sizeRatio: 0.075, tracking: 0.22 }),
  panel: Object.freeze({ gutter: 0.020, stroke: 0.006, keepOut: 0.020 })
});

/** Produce an editable copy, applying shallow overrides one level deep. */
export function buildSpec(overrides = {}) {
  const spec = {
    version: finite(overrides.version, POSTER_SPEC.version),
    margin: { ...POSTER_SPEC.margin, ...(overrides.margin || {}) },
    frame: { ...POSTER_SPEC.frame, ...(overrides.frame || {}) },
    badge: { ...POSTER_SPEC.badge, ...(overrides.badge || {}) },
    title: { ...POSTER_SPEC.title, ...(overrides.title || {}) },
    tagline: { ...POSTER_SPEC.tagline, ...(overrides.tagline || {}) },
    panel: { ...POSTER_SPEC.panel, ...(overrides.panel || {}) }
  };
  return spec;
}

/* ------------------------------------------------------------------ *
 * validation
 * ------------------------------------------------------------------ */

function checkRect(rect, path, errors) {
  if (!rect || typeof rect !== 'object') {
    errors.push(`${path} must be a rectangle`);
    return;
  }
  ['x', 'y', 'w', 'h'].forEach((key) => {
    const value = rect[key];
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      errors.push(`${path}.${key} must be between 0 and 1`);
    }
  });
  if (Number.isFinite(rect.x) && Number.isFinite(rect.w) && rect.x + rect.w > 1.0001) {
    errors.push(`${path} extends past the right edge`);
  }
  if (Number.isFinite(rect.y) && Number.isFinite(rect.h) && rect.y + rect.h > 1.0001) {
    errors.push(`${path} extends past the bottom edge`);
  }
}

/** Return `{ valid, errors }` so callers can show every problem at once. */
export function validateSpec(spec = POSTER_SPEC) {
  const errors = [];
  if (!spec || typeof spec !== 'object') {
    return { valid: false, errors: ['spec must be an object'] };
  }

  checkRect(spec.frame, 'frame', errors);
  checkRect(spec.badge, 'badge', errors);

  if (!spec.margin || !Number.isFinite(spec.margin.x) || !Number.isFinite(spec.margin.y)) {
    errors.push('margin x and y are required');
  }
  if (!spec.title || !Number.isFinite(spec.title.top) || !Number.isFinite(spec.title.bottom)) {
    errors.push('title top and bottom are required');
  } else if (spec.title.top >= spec.title.bottom) {
    errors.push('title top must be above title bottom');
  }
  if (spec.title && (spec.title.maxLines < 1 || spec.title.maxLines > 4)) {
    errors.push('title maxLines must be between 1 and 4');
  }
  if (spec.tagline && !Number.isFinite(spec.tagline.tracking)) {
    errors.push('tagline tracking must be numeric');
  }
  if (spec.panel && (!Number.isFinite(spec.panel.gutter) || spec.panel.gutter < 0)) {
    errors.push('panel gutter must be non-negative');
  }

  return { valid: errors.length === 0, errors };
}

/* ------------------------------------------------------------------ *
 * coordinate helpers
 * ------------------------------------------------------------------ */

export function rectFromNormalized(rect, width, height) {
  const w = Math.max(1, finite(width, 1080));
  const h = Math.max(1, finite(height, 1350));
  return {
    x: clamp01(finite(rect.x, 0)) * w,
    y: clamp01(finite(rect.y, 0)) * h,
    w: Math.max(1, finite(rect.w, 0.1) * w),
    h: Math.max(1, finite(rect.h, 0.1) * h)
  };
}

export function insetRect(rect, amountX, amountY = amountX) {
  return {
    x: rect.x + amountX,
    y: rect.y + amountY,
    w: Math.max(0, rect.w - amountX * 2),
    h: Math.max(0, rect.h - amountY * 2)
  };
}

/* ------------------------------------------------------------------ *
 * face -> panel mapping
 * ------------------------------------------------------------------ */

/**
 * Map a normalised face box onto a pixel panel.  The returned source rect is
 * a copy of the cover region that contains the whole face plus padding, with
 * the panel aspect ratio enforced; the destination is the panel itself.
 */
export function mapFaceToPanel(face = { x: 0.5, y: 0.5, w: 0.2, h: 0.22 }, panel, options = {}) {
  const sourceW = Math.max(1, finite(options.sourceWidth, 1920));
  const sourceH = Math.max(1, finite(options.sourceHeight, 1080));
  const padding = Math.max(0, finite(options.padding, 0.35));
  const zoom = clamp(finite(options.zoom, 1), 1, 5);

  const fx = clamp01(finite(face.x, 0.5));
  const fy = clamp01(finite(face.y, 0.5));
  const fw = clamp01(finite(face.w, 0.2));
  const fh = clamp01(finite(face.h, 0.22));

  const target = panel || { x: 0, y: 0, w: sourceW, h: sourceH };
  const aspect = Math.max(0.05, target.w / Math.max(1, target.h));

  let width = Math.max(fw * sourceW * (1 + padding), fh * sourceH * (1 + padding) * aspect);
  let height = width / aspect;
  if (height > sourceH) {
    height = sourceH;
    width = height * aspect;
  }
  width = Math.max(1, width / zoom);
  height = Math.max(1, height / zoom);

  const centreX = (fx + fw / 2) * sourceW;
  const centreY = (fy + fh / 2) * sourceH;
  const sx = clamp(centreX - width / 2, 0, Math.max(0, sourceW - width));
  const sy = clamp(centreY - height / 2, 0, Math.max(0, sourceH - height));

  return {
    src: { x: sx, y: sy, w: width, h: height },
    dst: { x: target.x, y: target.y, w: target.w, h: target.h },
    focus: { x: centreX / sourceW, y: centreY / sourceH }
  };
}

/* ------------------------------------------------------------------ *
 * title placement maths
 * ------------------------------------------------------------------ */

/** Rough character-width factor for the condensed display stack. */
const GLYPH_FACTOR = 0.56;

/**
 * Compute a font size and line breaks that keep the title inside the band.
 * Returns pixel geometry ready for canvas text calls.
 */
export function titlePlacement(spec = POSTER_SPEC, text = '', width = 1080, height = 1350) {
  const result = validateSpec(spec);
  if (!result.valid) spec = POSTER_SPEC;

  const band = rectFromNormalized({
    x: spec.margin.x,
    y: spec.title.top,
    w: 1 - spec.margin.x * 2,
    h: spec.title.bottom - spec.title.top
  }, width, height);

  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const maxLines = clamp(Math.round(finite(spec.title.maxLines, 2)), 1, 4);
  const lines = [];
  if (words.length) {
    const perLine = Math.ceil(words.length / maxLines);
    for (let i = 0; i < words.length; i += perLine) {
      lines.push(words.slice(i, i + perLine).join(' '));
    }
  }
  if (!lines.length) lines.push('');

  const longest = lines.reduce((best, line) => Math.max(best, line.length), 1);
  const byWidth = (band.w * spec.title.maxWidth) / Math.max(4, longest * GLYPH_FACTOR);
  const byHeight = (band.h * spec.title.sizeRatio) / Math.max(1, lines.length * spec.title.lineGap);
  const fontSize = Math.max(10, Math.min(byWidth, byHeight));

  return {
    x: band.x + band.w / 2,
    y: band.y + band.h * 0.42,
    w: band.w * spec.title.maxWidth,
    h: band.h,
    fontSize,
    lineHeight: fontSize * spec.title.lineGap,
    lines,
    align: 'center',
    baseline: 'middle'
  };
}

export default {
  POSTER_SPEC,
  buildSpec,
  validateSpec,
  rectFromNormalized,
  insetRect,
  mapFaceToPanel,
  titlePlacement
};

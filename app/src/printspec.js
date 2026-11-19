/**
 * printspec.js
 *
 * Original five-panel poster print specification for the offline GTA-style
 * poster editor. This module is intentionally self-contained: it has no imports
 * and no side effects, so it can be used by the renderer, the cropper, or a
 * Node-based export script without dragging in any runtime dependency.
 *
 * COORDINATE CONTRACT
 * -------------------
 * Every rectangle in this file lives in NORMALIZED canvas coordinates:
 *   (0, 0) = top-left of the poster, (1, 1) = bottom-right of the poster.
 * `x` grows to the right, `y` grows downward, and `w`/`h` are extents (not
 * second corner points). Keeping things normalized makes the spec resolution
 * independent: multiply by the final pixel size only at export time.
 */

// ---------------------------------------------------------------------------
// Base constants
// ---------------------------------------------------------------------------

/** Lower bound of every normalized coordinate. */
export const NORMALIZED_MIN = 0;

/** Upper bound of every normalized coordinate. */
export const NORMALIZED_MAX = 1;

/** Number of strips in the classic five-panel "accordion" poster. */
export const PANEL_COUNT = 5;

/** Default space between neighbouring panels, in normalized canvas units. */
export const DEFAULT_GUTTER = 0.012;

/** Default print bleed outside the trim area, in normalized canvas units. */
export const DEFAULT_BLEED = 0.02;

/** Tolerance used by every floating-point geometry comparison. */
export const GEOMETRY_EPSILON = 1e-6;

/**
 * Where a box gravitates inside its parent. Values are (fx, fy) multipliers:
 * 0 = start edge, 0.5 = centred, 1 = end edge.
 */
export const ALIGN_FACTORS = Object.freeze({
  'top-left': Object.freeze([0, 0]),
  top: Object.freeze([0.5, 0]),
  'top-right': Object.freeze([1, 0]),
  left: Object.freeze([0, 0.5]),
  center: Object.freeze([0.5, 0.5]),
  right: Object.freeze([1, 0.5]),
  'bottom-left': Object.freeze([0, 1]),
  bottom: Object.freeze([0.5, 1]),
  'bottom-right': Object.freeze([1, 1]),
});

// ---------------------------------------------------------------------------
// The specification object
// ---------------------------------------------------------------------------

/**
 * A concrete, immutable poster spec: a title band at the top and five equal
 * vertical strips below it, separated by even gutters and wrapped in bleed.
 *
 * Layout arithmetic (for anyone auditing the numbers):
 *   content width  = 0.96 - 0.04 = 0.92
 *   four gutters   = 4 * 0.012   = 0.048
 *   panel width    = (0.92 - 0.048) / 5 = 0.1744
 *   panel top      = 0.16, panel height = 0.79  -> bottom edge 0.95
 *   title zone     = y 0.02..0.12, safely above the topmost panel at 0.16
 */
export const POSTER_SPEC = Object.freeze({
  id: 'five-panel-strip-v1',

  canvas: Object.freeze({ w: 1, h: 1 }),

  bleed: DEFAULT_BLEED,
  gutter: DEFAULT_GUTTER,

  margins: Object.freeze({
    top: 0.02,
    right: 0.04,
    bottom: 0.05,
    left: 0.04,
  }),

  titleZone: Object.freeze({ x: 0.04, y: 0.02, w: 0.92, h: 0.10 }),

  panels: Object.freeze([
    Object.freeze({ id: 'panel-1', x: 0.0400, y: 0.16, w: 0.1744, h: 0.79 }),
    Object.freeze({ id: 'panel-2', x: 0.2264, y: 0.16, w: 0.1744, h: 0.79 }),
    Object.freeze({ id: 'panel-3', x: 0.4128, y: 0.16, w: 0.1744, h: 0.79 }),
    Object.freeze({ id: 'panel-4', x: 0.5992, y: 0.16, w: 0.1744, h: 0.79 }),
    Object.freeze({ id: 'panel-5', x: 0.7856, y: 0.16, w: 0.1744, h: 0.79 }),
  ]),

  /** Defaults consumed by the face-mapping helpers. */
  focus: Object.freeze({
    defaultScale: 0.72,
    defaultAlign: 'center',
    defaultSourceAspect: 1,
    defaultCropScale: 1.6,
  }),

  /** Defaults consumed by computeSafeTitlePlacement. */
  title: Object.freeze({
    lines: 2,
    fontSize: 0.055,
    lineHeight: 1.10,
    maxWidthRatio: 0.90,
    hAlign: 0.50,
    vAlign: 0.50,
  }),

  /** Defaults consumed by the halftone helpers. */
  halftone: Object.freeze({
    cellSize: 6,
    angleDeg: 45,
    gamma: 0.9,
  }),
});

// ---------------------------------------------------------------------------
// Small geometry helpers
// ---------------------------------------------------------------------------

/** Clamp a finite number into [min, max]; non-finite input becomes `min`. */
export function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** True when `rect` has finite, in-range coordinates and a positive extent. */
export function isNormalizedRect(rect) {
  if (!rect || typeof rect !== 'object') return false;
  const { x, y, w, h } = rect;
  if (![x, y, w, h].every(Number.isFinite)) return false;
  if (w <= 0 || h <= 0) return false;
  return (
    x >= NORMALIZED_MIN - GEOMETRY_EPSILON &&
    y >= NORMALIZED_MIN - GEOMETRY_EPSILON &&
    x + w <= NORMALIZED_MAX + GEOMETRY_EPSILON &&
    y + h <= NORMALIZED_MAX + GEOMETRY_EPSILON
  );
}

/** Area of a rectangle in normalized square units. */
export function rectArea(rect) {
  if (!rect) return 0;
  return Math.max(0, rect.w) * Math.max(0, rect.h);
}

/** Centre point of a rectangle, returned as { x, y }. */
export function rectCenter(rect) {
  return {
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2,
  };
}

/** Strict rectangle intersection (edge-touching is NOT an overlap). */
export function rectsOverlap(a, b, eps = GEOMETRY_EPSILON) {
  if (!a || !b) return false;
  return (
    a.x < b.x + b.w - eps &&
    b.x < a.x + a.w - eps &&
    a.y < b.y + b.h - eps &&
    b.y < a.y + a.h - eps
  );
}

/** True when `inner` sits completely inside `outer` (epsilon tolerant). */
export function rectWithin(inner, outer, eps = GEOMETRY_EPSILON) {
  if (!inner || !outer) return false;
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps &&
    inner.y + inner.h <= outer.y + outer.h + eps
  );
}

/** Clamp a rectangle into the normalized unit square and drop negative size. */
export function normalizeRect(rect) {
  const x = clamp(rect && rect.x, NORMALIZED_MIN, NORMALIZED_MAX);
  const y = clamp(rect && rect.y, NORMALIZED_MIN, NORMALIZED_MAX);
  const w = Math.max(0, clamp(rect && rect.w, 0, NORMALIZED_MAX - x));
  const h = Math.max(0, clamp(rect && rect.h, 0, NORMALIZED_MAX - y));
  return { x, y, w, h };
}

/** Fetch a panel rectangle by index, or null when the index is out of range. */
export function panelRectForIndex(spec, index) {
  const panels = spec && spec.panels;
  if (!Array.isArray(panels)) return null;
  const i = Math.trunc(index);
  if (!Number.isFinite(i) || i < 0 || i >= panels.length) return null;
  return panels[i] || null;
}

// ---------------------------------------------------------------------------
// Face -> panel mapping
// ---------------------------------------------------------------------------

/**
 * Resolve an alignment keyword into (fx, fy) multipliers.
 * Unknown keywords quietly fall back to centre alignment.
 */
function alignmentFactors(align) {
  return ALIGN_FACTORS[align] || ALIGN_FACTORS.center;
}

/**
 * Map a detected face rectangle (given in normalized IMAGE coordinates) into
 * the space of a POSTER panel (normalized CANVAS coordinates).
 *
 * The returned rectangle is the area INSIDE the panel that the face should
 * occupy. It preserves the face's pixel aspect ratio, scales to `focusScale`
 * of the panel, and is positioned according to `align`.
 *
 * @param {{x:number,y:number,w:number,h:number}} face normalized image rect
 * @param {{x:number,y:number,w:number,h:number}} panel normalized canvas rect
 * @param {object} [options]
 * @param {number} [options.focusScale] fraction of the panel to cover (0..1]
 * @param {string} [options.align] one of the ALIGN_FACTORS keys
 * @param {number} [options.sourceAspect] image width / image height
 * @param {number} [options.pad] extra inset from the panel edges (0..0.5)
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function faceToPanelRect(face, panel, options = {}) {
  const focus = (POSTER_SPEC && POSTER_SPEC.focus) || {};
  const focusScale = clamp(
    Number.isFinite(options.focusScale) ? options.focusScale : focus.defaultScale,
    0.05,
    1,
  );
  const align = options.align || focus.defaultAlign || 'center';
  const sourceAspect = clamp(
    Number.isFinite(options.sourceAspect)
      ? options.sourceAspect
      : focus.defaultSourceAspect,
    0.05,
    20,
  );
  const pad = clamp(options.pad || 0, 0, 0.5);

  // Work in a padded copy of the panel so artwork never kisses the gutter.
  const innerW = panel.w * (1 - 2 * pad);
  const innerH = panel.h * (1 - 2 * pad);
  const innerX = panel.x + panel.w * pad;
  const innerY = panel.y + panel.h * pad;

  // Face aspect in PIXEL space (normalized rects need the image aspect back).
  const faceW = Math.max(face.w, GEOMETRY_EPSILON) * sourceAspect;
  const faceH = Math.max(face.h, GEOMETRY_EPSILON);
  const faceAspect = faceW / faceH;

  // Fit the face box inside a focusScale-sized box of the panel.
  let boxW = innerW * focusScale;
  let boxH = innerH * focusScale;
  if (boxW / boxH > faceAspect) {
    boxW = boxH * faceAspect;
  } else {
    boxH = boxW / faceAspect;
  }

  const [fx, fy] = alignmentFactors(align);
  const x = innerX + (innerW - boxW) * fx;
  const y = innerY + (innerH - boxH) * fy;

  return { x, y, w: boxW, h: boxH };
}

/**
 * Build a full crop transform for a photo: which part of the SOURCE image to
 * sample (normalized image rect) and where to paint it in the DESTINATION
 * panel (normalized canvas rect). The source crop is centred on the face and
 * expanded until its pixel aspect matches the destination box.
 *
 * @returns {{source:object, destination:object, faceCenter:object}}
 */
export function computeFaceCropTransform(face, panel, options = {}) {
  const destination = faceToPanelRect(face, panel, options);

  const focus = (POSTER_SPEC && POSTER_SPEC.focus) || {};
  const sourceAspect = clamp(
    Number.isFinite(options.sourceAspect)
      ? options.sourceAspect
      : focus.defaultSourceAspect,
    0.05,
    20,
  );
  const cropScale = clamp(
    Number.isFinite(options.cropScale) ? options.cropScale : focus.defaultCropScale,
    1,
    5,
  );

  const faceCx = face.x + face.w / 2;
  const faceCy = face.y + face.h / 2;

  let cropW = Math.max(face.w, GEOMETRY_EPSILON) * cropScale;
  let cropH = Math.max(face.h, GEOMETRY_EPSILON) * cropScale;
  const destAspect = destination.w / Math.max(destination.h, GEOMETRY_EPSILON);
  const cropPixelAspect = (cropW * sourceAspect) / cropH;

  if (cropPixelAspect > destAspect) {
    cropW = (cropH * destAspect) / sourceAspect;
  } else {
    cropH = (cropW * sourceAspect) / destAspect;
  }

  // Keep the crop inside the image by sliding (not shrinking) it.
  let sx = faceCx - cropW / 2;
  let sy = faceCy - cropH / 2;
  if (sx < 0) sx = 0;
  if (sy < 0) sy = 0;
  if (sx + cropW > 1) sx = 1 - cropW;
  if (sy + cropH > 1) sy = 1 - cropH;

  return {
    source: { x: sx, y: sy, w: cropW, h: cropH },
    destination,
    faceCenter: { x: faceCx, y: faceCy },
  };
}

// ---------------------------------------------------------------------------
// Safe title placement
// ---------------------------------------------------------------------------

/**
 * Compute a title box that is guaranteed to sit in the band above the panels.
 * The available band is the spec's titleZone clipped to the canvas AND to the
 * area strictly above the topmost panel. If the requested type does not fit,
 * the font size is reduced (and `fitted` is false) rather than overflowing.
 *
 * @param {object} spec a poster spec (see POSTER_SPEC)
 * @param {object} [title] { lines, fontSize, lineHeight, maxWidthRatio,
 *                           hAlign, vAlign }
 * @returns {null|{x:number,y:number,w:number,h:number,fontSize:number,
 *                 lines:number,fitted:boolean,zone:object}}
 */
export function computeSafeTitlePlacement(spec, title = {}) {
  const zone = spec && spec.titleZone;
  const panels = spec && spec.panels;
  const canvasW = (spec && spec.canvas && spec.canvas.w) || 1;
  const canvasH = (spec && spec.canvas && spec.canvas.h) || 1;

  if (!zone || !Array.isArray(panels) || panels.length === 0) return null;

  const topmostY = Math.min.apply(
    null,
    panels.map((p) => p.y),
  );

  const x0 = Math.max(zone.x, NORMALIZED_MIN);
  const y0 = Math.max(zone.y, NORMALIZED_MIN);
  const x1 = Math.min(zone.x + zone.w, canvasW);
  const y1 = Math.min(zone.y + zone.h, topmostY);

  const availW = x1 - x0;
  const availH = y1 - y0;
  if (availW <= GEOMETRY_EPSILON || availH <= GEOMETRY_EPSILON) return null;

  const defaults = (spec && spec.title) || {};
  const linesRaw = Number(title.lines);
  const lines =
    Number.isFinite(linesRaw) && linesRaw >= 1 ? Math.trunc(linesRaw) : defaults.lines || 1;
  const requestedSize = clamp(
    Number.isFinite(title.fontSize) ? title.fontSize : defaults.fontSize || 0.05,
    GEOMETRY_EPSILON,
    1,
  );
  const lineHeight = clamp(
    Number.isFinite(title.lineHeight) ? title.lineHeight : defaults.lineHeight || 1.1,
    1,
    3,
  );
  const maxWidthRatio = clamp(
    Number.isFinite(title.maxWidthRatio)
      ? title.maxWidthRatio
      : defaults.maxWidthRatio || 1,
    0.05,
    1,
  );
  const hAlign = clamp(
    Number.isFinite(title.hAlign) ? title.hAlign : defaults.hAlign ?? 0.5,
    0,
    1,
  );
  const vAlign = clamp(
    Number.isFinite(title.vAlign) ? title.vAlign : defaults.vAlign ?? 0.5,
    0,
    1,
  );

  const naturalH = lines * requestedSize * lineHeight;
  const fitted = naturalH <= availH + GEOMETRY_EPSILON;
  const fontSize = fitted ? requestedSize : availH / (lines * lineHeight);
  const boxH = lines * fontSize * lineHeight;
  const boxW = availW * maxWidthRatio;

  return {
    x: x0 + (availW - boxW) * hAlign,
    y: y0 + (availH - boxH) * vAlign,
    w: boxW,
    h: boxH,
    fontSize,
    lines,
    fitted,
    zone: { x: x0, y: y0, w: availW, h: availH },
  };
}

// ---------------------------------------------------------------------------
// Halftone screen
// ---------------------------------------------------------------------------

/**
 * Radius of a single halftone dot. Dot AREA (not radius) is proportional to
 * ink coverage, hence the square root. A gamma exponent lets the caller tune
 * the perceptual response of the paper/ink pair.
 */
export function halftoneDotRadius(coverage, cellSize = 6, gamma = 1) {
  const c = Math.pow(clamp(coverage, 0, 1), Math.max(0.1, gamma));
  return (Math.max(0, cellSize) / 2) * Math.sqrt(c);
}

/**
 * Evaluate a rotated halftone screen at one sample point.
 *
 * The screen is a grid of `cellSize`-spaced dots rotated by `angleDeg`. For the
 * sample (x, y) we rotate into screen space, find the nearest cell centre, and
 * report whether the point falls inside that cell's coverage dot.
 *
 * @returns {{coverage:number,radius:number,distance:number,inside:boolean,
 *            cellX:number,cellY:number}}
 */
export function halftoneDot(coverage, x = 0, y = 0, options = {}) {
  const cellSize = Math.max(1, options.cellSize || POSTER_SPEC.halftone.cellSize);
  const angleDeg = Number.isFinite(options.angleDeg)
    ? options.angleDeg
    : POSTER_SPEC.halftone.angleDeg;
  const gamma = Number.isFinite(options.gamma)
    ? options.gamma
    : POSTER_SPEC.halftone.gamma;
  const phaseX = options.phaseX || 0;
  const phaseY = options.phaseY || 0;

  const c = clamp(coverage, 0, 1);
  const radians = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  // Rotate the sample into the screen's coordinate frame.
  const rx = x * cos + y * sin;
  const ry = -x * sin + y * cos;
  const gx = rx + phaseX;
  const gy = ry + phaseY;

  const cellX = Math.floor(gx / cellSize);
  const cellY = Math.floor(gy / cellSize);
  const dx = gx - (cellX + 0.5) * cellSize;
  const dy = gy - (cellY + 0.5) * cellSize;
  const distance = Math.hypot(dx, dy);
  const radius = halftoneDotRadius(c, cellSize, gamma);

  return {
    coverage: c,
    radius,
    distance,
    inside: distance <= radius,
    cellX,
    cellY,
  };
}

// ---------------------------------------------------------------------------
// Export / introspection helpers
// ---------------------------------------------------------------------------

/** Convert a spec's normalized rectangles into CSS percentage strings. */
export function posterSpecToCss(spec) {
  const pct = (v) => `${(v * 100).toFixed(4)}%`;
  const box = (r) => ({
    left: pct(r.x),
    top: pct(r.y),
    width: pct(r.w),
    height: pct(r.h),
  });
  return {
    id: spec && spec.id,
    panels: ((spec && spec.panels) || []).map((p) => ({
      id: p.id,
      ...box(p),
    })),
    titleZone: spec && spec.titleZone ? box(spec.titleZone) : null,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Check that a poster spec is internally consistent.
 *
 * Verifies: canvas sanity, exactly PANEL_COUNT panels, valid/positive panel
 * rects, panels inside the bleed-safe area, no panel overlaps, a monotonically
 * increasing left-to-right strip order, an even minimum gutter, and a title
 * zone that is valid and strictly above every panel.
 *
 * @returns {{ok:boolean,errors:string[]}}
 */
export function validatePosterSpec(spec) {
  const errors = [];

  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return { ok: false, errors: ['spec must be a plain object'] };
  }

  // -- canvas ---------------------------------------------------------------
  const canvas = spec.canvas;
  if (
    !canvas ||
    !Number.isFinite(canvas.w) ||
    !Number.isFinite(canvas.h) ||
    canvas.w <= 0 ||
    canvas.h <= 0
  ) {
    errors.push('canvas must declare positive finite w and h');
  }

  // -- numeric global fields ------------------------------------------------
  const bleed = Number.isFinite(spec.bleed) ? spec.bleed : DEFAULT_BLEED;
  const gutter = Number.isFinite(spec.gutter) ? spec.gutter : DEFAULT_GUTTER;
  if (bleed < 0 || bleed > 0.25) errors.push('bleed must be within 0..0.25');
  if (gutter < 0 || gutter > 0.1) errors.push('gutter must be within 0..0.1');

  const margins = spec.margins;
  if (margins) {
    ['top', 'right', 'bottom', 'left'].forEach((side) => {
      const value = margins[side];
      if (!Number.isFinite(value) || value < 0 || value > 0.5) {
        errors.push(`margins.${side} must be within 0..0.5`);
      }
    });
  } else {
    errors.push('margins object is missing');
  }

  // -- panels ---------------------------------------------------------------
  const panels = spec.panels;
  if (!Array.isArray(panels)) {
    errors.push('panels must be an array');
  } else {
    if (panels.length !== PANEL_COUNT) {
      errors.push(`expected ${PANEL_COUNT} panels, found ${panels.length}`);
    }

    panels.forEach((panel, i) => {
      if (!isNormalizedRect(panel)) {
        errors.push(`panel ${i} is not a valid normalized rect`);
        return;
      }
      if (
        panel.x < bleed - GEOMETRY_EPSILON ||
        panel.y < bleed - GEOMETRY_EPSILON ||
        panel.x + panel.w > 1 - bleed + GEOMETRY_EPSILON ||
        panel.y + panel.h > 1 - bleed + GEOMETRY_EPSILON
      ) {
        errors.push(`panel ${i} crosses the bleed-safe area`);
      }
    });

    for (let i = 0; i < panels.length; i += 1) {
      for (let j = i + 1; j < panels.length; j += 1) {
        if (rectsOverlap(panels[i], panels[j])) {
          errors.push(`panel ${i} overlaps panel ${j}`);
        }
      }
    }

    for (let i = 1; i < panels.length; i += 1) {
      const prev = panels[i - 1];
      const curr = panels[i];
      if (!prev || !curr) continue;
      if (curr.x < prev.x + prev.w - GEOMETRY_EPSILON) {
        errors.push(`panel ${i} is not to the right of panel ${i - 1}`);
      }
      const gap = curr.x - (prev.x + prev.w);
      if (gap + GEOMETRY_EPSILON < gutter) {
        errors.push(`gap before panel ${i} (${gap.toFixed(6)}) is below gutter ${gutter}`);
      }
    }
  }

  // -- title zone -----------------------------------------------------------
  const zone = spec.titleZone;
  if (!isNormalizedRect(zone)) {
    errors.push('titleZone is not a valid normalized rect');
  } else if (Array.isArray(panels) && panels.length > 0) {
    const topmostY = Math.min.apply(
      null,
      panels.filter(isNormalizedRect).map((p) => p.y),
    );
    if (Number.isFinite(topmostY) && zone.y + zone.h > topmostY + GEOMETRY_EPSILON) {
      errors.push('titleZone overlaps the topmost panel');
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Convenience boolean wrapper around validatePosterSpec. */
export function isValidPosterSpec(spec) {
  return validatePosterSpec(spec).ok;
}

/*
 * layouts.js — normalized geometry for the slanted panel collage.
 *
 * The cover is deliberately NOT an axis-aligned grid. Five rectangles are
 * tilted a few degrees and overlap with a thin cream gutter between them, so
 * the stack reads like die-cut plates on a printer's table. All numbers in
 * PANEL_BLUEPRINTS are normalized: centres and sizes are fractions of the
 * canvas, rotations are degrees. buildSlantedLayout() converts to pixels.
 */

/** Safe area reserved for the title lockup at the top of every export. */
export const TITLE_BAND = Object.freeze({ x: 0.05, y: 0.025, w: 0.90, h: 0.22 });
export const SAFE_TITLE_BAND = TITLE_BAND;

/** Cream separation between overlapping plates, as a fraction of min(w,h). */
export const GUTTER = 0.007;

/*
 * The five plates. Index 2 is the large centre "duo" plate that carries the
 * driver shot. Roles are printed as small pills on the plates themselves.
 */
export const PANEL_BLUEPRINTS = Object.freeze([
  {
    name: 'upper flank',
    role: 'THE CITY / NIGHT RUN',
    short: 'NIGHT RUN',
    cx: 0.19, cy: 0.23, w: 0.30, h: 0.30,
    rotate: -12, z: 1, tone: 0,
  },
  {
    name: 'duo left',
    role: 'THE GETAWAY / MARINA HEAT',
    short: 'MARINA HEAT',
    cx: 0.16, cy: 0.55, w: 0.31, h: 0.37,
    rotate: 9, z: 2, tone: 1,
  },
  {
    name: 'duo right',
    role: 'THE DRIVER / OCEAN DRIVE · 6:42 PM',
    short: 'OCEAN DRIVE',
    cx: 0.57, cy: 0.50, w: 0.46, h: 0.62,
    rotate: -5, z: 3, tone: 2,
  },
  {
    name: 'lower left',
    role: 'THE SCORE / VELVET HARBOR',
    short: 'VELVET HARBOR',
    cx: 0.25, cy: 0.85, w: 0.34, h: 0.30,
    rotate: 10, z: 4, tone: 3,
  },
  {
    name: 'lower right',
    role: 'THE ESCAPE / NEON MILE',
    short: 'NEON MILE',
    cx: 0.80, cy: 0.82, w: 0.32, h: 0.34,
    rotate: -8, z: 5, tone: 4,
  },
]);

/** Canonical role strings, exposed for the billing block and archive metadata. */
export const PANEL_ROLES = Object.freeze(PANEL_BLUEPRINTS.map((bp) => bp.role));

/**
 * Convert the blueprints into pixel specs for a given export canvas.
 * Returns exactly five specs in stable index order (index 2 = centre duo).
 * Specs are { index, name, role, short, tone, x, y, w, h, rotate, z } where
 * x/y are panel CENTRES and rotate is in radians.
 */
export function buildSlantedLayout(width, height) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const aspect = w / h;
  // Tall canvases get a slightly wider vertical spread so plates do not bunch.
  const spread = aspect < 1.25 ? 1.08 : 1;

  return PANEL_BLUEPRINTS.map((bp, index) => {
    const cy = (0.5 + (bp.cy - 0.5) * spread) * h;
    return {
      index,
      name: bp.name,
      role: bp.role,
      short: bp.short,
      tone: bp.tone,
      x: bp.cx * w,
      y: cy,
      w: bp.w * w,
      h: bp.h * h,
      rotate: (bp.rotate * Math.PI) / 180,
      z: bp.z,
    };
  });
}

/** Pixel rectangle for the safe title band. */
export function getTitleBand(width, height) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  return {
    x: TITLE_BAND.x * w,
    y: TITLE_BAND.y * h,
    w: TITLE_BAND.w * w,
    h: TITLE_BAND.h * h,
  };
}

/** Cream gutter thickness in pixels for a canvas. */
export function gutterPixels(width, height) {
  return Math.max(3, GUTTER * Math.max(1, Math.min(width, height)));
}

/** Split a role string into its "WHO / WHERE" halves for two-tone printing. */
export function splitRole(role) {
  const text = String(role || '').toUpperCase();
  const parts = text.split(' / ');
  if (parts.length >= 2) return { lead: parts[0], detail: parts.slice(1).join(' / ') };
  return { lead: text, detail: '' };
}

/** True when a point (canvas pixels) falls inside a rotated panel spec. */
export function pointInPanel(px, py, spec) {
  if (!spec) return false;
  const dx = px - spec.x;
  const dy = py - spec.y;
  const a = -(spec.rotate || 0);
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= spec.w / 2 && Math.abs(ly) <= spec.h / 2;
}

/** Axis-aligned bounding box of a rotated panel spec, in canvas pixels. */
export function panelBounds(spec) {
  const c = Math.abs(Math.cos(spec.rotate || 0));
  const s = Math.abs(Math.sin(spec.rotate || 0));
  const bw = spec.w * c + spec.h * s;
  const bh = spec.w * s + spec.h * c;
  return { x: spec.x - bw / 2, y: spec.y - bh / 2, w: bw, h: bh };
}

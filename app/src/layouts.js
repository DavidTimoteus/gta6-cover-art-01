/* ============================================================================
 * layouts.js
 * Normalized five-panel geometry for the printed poster.
 *
 * Every rectangle is stored in 0..1 relative units.  The single mapping
 * function mapRect() converts a normalized rect into pixel space, so the same
 * composition survives the square, portrait and wide export formats without
 * hand-tuned per-size numbers.
 * ==========================================================================*/

/* ------------------------------------------------------------ export sizes */
export const COVER_SIZES = Object.freeze({
  square: Object.freeze({ width: 1080, height: 1080, label: '1080 × 1080' }),
  portrait: Object.freeze({ width: 1080, height: 1350, label: '1080 × 1350' }),
  wide: Object.freeze({ width: 1920, height: 1080, label: '1920 × 1080' }),
});

export const COVER_SIZE_KEYS = Object.freeze(Object.keys(COVER_SIZES));

/* --------------------------------------------------------------- panels */
/*
 * The centre rect is the large duo: the renderer composites two plates inside
 * it, producing the visual "duo left" / "duo right" halves described by the
 * poster brief.  A slim right-hand flank completes the five-panel set.
 */
const RECTS = Object.freeze({
  upper: Object.freeze({
    x: 0.035, y: 0.195, w: 0.775, h: 0.145,
    label: 'Upper flank', duo: false,
  }),
  center: Object.freeze({
    x: 0.035, y: 0.350, w: 0.775, h: 0.420,
    label: 'Centre duo', duo: true,
  }),
  lowerLeft: Object.freeze({
    x: 0.035, y: 0.785, w: 0.375, h: 0.160,
    label: 'Lower left', duo: false,
  }),
  lowerRight: Object.freeze({
    x: 0.435, y: 0.785, w: 0.375, h: 0.160,
    label: 'Lower right', duo: false,
  }),
  side: Object.freeze({
    x: 0.835, y: 0.195, w: 0.130, h: 0.750,
    label: 'Side flank', duo: false,
  }),
});

export const PANEL_IDS = Object.freeze(Object.keys(RECTS));

/** The two normalized halves carved out of the centre duo panel. */
const DUO_LEFT_N = Object.freeze({ x: 0.035, y: 0.350, w: 0.3875, h: 0.420 });
const DUO_RIGHT_N = Object.freeze({ x: 0.4225, y: 0.350, w: 0.3875, h: 0.420 });

/* ----------------------------------------------------------- normalization */
/** Convert one normalized rect to pixel coordinates. Returns a plain object. */
export function mapRect(rect, width, height) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  return {
    x: rect.x * w,
    y: rect.y * h,
    w: rect.w * w,
    h: rect.h * h,
  };
}

/** Get a frozen copy of a normalized panel rect by id. */
export function getNormalizedRect(id) {
  return RECTS[id] || null;
}

/**
 * Map every panel into the requested canvas size.
 * Each entry carries its id, human label, pixel rect and the `duo` flag that
 * the editor uses to describe the centre panel in its panel list.
 */
export function getPanels(width, height) {
  return PANEL_IDS.map((id) => {
    const def = RECTS[id];
    const px = mapRect(def, width, height);
    return {
      id,
      label: def.label,
      duo: Boolean(def.duo),
      x: px.x,
      y: px.y,
      w: px.w,
      h: px.h,
      nx: def.x,
      ny: def.y,
      nw: def.w,
      nh: def.h,
    };
  });
}

/** Convenience lookup: one panel by id in pixel space. */
export function getPanel(id, width, height) {
  return getPanels(width, height).find((p) => p.id === id) || null;
}

/** Pixel rects for the two plates that fill the centre duo. */
export function getDuoHalves(width, height) {
  return [
    Object.assign({ id: 'duoLeft', label: 'Duo left' }, mapRect(DUO_LEFT_N, width, height)),
    Object.assign({ id: 'duoRight', label: 'Duo right' }, mapRect(DUO_RIGHT_N, width, height)),
  ];
}

/* ------------------------------------------------------------------- bands */
/** Safe title band that sits above every photo panel. */
export function getTitleBand(width, height) {
  return mapRect({ x: 0.035, y: 0.030, w: 0.930, h: 0.145 }, width, height);
}

export const getSafeTitleBand = getTitleBand;

/** Narrow footer band used for the tagline, below the lower panels. */
export function getTaglineBand(width, height) {
  return mapRect({ x: 0.035, y: 0.952, w: 0.930, h: 0.036 }, width, height);
}

/** Small square reserved for the LK badge in the upper-left of the sheet. */
export function getBadgeRect(width, height) {
  const band = getTitleBand(width, height);
  const size = Math.min(band.h * 0.52, width * 0.045);
  return {
    x: band.x,
    y: band.y + (band.h - size) / 2,
    w: size,
    h: size,
  };
}

/** Overall printable frame, inset from the trim edge. */
export function getPrintFrame(width, height) {
  return mapRect({ x: 0.018, y: 0.018, w: 0.964, h: 0.964 }, width, height);
}

/* ----------------------------------------------------------------- helpers */
/** Gutters (in pixels) between neighbouring panel rects, by id pair. */
export function panelGutter(a, b, width) {
  if (!a || !b) return 0;
  const rightOfA = a.x + a.w;
  if (Math.abs(rightOfA - b.x) < 0.02 * width) return b.x - rightOfA;
  const bottomOfA = a.y + a.h;
  if (Math.abs(bottomOfA - b.y) < 0.02 * width) return b.y - bottomOfA;
  return 0;
}

/** True when the given point (pixel coords) falls inside a panel rect. */
export function pointInPanel(px, py, panel) {
  return Boolean(panel)
    && px >= panel.x && px <= panel.x + panel.w
    && py >= panel.y && py <= panel.y + panel.h;
}

/** Scale a panel rect inward by a fraction of its smaller side. */
export function insetPanel(panel, fraction) {
  const pad = Math.min(panel.w, panel.h) * Math.max(0, fraction || 0);
  return {
    x: panel.x + pad,
    y: panel.y + pad,
    w: Math.max(1, panel.w - pad * 2),
    h: Math.max(1, panel.h - pad * 2),
  };
}

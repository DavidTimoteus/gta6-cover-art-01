/*
 * Poster geometry.
 *
 * Rectangles are authored once in normalised 0..1 space and resolved into
 * device pixels for whichever export size is being painted.  Keeping the
 * numbers relative means the square, portrait and wide posters share one
 * composition instead of three hand-tuned ones.
 */

export const PANEL_RECTS = Object.freeze([
  Object.freeze({ id: 'upper-flank', label: 'Upper flank', x: 0.045, y: 0.045, w: 0.910, h: 0.115, duo: false }),
  Object.freeze({ id: 'duo-left', label: 'Duo left', x: 0.045, y: 0.170, w: 0.445, h: 0.400, duo: true }),
  Object.freeze({ id: 'duo-right', label: 'Duo right', x: 0.510, y: 0.170, w: 0.445, h: 0.400, duo: true }),
  Object.freeze({ id: 'lower-left', label: 'Lower left', x: 0.045, y: 0.585, w: 0.445, h: 0.110, duo: false }),
  Object.freeze({ id: 'lower-right', label: 'Lower right', x: 0.510, y: 0.585, w: 0.445, h: 0.110, duo: false })
]);

const TITLE_BAND = Object.freeze({ x: 0.045, y: 0.605, w: 0.910, h: 0.330 });
const BADGE_BAND = Object.freeze({ x: 0.045, y: 0.012, w: 0.115, h: 0.038 });

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/** Convert one normalised rectangle into a pixel rectangle. */
export function mapRect(rect, width, height) {
  const w = Math.max(1, finite(width, 1080));
  const h = Math.max(1, finite(height, 1350));
  return {
    x: finite(rect.x, 0) * w,
    y: finite(rect.y, 0) * h,
    w: Math.max(1, finite(rect.w, 0.1) * w),
    h: Math.max(1, finite(rect.h, 0.1) * h)
  };
}

/**
 * Resolve an arbitrary normalised layout (which may come from the editor
 * state) into pixel panels.  Extra metadata is carried through untouched so
 * the renderer can still see `duo`, `label` and `index`.
 */
export function resolvePanels(layout = PANEL_RECTS, width = 1080, height = 1350) {
  const source = Array.isArray(layout) && layout.length ? layout : PANEL_RECTS;
  return source.map((panel, index) => {
    const rect = mapRect(panel, width, height);
    return {
      id: panel.id || `panel-${index}`,
      label: panel.label || `Panel ${index + 1}`,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      duo: panel.duo === true,
      index
    };
  });
}

/** Pixel bounds of the reserved title lockup at the foot of the poster. */
export function getTitleZone(width = 1080, height = 1350) {
  return mapRect(TITLE_BAND, width, height);
}

/** Pixel bounds of the small identification badge in the top-left corner. */
export function getBadgeZone(width = 1080, height = 1350) {
  return mapRect(BADGE_BAND, width, height);
}

/**
 * Work out the clear band left underneath a set of already-resolved panels.
 * This is the safe place to drop the title: it never overlaps a photo frame,
 * and it respects a small outer margin on both sides.
 */
export function getSafeTitleBand(panels = [], width = 1080, height = 1350, margin = 0.02) {
  const w = Math.max(1, finite(width, 1080));
  const h = Math.max(1, finite(height, 1350));
  const gap = clamp(finite(margin, 0.02), 0, 0.2);
  let lowest = 0;
  let leftmost = 1;
  let rightmost = 0;

  panels.forEach((panel) => {
    if (!panel || !Number.isFinite(panel.y)) return;
    lowest = Math.max(lowest, panel.y + finite(panel.h, 0));
    leftmost = Math.min(leftmost, panel.x / w);
    rightmost = Math.max(rightmost, (panel.x + finite(panel.w, 0)) / w);
  });

  const top = clamp(lowest / h + gap, 0, 0.94);
  const bottom = 1 - gap;
  return {
    x: clamp(leftmost, 0, 1) * w,
    y: top * h,
    w: clamp(rightmost - leftmost, 0.4, 1) * w,
    h: Math.max(1, (bottom - top) * h)
  };
}

export const titleBandFromPanels = getSafeTitleBand;

/** True when a pixel point lands inside the badge keep-out rectangle. */
export function pointInBadge(x, y, width = 1080, height = 1350, extra = 0) {
  const box = getBadgeZone(width, height);
  const pad = finite(extra, 0) * width;
  return x >= box.x - pad && x <= box.x + box.w + pad
    && y >= box.y - pad && y <= box.y + box.h + pad;
}

export function panelCenter(panel) {
  return {
    x: panel.x + panel.w / 2,
    y: panel.y + panel.h / 2
  };
}

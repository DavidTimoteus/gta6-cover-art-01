/*
 * layouts.js
 * Normalized panel geometry for the five-panel printed poster.
 *
 * Every panel is stored in unit coordinates (0..1) so the same composition can
 * be painted on a 1080px proof or a 1920px export.  Entry id 2 is the large
 * centre "duo" hero; the remaining four panels flank it on both sides.
 */

/** Export targets supported by the editor and the ?shot= preview. */
export const SIZE_PRESETS = Object.freeze({
  square: Object.freeze({ w: 1080, h: 1080, label: 'Square' }),
  portrait: Object.freeze({ w: 1080, h: 1350, label: 'Portrait' }),
  wide: Object.freeze({ w: 1920, h: 1080, label: 'Wide' }),
});

/** Default outer margin, as a fraction of the shorter canvas edge. */
export const OUTER_MARGIN = 0.035;

/** Gap between neighbouring panels, expressed in normalized units. */
export const GUTTER = 0.012;

/*
 * The five printed panels, in paint order.  x/y/w/h are normalized to the
 * full sheet.  `duo` marks the hero panel; `role` is a short classification,
 * `label` is the human-readable name shown in the editor.
 *
 *   upper flank ................ id 0
 *   duo left ................... id 1 (left half of the centre duo)
 *   duo hero (centre) .......... id 2  <-- large centre panel
 *   duo right .................. id 3
 *   lower left / lower right ... ids 1/3 continue down as the lower pair
 */
export const PANELS = Object.freeze([
  Object.freeze({ id: 0, x: 0.035, y: 0.255, w: 0.245, h: 0.335, role: 'upper flank', duo: false, label: 'Upper Flank' }),
  Object.freeze({ id: 1, x: 0.035, y: 0.605, w: 0.245, h: 0.360, role: 'duo left', duo: false, label: 'Duo Left' }),
  Object.freeze({ id: 2, x: 0.295, y: 0.255, w: 0.410, h: 0.710, role: 'duo hero', duo: true, label: 'Duo Hero' }),
  Object.freeze({ id: 3, x: 0.720, y: 0.255, w: 0.245, h: 0.335, role: 'duo right', duo: false, label: 'Duo Right' }),
  Object.freeze({ id: 4, x: 0.720, y: 0.605, w: 0.245, h: 0.360, role: 'lower right', duo: false, label: 'Lower Right' }),
]);

/** All five conceptual names, kept together for tooling and documentation. */
export const PANEL_LABELS = Object.freeze([
  'Upper Flank', 'Duo Left', 'Duo Hero', 'Duo Right', 'Lower Right',
]);

/** The duo hero is a single entry; these are the two halves it visually joins. */
export const DUO_HALVES = Object.freeze(['Duo Left', 'Duo Right']);

function finite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Map one normalized rect onto a concrete canvas.
 * Returns { x, y, w, h, left, top, right, bottom } in device pixels.
 */
export function panelToCanvasRect(panel, width, height) {
  const w = Math.max(1, finite(width, 1080));
  const h = Math.max(1, finite(height, 1080));
  const x = finite(panel && panel.x, 0) * w;
  const y = finite(panel && panel.y, 0) * h;
  const pw = finite(panel && panel.w, 0) * w;
  const ph = finite(panel && panel.h, 0) * h;
  return {
    x, y, w: pw, h: ph,
    left: x,
    top: y,
    right: x + pw,
    bottom: y + ph,
  };
}

/** Map every normalized panel rect to the given canvas size. */
export function mapRectsToCanvas(panels, width, height) {
  const source = Array.isArray(panels) && panels.length ? panels : PANELS;
  return source.map((panel) => panelToCanvasRect(panel, width, height));
}

/** Convenience alias used by the print-spec module. */
export const mapPanelsToCanvas = mapRectsToCanvas;

/**
 * Compute the safe title band sitting above the panels.
 *
 * The band spans the full printable width, starts at the outer margin and
 * stops a little short of the topmost panel.  `safeInset` keeps type away from
 * the trim edge.
 */
export function computeTitleBand(width, height, panels) {
  const w = Math.max(1, finite(width, 1080));
  const h = Math.max(1, finite(height, 1080));
  const list = Array.isArray(panels) && panels.length ? panels : PANELS;
  const topPanel = Math.min.apply(null, list.map((p) => finite(p.y, 0)));
  const bandTop = OUTER_MARGIN * 0.55;
  const bandBottom = Math.max(bandTop + 0.06, topPanel - GUTTER * 1.5);
  const x = OUTER_MARGIN * w;
  return {
    x,
    y: bandTop * h,
    w: w - x * 2,
    h: (bandBottom - bandTop) * h,
    safeInset: OUTER_MARGIN * w * 0.6,
    bottomNorm: bandBottom,
  };
}

/** Alias with an explicit "from panels" name. */
export function titleBandFromPanels(panels, width, height) {
  return computeTitleBand(width, height, panels);
}

/** Find the hero panel entry (id 2, or the first flagged duo panel). */
export function getHeroPanel(panels) {
  const list = Array.isArray(panels) && panels.length ? panels : PANELS;
  return list.find((p) => p.id === 2) || list.find((p) => p.duo) || list[0];
}

/**
 * Given a size preset key, return the concrete pixel dimensions.
 * Unknown keys fall back to the square proof.
 */
export function resolveSize(key) {
  return SIZE_PRESETS[key] || SIZE_PRESETS.square;
}

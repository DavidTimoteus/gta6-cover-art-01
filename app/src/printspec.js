/**
 * printspec.js
 *
 * Original, dependency-free specification module for the offline
 * GTA-style poster editor. Every geometry value lives in NORMALIZED
 * coordinates: the unit square [0,1] x [0,1] where (0,0) is the
 * top-left corner of the poster and (1,1) is the bottom-right. Keeping
 * the layout unit-based makes it resolution independent, so the exact
 * same spec drives a small preview and a full print-sized canvas.
 *
 * The poster is composed of five photo panels arranged in one
 * horizontal band, a reserved title zone above the band, and a footer
 * zone below it. Panels are separated by a uniform vertical gutter.
 */

/* ------------------------------------------------------------------ */
/* Numeric helpers                                                     */
/* ------------------------------------------------------------------ */

/** True only for a real, finite number (never NaN or +/-Infinity). */
export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** Clamp a finite number into the inclusive range [min, max]. */
export function clamp(value, min, max) {
  if (!isFiniteNumber(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Round a value to a fixed number of decimal digits. */
export function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Linear interpolation between a and b for t in [0,1]. */
export function lerp(a, b, t) {
  const k = clamp(t, 0, 1);
  return a + (b - a) * k;
}

/** Tolerance-based equality for normalized geometry. */
export function nearlyEqual(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

/* ------------------------------------------------------------------ */
/* Rectangle helpers                                                   */
/* ------------------------------------------------------------------ */

/** Build a named rectangle in normalized coordinates. */
export function makeRect(id, x, y, width, height) {
  return { id, x, y, width, height };
}

/** Right edge coordinate of a rectangle. */
export function rectRight(rect) {
  return rect.x + rect.width;
}

/** Bottom edge coordinate of a rectangle. */
export function rectBottom(rect) {
  return rect.y + rect.height;
}

/** Center point of a rectangle. */
export function rectCenter(rect) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

/** Return a rectangle with positive width/height regardless of corner order. */
export function normalizeRect(rect) {
  const x = Math.min(rect.x, rect.x + rect.width);
  const y = Math.min(rect.y, rect.y + rect.height);
  return {
    ...rect,
    x,
    y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

/** Shrink or grow a rectangle by given amounts on each axis. */
export function insetRect(rect, dx, dy = dx) {
  return {
    ...rect,
    x: rect.x + dx,
    y: rect.y + dy,
    width: rect.width - 2 * dx,
    height: rect.height - 2 * dy,
  };
}

/** Strict overlap test; rectangles that merely touch do not overlap. */
export function rectsOverlap(a, b) {
  const aRight = rectRight(a);
  const bRight = rectRight(b);
  const aBottom = rectBottom(a);
  const bBottom = rectBottom(b);
  if (aRight <= b.x || bRight <= a.x) return false;
  if (aBottom <= b.y || bBottom <= a.y) return false;
  return true;
}

/** Whether a point lies inside a rectangle (edges are inclusive). */
export function rectContainsPoint(rect, px, py) {
  return px >= rect.x && px <= rectRight(rect) && py >= rect.y && py <= rectBottom(rect);
}

/** Area of a rectangle in normalized square units. */
export function rectArea(rect) {
  return rect.width * rect.height;
}

/** Width-to-height ratio of a rectangle. */
export function aspectOf(rect) {
  return rect.height === 0 ? Infinity : rect.width / rect.height;
}

/* ------------------------------------------------------------------ */
/* Canonical layout constants                                          */
/* ------------------------------------------------------------------ */

/** The full poster canvas. */
export const CANVAS = Object.freeze({
  left: 0,
  top: 0,
  right: 1,
  bottom: 1,
  width: 1,
  height: 1,
});

/** Outer safety margins, as fractions of canvas width / height. */
export const MARGIN = Object.freeze({
  left: 0.05,
  right: 0.05,
  top: 0.04,
  bottom: 0.045,
});

/** Number of photo panels in the band. */
export const PANEL_COUNT = 5;

/** Uniform space between neighbouring panels. */
export const GUTTER = 0.012;

/** Zone reserved for the poster title, above the photo band. */
export const TITLE_ZONE = Object.freeze(
  makeRect("title-zone", MARGIN.left, MARGIN.top, 1 - MARGIN.left - MARGIN.right, 0.18),
);

/** Vertical extent of the photo band. */
export const PANEL_BAND = Object.freeze({
  top: 0.235,
  bottom: 0.855,
});

/** Zone reserved for credits / logo, below the photo band. */
export const FOOTER_ZONE = Object.freeze(
  makeRect(
    "footer-zone",
    MARGIN.left,
    PANEL_BAND.bottom,
    1 - MARGIN.left - MARGIN.right,
    1 - PANEL_BAND.bottom - MARGIN.bottom,
  ),
);

/** Lay out PANEL_COUNT equal panels across the available width. */
function buildPanels() {
  const usableWidth = 1 - MARGIN.left - MARGIN.right - GUTTER * (PANEL_COUNT - 1);
  const panelWidth = usableWidth / PANEL_COUNT;
  const bandHeight = PANEL_BAND.bottom - PANEL_BAND.top;
  const panels = [];
  for (let index = 0; index < PANEL_COUNT; index += 1) {
    const x = MARGIN.left + index * (panelWidth + GUTTER);
    panels.push(
      Object.freeze(
        makeRect(`panel-${index + 1}`, round(x, 6), round(PANEL_BAND.top, 6), round(panelWidth, 6), round(bandHeight, 6)),
      ),
    );
  }
  return Object.freeze(panels);
}

/** The complete, immutable five-panel poster specification. */
export const FIVE_PANEL_SPEC = Object.freeze({
  id: "five-panel-poster",
  version: 1,
  canvas: CANVAS,
  margin: MARGIN,
  gutter: GUTTER,
  panelCount: PANEL_COUNT,
  panelBand: PANEL_BAND,
  titleZone: TITLE_ZONE,
  footerZone: FOOTER_ZONE,
  panels: buildPanels(),
});

/* ------------------------------------------------------------------ */
/* Face-to-panel mapping                                               */
/* ------------------------------------------------------------------ */

/** Center point of a face region given in photo-normalized coordinates. */
export function faceCenter(faceRegion) {
  const face = normalizeRect(faceRegion);
  return {
    x: face.x + face.width / 2,
    y: face.y + face.height / 2,
  };
}

/**
 * Coerce a loose face box into a clean normalized rectangle, applying
 * optional fractional padding around the detected bounding box.
 */
export function normalizeFaceRegion(faceRegion, padding = 0) {
  const raw = normalizeRect({
    x: faceRegion.x,
    y: faceRegion.y,
    width: faceRegion.width,
    height: faceRegion.height,
  });
  const growX = raw.width * padding;
  const growY = raw.height * padding;
  return makeRect(
    faceRegion.id || "face",
    round(raw.x - growX, 6),
    round(raw.y - growY, 6),
    round(raw.width + 2 * growX, 6),
    round(raw.height + 2 * growY, 6),
  );
}

/**
 * Map a photo's face region into a panel rectangle.
 *
 * The face box is expressed in PHOTO space (0..1 over the source
 * image) while the panel is in POSTER space. The returned `photoCrop`
 * is the region of the source image to cut out; its aspect ratio is
 * forced to match the panel so the crop can be stretched into the
 * panel without distortion. The face center is placed at the requested
 * anchor position inside the crop and the crop is clamped to the photo.
 */
export function mapFaceToPanel(faceRegion, panelRect, options = {}) {
  const padding = options.padding ?? 0.35;
  const anchorX = clamp(options.anchorX ?? 0.5, 0, 1);
  const anchorY = clamp(options.anchorY ?? 0.5, 0, 1);
  const face = normalizeFaceRegion(faceRegion, padding);
  const panelAspect = aspectOf(panelRect);
  const faceAspect = aspectOf(face);

  let cropW = face.width;
  let cropH = face.height;
  if (cropW / cropH < panelAspect) {
    cropW = cropH * panelAspect;
  } else {
    cropH = cropW / panelAspect;
  }

  const center = faceCenter(face);
  let cropX = center.x - cropW * anchorX;
  let cropY = center.y - cropH * anchorY;

  if (cropW >= 1) {
    cropW = 1;
    cropX = 0;
  } else {
    cropX = clamp(cropX, 0, 1 - cropW);
  }
  if (cropH >= 1) {
    cropH = 1;
    cropY = 0;
  } else {
    cropY = clamp(cropY, 0, 1 - cropH);
  }

  return {
    panel: panelRect,
    photoCrop: makeRect("photo-crop", round(cropX, 6), round(cropY, 6), round(cropW, 6), round(cropH, 6)),
    faceCenter: center,
    faceAspect: round(faceAspect, 6),
    panelAspect: round(panelAspect, 6),
    anchor: { x: anchorX, y: anchorY },
  };
}

/** Map an ordered list of face regions onto the ordered panel list. */
export function mapFacesToPanels(faceRegions, spec, options = {}) {
  const panels = spec.panels || [];
  return panels.map((panel, index) => {
    const face = faceRegions[index] || null;
    if (!face) return { panel, photoCrop: null, faceCenter: null, skipped: true };
    return { ...mapFaceToPanel(face, panel, options), skipped: false };
  });
}

/* ------------------------------------------------------------------ */
/* Safe title placement                                                */
/* ------------------------------------------------------------------ */

/**
 * Compute a safe rectangle for the poster title: the intersection of
 * the title zone with the empty strip directly above the panels. The
 * result also carries typographic limits derived from the available
 * height so a title can never collide with the first photo row.
 */
export function computeSafeTitlePlacement(spec) {
  const zone = spec.titleZone;
  const panels = spec.panels || [];
  const topOfPanels = panels.reduce((min, panel) => Math.min(min, panel.y), Infinity);
  const zoneBottom = rectBottom(zone);
  const safeBottom = Number.isFinite(topOfPanels) ? Math.min(zoneBottom, topOfPanels) : zoneBottom;
  const gutter = spec.gutter || 0;
  const usableBottom = safeBottom - gutter;
  const usableHeight = Math.max(0, usableBottom - zone.y);
  const inset = Math.min(spec.margin?.left || 0, zone.width * 0.05);

  return {
    id: "title-safe",
    x: round(zone.x + inset, 6),
    y: round(zone.y, 6),
    width: round(zone.width - 2 * inset, 6),
    height: round(usableHeight, 6),
    centerX: round(zone.x + zone.width / 2, 6),
    baseline: round(zone.y + usableHeight * 0.82, 6),
    maxFontSize: round(usableHeight * 0.7, 6),
    clearanceToPanels: round(Math.max(0, topOfPanels - usableBottom), 6),
  };
}

/* ------------------------------------------------------------------ */
/* Halftone dots                                                       */
/* ------------------------------------------------------------------ */

/**
 * Describe a single halftone dot for a given luminance tone. Dot AREA
 * scales linearly with tone, so radius scales with its square root.
 * Returns geometry that a renderer can stamp onto a rotated grid.
 */
export function halftoneDot(tone, options = {}) {
  const angle = options.angle ?? 0;
  const frequency = Math.max(1, options.frequency ?? 48);
  const t = clamp(tone, 0, 1);
  const spacing = 1 / frequency;
  const maxRadius = spacing / 2;
  const radius = maxRadius * Math.sqrt(t);
  const coverage = Math.PI * radius * radius * frequency * frequency;
  return {
    tone: t,
    angle,
    frequency,
    spacing: round(spacing, 6),
    radius: round(radius, 6),
    coverage: round(clamp(coverage, 0, 1), 6),
    active: radius > 0,
  };
}

/** Rotate a grid coordinate around the origin by an angle in radians. */
export function halftoneCellCenter(gridX, gridY, frequency, angle = 0) {
  const spacing = 1 / Math.max(1, frequency);
  const x = gridX * spacing;
  const y = gridY * spacing;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: round(x * cos - y * sin, 6),
    y: round(x * sin + y * cos, 6),
  };
}

/** Build a bounded halftone grid description for a rectangular region. */
export function halftoneGrid(region, options = {}) {
  const frequency = Math.max(1, options.frequency ?? 48);
  const angle = options.angle ?? Math.PI / 4;
  const cols = Math.max(1, Math.round(region.width * frequency));
  const rows = Math.max(1, Math.round(region.height * frequency));
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({ col, row, center: halftoneCellCenter(col + 0.5, row + 0.5, frequency, angle) });
    }
  }
  return { region, frequency, angle, cols, rows, cells };
}

/* ------------------------------------------------------------------ */
/* Coordinate conversion                                               */
/* ------------------------------------------------------------------ */

/** Convert a normalized rectangle to pixel coordinates. */
export function normalizedRectToPixels(rect, pixelWidth, pixelHeight) {
  return makeRect(
    rect.id,
    round(rect.x * pixelWidth, 3),
    round(rect.y * pixelHeight, 3),
    round(rect.width * pixelWidth, 3),
    round(rect.height * pixelHeight, 3),
  );
}

/** Convert a pixel rectangle back to normalized coordinates. */
export function pixelsToNormalizedRect(rect, pixelWidth, pixelHeight) {
  return makeRect(
    rect.id,
    round(rect.x / pixelWidth, 6),
    round(rect.y / pixelHeight, 6),
    round(rect.width / pixelWidth, 6),
    round(rect.height / pixelHeight, 6),
  );
}

/* ------------------------------------------------------------------ */
/* Lookup helpers                                                      */
/* ------------------------------------------------------------------ */

/** Find a panel by its id, or null when absent. */
export function panelById(spec, id) {
  return (spec.panels || []).find((panel) => panel.id === id) || null;
}

/** Return the panel containing a normalized point, or null. */
export function panelAtPoint(spec, px, py) {
  return (spec.panels || []).find((panel) => rectContainsPoint(panel, px, py)) || null;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Check a poster spec for internal consistency. Structural problems
 * (missing fields, out-of-range geometry, overlapping panels, a title
 * that is not above the band, etc.) are collected as error strings.
 */
export function validateSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== "object") {
    return { ok: false, errors: ["spec must be an object"] };
  }

  const canvas = spec.canvas;
  if (!canvas || !isFiniteNumber(canvas.width) || !isFiniteNumber(canvas.height) || canvas.width <= 0 || canvas.height <= 0) {
    errors.push("canvas must have positive finite width and height");
  }

  const margin = spec.margin;
  if (!margin) {
    errors.push("margin is required");
  } else {
    for (const edge of ["left", "right", "top", "bottom"]) {
      if (!isFiniteNumber(margin[edge]) || margin[edge] < 0) errors.push(`margin.${edge} must be non-negative`);
    }
    if (isFiniteNumber(margin.left) && isFiniteNumber(margin.right) && margin.left + margin.right >= 1) {
      errors.push("left and right margins leave no usable width");
    }
  }

  if (!isFiniteNumber(spec.gutter) || spec.gutter < 0) {
    errors.push("gutter must be a non-negative number");
  }

  const panels = spec.panels;
  if (!Array.isArray(panels)) {
    errors.push("panels must be an array");
  } else {
    if (panels.length !== PANEL_COUNT) errors.push(`expected ${PANEL_COUNT} panels, found ${panels.length}`);
    let expectedY = null;
    let expectedHeight = null;
    panels.forEach((panel, index) => {
      if (!isFiniteNumber(panel.x) || !isFiniteNumber(panel.y) || !isFiniteNumber(panel.width) || !isFiniteNumber(panel.height)) {
        errors.push(`panel ${index} has non-finite geometry`);
        return;
      }
      if (panel.width <= 0 || panel.height <= 0) errors.push(`panel ${index} has non-positive size`);
      if (panel.x < 0 || panel.y < 0 || rectRight(panel) > 1 || rectBottom(panel) > 1) {
        errors.push(`panel ${index} escapes the unit canvas`);
      }
      if (expectedY === null) {
        expectedY = panel.y;
        expectedHeight = panel.height;
      } else if (!nearlyEqual(panel.y, expectedY) || !nearlyEqual(panel.height, expectedHeight)) {
        errors.push(`panel ${index} is misaligned with the band`);
      }
      for (let other = 0; other < index; other += 1) {
        if (rectsOverlap(panel, panels[other])) errors.push(`panel ${index} overlaps panel ${other}`);
      }
    });
  }

  const title = spec.titleZone;
  if (!title) {
    errors.push("titleZone is required");
  } else if (rectBottom(title) > Math.min.apply(null, (panels || []).map((p) => p.y).concat([Infinity]))) {
    errors.push("titleZone must sit above every panel");
  }

  const footer = spec.footerZone;
  if (!footer) {
    errors.push("footerZone is required");
  } else if (footer.y < Math.max.apply(null, (panels || []).map(rectBottom).concat([-Infinity]))) {
    errors.push("footerZone must sit below every panel");
  }

  const titleSafe = computeSafeTitlePlacement(spec);
  if (titleSafe.height <= 0) errors.push("title zone leaves no usable title height");

  return { ok: errors.length === 0, errors };
}

/** Validate a spec and throw a descriptive error when it is invalid. */
export function assertValidSpec(spec) {
  const result = validateSpec(spec);
  if (!result.ok) {
    throw new Error(`Invalid poster spec: ${result.errors.join("; ")}`);
  }
  return spec;
}

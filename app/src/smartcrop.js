/*
 * smartcrop.js
 * Lightweight, dependency-free face-aware cropping.
 *
 * The routine downsamples an image into a small offscreen buffer, walks that
 * buffer looking for bright warm "skin-like" patches, and reports a focus
 * point plus a normalized source region.  autoCrop() then turns that focus
 * into the zoom/offset triplet the rest of the editor uses, with a bias that
 * lands the subject just below the header badge instead of under the title.
 */

const SAMPLE_SIZE = 44;
const CELL = 4;

function finite(n, fallback) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function clamp(v, lo, hi) {
  const n = finite(v, lo);
  return n < lo ? lo : (n > hi ? hi : n);
}

/**
 * Draw an image into a tiny square buffer and return its pixels.
 * Returns null when the image is not decoded or the canvas is tainted.
 */
function sampleImage(img, size) {
  if (!img) return null;
  const iw = finite(img.naturalWidth || img.width, 0);
  const ih = finite(img.naturalHeight || img.height, 0);
  if (iw < 1 || ih < 1) return null;
  if (typeof document === 'undefined') return null;

  const n = Math.max(8, Math.floor(finite(size, SAMPLE_SIZE)));
  let canvas;
  let ctx;
  try {
    canvas = document.createElement('canvas');
    canvas.width = n;
    canvas.height = n;
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, iw, ih, 0, 0, n, n);
    const data = ctx.getImageData(0, 0, n, n);
    return { width: n, height: n, data: data.data };
  } catch (err) {
    return null;
  }
}

/**
 * Score one pixel for how "skin-like and bright" it is.
 * Zero means background; larger means a stronger candidate.
 */
function skinScore(r, g, b) {
  const warm = r - b;
  const bright = (r + g + b) / 765;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  const warmEnough = r > 92 && g > 38 && b > 16;
  const ordering = r >= g * 0.90 && g >= b * 0.82;
  if (!warmEnough || !ordering || warm < 12 || spread > 165) return 0;
  return bright * (0.55 + clamp(warm / 210, 0, 1) * 0.45);
}

/**
 * Walk the sampled pixels in CELL-sized tiles.  Returns the best tile and a
 * weighted set of neighbouring tiles used to build a tight focus region.
 */
function scanTiles(sample) {
  const { width, height, data } = sample;
  const tiles = [];
  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);

  for (let ty = 0; ty < rows; ty += 1) {
    for (let tx = 0; tx < cols; tx += 1) {
      let sum = 0;
      let weight = 0;
      let sx = 0;
      let sy = 0;
      const x0 = tx * CELL;
      const y0 = ty * CELL;
      const x1 = Math.min(width, x0 + CELL);
      const y1 = Math.min(height, y0 + CELL);

      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * width + x) * 4;
          const score = skinScore(data[i], data[i + 1], data[i + 2]);
          if (score <= 0) continue;
          sum += score;
          weight += 1;
          sx += x * score;
          sy += y * score;
        }
      }

      if (weight > 0) {
        tiles.push({
          tx, ty,
          score: sum / weight,
          cx: (sx / sum) / width,
          cy: (sy / sum) / height,
        });
      }
    }
  }
  return tiles;
}

/**
 * Core analysis shared by detectSkinRegion() and autoCrop().
 * Falls back to a centered focus when the image cannot be read or is cold.
 */
export function analyzeImage(img) {
  const sample = sampleImage(img);
  const fallback = {
    focus: { x: 0.5, y: 0.5 },
    region: { x: 0.38, y: 0.30, w: 0.24, h: 0.40 },
    sampled: false,
    strength: 0,
  };
  if (!sample) return fallback;

  const tiles = scanTiles(sample);
  if (!tiles.length) return fallback;

  let best = tiles[0];
  for (let i = 1; i < tiles.length; i += 1) {
    if (tiles[i].score > best.score) best = tiles[i];
  }

  const threshold = Math.max(0.06, best.score * 0.55);
  const chosen = tiles.filter((t) => t.score >= threshold);
  let fx = 0;
  let fy = 0;
  let fweight = 0;
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;

  chosen.forEach((t) => {
    const w = t.score;
    fx += t.cx * w;
    fy += t.cy * w;
    fweight += w;
    minX = Math.min(minX, t.cx);
    minY = Math.min(minY, t.cy);
    maxX = Math.max(maxX, t.cx);
    maxY = Math.max(maxY, t.cy);
  });

  const focus = {
    x: clamp(fweight > 0 ? fx / fweight : best.cx, 0.04, 0.96),
    y: clamp(fweight > 0 ? fy / fweight : best.cy, 0.04, 0.96),
  };

  const pad = 0.035;
  const region = {
    x: clamp(minX - pad, 0, 1),
    y: clamp(minY - pad, 0, 1),
    w: clamp(maxX - minX + pad * 2, 0.06, 1),
    h: clamp(maxY - minY + pad * 2, 0.08, 1),
  };

  return { focus, region, sampled: true, strength: best.score };
}

/**
 * Public API: the normalized region containing the brightest skin-like patch.
 * Returns null only when the input cannot be inspected at all.
 */
export function detectSkinRegion(img) {
  const analysis = analyzeImage(img);
  if (!analysis.sampled) return null;
  return analysis.region;
}

/** Public API: just the focus point, normalized to the source image. */
export function detectFocusPoint(img) {
  return analyzeImage(img).focus;
}

/**
 * Compute a normalized source crop rectangle for a zoom/offset pair.
 *
 * `zoom` is the scale factor (1 = whole image), while x and y are offsets in
 * -1..1 around the focus.  The returned rect is safe to hand to drawImage.
 */
export function computeSourceRect(img, zoom, x, y, focus) {
  const iw = finite(img && (img.naturalWidth || img.width), 0);
  const ih = finite(img && (img.naturalHeight || img.height), 0);
  const aspect = iw > 0 && ih > 0 ? iw / ih : 1;
  const z = clamp(zoom, 1, 3);

  // A square crop in normalized space; wider images crop more horizontally.
  let cw = 1 / z;
  let ch = 1 / z;
  if (aspect >= 1) cw = Math.min(1, ch * aspect);
  else ch = Math.min(1, cw / aspect);
  cw = clamp(cw, 0.08, 1);
  ch = clamp(ch, 0.08, 1);

  const f = focus || { x: 0.5, y: 0.5 };
  const cx = clamp(f.x + clamp(x, -1, 1) * (1 - cw) * 0.5, cw / 2, 1 - cw / 2);
  const cy = clamp(f.y + clamp(y, -1, 1) * (1 - ch) * 0.5, ch / 2, 1 - ch / 2);

  return {
    x: cx - cw / 2,
    y: cy - ch / 2,
    w: cw,
    h: ch,
    centerX: cx,
    centerY: cy,
  };
}

/** The destination rectangle is simply the panel expressed in pixels. */
export function computeDestRect(panelRect, width, height) {
  const p = panelRect || { x: 0, y: 0, w: 1, h: 1 };
  return {
    x: finite(p.x, 0) * finite(width, 0),
    y: finite(p.y, 0) * finite(height, 0),
    w: finite(p.w, 1) * finite(width, 0),
    h: finite(p.h, 1) * finite(height, 0),
  };
}

/**
 * Face-aware crop.
 *
 * The focus is parked at `targetX`/`targetY` inside the panel (by default
 * slightly below centre, clear of the header badge).  Returns the zoom and
 * -1..1 offsets consumed by the controller, plus the focus and the derived
 * source/destination rectangles for callers that want them directly.
 */
export function autoCrop(img, panelRect, options) {
  const opts = options || {};
  const analysis = analyzeImage(img);
  const focus = analysis.focus;
  const region = analysis.region;

  // Zoom in harder when the detected patch is small, and a little more for
  // the hero panel so the duo reads as the focal point of the poster.
  const extent = Math.max(region.w, region.h);
  let zoom = clamp(0.30 / Math.max(extent, 0.06), 1.05, 2.55);
  if (panelRect && panelRect.duo) zoom = clamp(zoom * 1.12, 1.05, 2.9);
  if (!analysis.sampled) zoom = 1.2;

  // The badge occupies the top sliver of the panel; never park the subject
  // higher than roughly the vertical middle.
  const targetX = clamp(finite(opts.targetX, 0.5), 0.15, 0.85);
  const targetY = clamp(Math.max(finite(opts.targetY, 0.58), 0.52), 0.30, 0.90);

  const z = clamp(zoom, 1, 3);
  let cw = 1 / z;
  let ch = 1 / z;
  const iw = finite(img && (img.naturalWidth || img.width), 0);
  const ih = finite(img && (img.naturalHeight || img.height), 0);
  if (iw > 0 && ih > 0) {
    const aspect = iw / ih;
    if (aspect >= 1) cw = Math.min(1, ch * aspect);
    else ch = Math.min(1, cw / aspect);
  }

  // Place the crop centre so that `focus` lands at the requested target.
  const desiredCenterX = clamp(focus.x + (0.5 - targetX) * cw, 0, 1);
  const desiredCenterY = clamp(focus.y + (0.5 - targetY) * ch, 0, 1);
  const x = clamp((desiredCenterX - focus.x) / Math.max(cw, 0.001) * 2, -1, 1);
  const y = clamp((desiredCenterY - focus.y) / Math.max(ch, 0.001) * 2, -1, 1);

  const srcRect = computeSourceRect(img, z, x, y, focus);

  return {
    zoom: z,
    x,
    y,
    focus,
    region,
    target: { x: targetX, y: targetY },
    srcRect,
    destRect: computeDestRect(panelRect),
  };
}

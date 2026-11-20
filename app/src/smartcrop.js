/*
 * smartcrop.js — face-aware framing without a face-detection model.
 *
 * The editor is fully offline, so instead of a neural detector we scan a tiny
 * downsample of the plate for warm, bright, skin-like clusters. Their weighted
 * centroid becomes a focus point. The crop is then a "cover" crop that places
 * that focus slightly below centre, leaving room for the header badge above
 * the subject's face. Manual zoom and pan are layered on top of the result.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Source dimensions of an HTMLImageElement or canvas-like object. */
function sourceSize(image) {
  if (!image) return { w: 0, h: 0 };
  const w = image.naturalWidth || image.videoWidth || image.width || 0;
  const h = image.naturalHeight || image.videoHeight || image.height || 0;
  return { w: Number(w) || 0, h: Number(h) || 0 };
}

/**
 * Heuristic skin score in [0, 1]. Warm reds above cool blues with enough
 * channel separation and mid-to-high brightness score highest; greys and
 * deep shadows score zero. This is intentionally cheap so it can run on a
 * 32x32 sample for every panel on every slider tick.
 */
export function skinScore(r, g, b) {
  if (r < 80 || g < 35 || b < 12) return 0;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx - mn < 12) return 0;
  if (r < g || r < b) return 0;
  const warmth = r - b;
  let score = 0;
  if (warmth > 25) score += 0.48;
  else if (warmth > 12) score += 0.24;
  if (g > 45 && g < 215) score += 0.26;
  if (r > 110 && r < 252) score += 0.26;
  const bright = (r + g + b) / (3 * 255);
  score *= 0.55 + bright;
  return clamp(score, 0, 1);
}

/** Read a small RGBA sample grid from an image. Returns null when unavailable. */
function sampleGrid(image, cols, rows) {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, cols, rows);
    return ctx.getImageData(0, 0, cols, rows).data;
  } catch (_) {
    return null;
  }
}

/**
 * Find a focus point in normalized image coordinates.
 * Returns { x, y, strength } where strength is the confidence in [0, 1].
 */
export function findFocus(image, grid = 32) {
  const cols = Math.max(8, Math.round(grid));
  const rows = cols;
  const data = sampleGrid(image, cols, rows);
  if (!data) return { x: 0.5, y: 0.55, strength: 0 };

  let weight = 0;
  let wx = 0;
  let wy = 0;
  let hot = { x: 0.5, y: 0.55, score: -1 };

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const i = (y * cols + x) * 4;
      const skin = skinScore(data[i], data[i + 1], data[i + 2]);
      if (skin <= 0) continue;
      // Favour skin that is also brighter than its neighbours in the plate.
      const bright = (data[i] + data[i + 1] + data[i + 2]) / (3 * 255);
      const score = skin * (0.35 + bright);
      const nx = (x + 0.5) / cols;
      const ny = (y + 0.5) / rows;
      weight += score;
      wx += nx * score;
      wy += ny * score;
      if (score > hot.score) hot = { x: nx, y: ny, score };
    }
  }

  if (weight < 0.5) return { x: 0.5, y: 0.55, strength: 0 };

  // Blend the centroid with the single hottest cell, then keep it off edges.
  const cx = wx / weight;
  const cy = wy / weight;
  const strength = clamp(weight / (cols * rows * 0.12), 0, 1);
  return {
    x: clamp(cx * 0.7 + hot.x * 0.3, 0.18, 0.82),
    y: clamp(cy * 0.7 + hot.y * 0.3, 0.22, 0.86),
    strength,
  };
}

/**
 * Largest axis-aligned rectangle of a target aspect that fits inside a
 * source of the given size, centred on the source.
 */
export function coverCrop(iw, ih, aspect) {
  const a = Math.max(0.2, aspect || 1);
  let sw;
  let sh;
  if (iw / ih > a) {
    sh = ih;
    sw = ih * a;
  } else {
    sw = iw;
    sh = iw / a;
  }
  return { sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw, sh };
}

/**
 * Compute the source rectangle to draw into a panel.
 *
 * opts = { autoCrop, zoom, panX, panY } with pan values in [-1, 1].
 * autoCrop biases the subject so the focus lands at 44% down the panel,
 * comfortably below the header badge. Returns integer source pixels.
 */
export function faceAwareCrop(image, outW, outH, opts = {}) {
  const { w: iw, h: ih } = sourceSize(image);
  if (!iw || !ih) return { sx: 0, sy: 0, sw: 1, sh: 1 };

  const aspect = Math.max(0.2, (Number(outW) || iw) / (Number(outH) || ih));
  const base = coverCrop(iw, ih, aspect);

  const zoom = clamp(Number(opts.zoom) || 1, 1, 3.5);
  let sw = base.sw / zoom;
  let sh = base.sh / zoom;
  sw = Math.min(sw, iw);
  sh = Math.min(sh, ih);

  const panX = clamp(Number(opts.panX) || 0, -1, 1);
  const panY = clamp(Number(opts.panY) || 0, -1, 1);

  let fx = 0.5;
  let fy = 0.55;
  if (opts.autoCrop !== false) {
    const focus = findFocus(image);
    fx = focus.x;
    fy = focus.y;
  } else {
    fx = 0.5 + panX * 0.18;
    fy = 0.55 + panY * 0.18;
  }

  // Put the focus at 44% height and horizontally centred, before pan.
  const desiredX = 0.5;
  const desiredY = 0.44;
  let sx = fx * iw - sw * desiredX + panX * sw * 0.34;
  let sy = fy * ih - sh * desiredY + panY * sh * 0.34;

  sx = clamp(sx, 0, Math.max(0, iw - sw));
  sy = clamp(sy, 0, Math.max(0, ih - sh));

  return {
    sx: Math.round(sx),
    sy: Math.round(sy),
    sw: Math.max(1, Math.round(sw)),
    sh: Math.max(1, Math.round(sh)),
  };
}

/** Convenience: crop rect expressed as normalized fractions of the source. */
export function normalizedCrop(crop, image) {
  const { w: iw, h: ih } = sourceSize(image);
  if (!iw || !ih) return { x: 0, y: 0, w: 1, h: 1 };
  return {
    x: crop.sx / iw,
    y: crop.sy / ih,
    w: crop.sw / iw,
    h: crop.sh / ih,
  };
}

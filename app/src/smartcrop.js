/*
 * Face-aware framing.
 *
 * A downscaled copy of a photo is scored cell by cell for warm, bright,
 * skin-like pixels.  The strongest cluster becomes a focus point; the point
 * is then nudged out from under the header badge and used to derive a source
 * crop that keeps the subject inside a panel.  Decoding stays local: the
 * image is drawn into an offscreen canvas that is never attached to the page.
 */

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/** Average of the three channels, 0..255. */
export function brightness(r, g, b) {
  return (r + g + b) / 3;
}

/**
 * A permissive skin/face heuristic.  Warm red-dominant pixels score highest,
 * with a smaller bonus for bright highlights such as a lit forehead.  Cool
 * shadows and flat greys score close to zero.
 */
export function skinScore(r, g, b) {
  const highest = Math.max(r, g, b);
  const lowest = Math.min(r, g, b);
  const warm = r - b;
  const saturation = highest - lowest;
  const light = brightness(r, g, b);

  let score = 0;
  if (r > 78 && g > 32 && b > 14 && warm > 12 && r >= g && saturation > 14) {
    score = warm * (0.35 + saturation / 340) * clamp((light - 30) / 130, 0, 1);
  }
  if (light > 145 && saturation < 110) {
    score += (light - 145) * 0.45;
  }
  return clamp(score, 0, 255);
}

/**
 * Turn a small RGBA buffer into a focus point.  Only rows between the search
 * bounds are considered, which stops the score latching onto a bright sky or
 * a glowing sign at the very top of the frame.
 */
export function focusFromHeatmap(width, height, pixels, options = {}) {
  const opts = {
    preferredY: finite(options.preferredY, 0.42),
    searchTop: finite(options.searchTop, 0.16),
    searchBottom: finite(options.searchBottom, 0.74),
    bias: finite(options.bias, 0.32)
  };

  const top = clamp(opts.searchTop, 0, 0.95) * height;
  const bottom = clamp(opts.searchBottom, 0.05, 1) * height;
  const lowRow = Math.max(0, Math.floor(Math.min(top, bottom)));
  const highRow = Math.min(height, Math.ceil(Math.max(top, bottom)));

  let peak = 0;
  const scores = new Float32Array(width * height);
  for (let y = lowRow; y < highRow; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      const score = skinScore(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
      scores[index] = score;
      if (score > peak) peak = score;
    }
  }

  if (peak <= 6) {
    return { x: 0.5, y: clamp(opts.preferredY, 0.1, 0.9), confidence: 0 };
  }

  const threshold = peak * 0.58;
  let weightSum = 0;
  let xSum = 0;
  let ySum = 0;
  let count = 0;

  for (let y = lowRow; y < highRow; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const score = scores[y * width + x];
      if (score < threshold) continue;
      const weight = score * score;
      weightSum += weight;
      xSum += x * weight;
      ySum += y * weight;
      count += 1;
    }
  }

  if (weightSum <= 0 || count === 0) {
    return { x: 0.5, y: clamp(opts.preferredY, 0.1, 0.9), confidence: 0 };
  }

  const rawX = xSum / weightSum / Math.max(1, width - 1);
  const rawY = ySum / weightSum / Math.max(1, height - 1);
  const biasedY = rawY * (1 - opts.bias) + clamp(opts.preferredY, 0, 1) * opts.bias;
  const spread = clamp(count / Math.max(1, (highRow - lowRow) * width), 0, 1);
  const strength = clamp(peak / 210, 0, 1);

  return {
    x: clamp(rawX, 0.04, 0.96),
    y: clamp(biasedY, 0.12, 0.82),
    confidence: clamp(0.35 + strength * 0.45 + spread * 0.20, 0, 1)
  };
}

/** Keep a subject out of the rectangular no-go zone behind the badge. */
export function keepFocusClearOfBadge(focus, options = {}) {
  const box = {
    x: finite(options.badgeX, 0.045),
    y: finite(options.badgeY, 0.012),
    w: finite(options.badgeW, 0.115),
    h: finite(options.badgeH, 0.038)
  };
  const pad = finite(options.padding, 0.02);
  const insideX = focus.x >= box.x - pad && focus.x <= box.x + box.w + pad;
  const insideY = focus.y >= box.y - pad && focus.y <= box.y + box.h + pad;
  if (!insideX || !insideY) return { x: focus.x, y: focus.y };

  return {
    x: Math.max(focus.x, box.x + box.w + pad),
    y: Math.max(focus.y, box.y + box.h + pad)
  };
}

/**
 * Locate a subject in a decoded image.  Falls back to a safe central point if
 * the environment has no canvas or the image has no usable pixels.
 */
export function faceAwareCrop(image, options = {}) {
  const fallback = {
    x: 0.5,
    y: clamp(finite(options.preferredY, 0.42), 0.1, 0.9),
    confidence: 0
  };
  if (!image || typeof document === 'undefined') return fallback;

  const iw = finite(image.naturalWidth, 0) || finite(image.width, 0);
  const ih = finite(image.naturalHeight, 0) || finite(image.height, 0);
  if (iw < 2 || ih < 2) return fallback;

  const grid = Math.round(clamp(finite(options.grid, 48), 12, 96));
  const sampleWidth = grid;
  const sampleHeight = Math.max(12, Math.round(grid * ih / iw));

  try {
    const canvas = document.createElement('canvas');
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return fallback;
    context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
    const data = context.getImageData(0, 0, sampleWidth, sampleHeight);
    const focus = focusFromHeatmap(sampleWidth, sampleHeight, data.data, options);
    if (options.respectBadge === false) return focus;
    return keepFocusClearOfBadge(focus, options);
  } catch (error) {
    return fallback;
  }
}

/**
 * Derive source and destination rectangles from a focus point.  The source is
 * cropped to the panel's aspect ratio, zoomed, slid so the focus stays in the
 * middle, and clamped so no empty edge is ever exposed.
 */
export function computeCropRects(focus, sourceWidth, sourceHeight, panelRect, options = {}) {
  const swSource = Math.max(1, finite(sourceWidth, 1));
  const shSource = Math.max(1, finite(sourceHeight, 1));
  const rect = panelRect || { x: 0, y: 0, w: 1, h: 1 };
  const aspect = Math.max(0.05, finite(rect.w, 1) / Math.max(1, finite(rect.h, 1)));
  const zoom = clamp(finite(options.zoom, 1), 1, 6);

  let sw = swSource;
  let sh = sw / aspect;
  if (sh > shSource) {
    sh = shSource;
    sw = sh * aspect;
  }
  sw = Math.max(1, sw / zoom);
  sh = Math.max(1, sh / zoom);

  const clean = options.respectBadge === false
    ? focus
    : keepFocusClearOfBadge(focus, options);
  const slackX = Math.max(0, swSource - sw);
  const slackY = Math.max(0, shSource - sh);
  const nudgeX = clamp(finite(options.offsetX, 0), -1, 1) * slackX * 0.35;
  const nudgeY = clamp(finite(options.offsetY, 0), -1, 1) * slackY * 0.35;

  const sx = clamp(clean.x * swSource - sw / 2 + nudgeX, 0, slackX);
  const sy = clamp(clean.y * shSource - sh / 2 + nudgeY, 0, slackY);

  return {
    src: { x: sx, y: sy, w: sw, h: sh },
    dst: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    focus: { x: clean.x, y: clean.y }
  };
}

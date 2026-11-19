/* ============================================================================
 * smartcrop.js
 * Lightweight face-aware framing without any external model or dependency.
 *
 * A tiny copy of the source is scanned for bright, warm (skin-like) pixels.
 * Their weighted centroid becomes the focus point.  We then solve for pan and
 * zoom so that the focus lands at a requested height inside the destination
 * panel — low enough to clear the header badge band.
 *
 * The cover-fit maths here exactly matches drawCoverImage() in render.js:
 *   scale = max(panel.w / img.w, panel.h / img.h) * zoom
 *   extraX = (img.w * scale - panel.w) / 2   (likewise for Y)
 *   drawLeft = panel.x - extraX * (1 + panX)
 * A focus at normalized (fx, fy) therefore lands at panel-relative
 *   fx * drawW - extraX * (1 + panX).
 * ==========================================================================*/

const SCAN_EDGE = 56;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function imageSize(image) {
  if (!image) return { w: 0, h: 0 };
  const w = image.naturalWidth || image.videoWidth || image.width || 0;
  const h = image.naturalHeight || image.videoHeight || image.height || 0;
  return { w, h };
}

/**
 * Draw the image into a small offscreen canvas and return its ImageData.
 * Returns null when no DOM canvas is available or the source has no pixels.
 */
function scanPixels(image) {
  const size = imageSize(image);
  if (!size.w || !size.h || typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    const ratio = size.h / size.w;
    canvas.width = SCAN_EDGE;
    canvas.height = Math.max(1, Math.round(SCAN_EDGE * ratio));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch (error) {
    return null;
  }
}

/**
 * Score one pixel for "face-likeness".
 * Bright, moderately saturated warm pixels win; pure white highlights and
 * very dark shadows are suppressed.  An upper-region bias reflects the fact
 * that portrait subjects almost always sit in the top half of a plate.
 */
function pixelScore(r, g, b, ny) {
  const brightness = (r + g + b) / (3 * 255);
  if (brightness < 0.16 || brightness > 0.985) return 0;

  const warmth = (r - b) / 255;          // skin is warmer than it is blue
  const skin = clamp((warmth - 0.04) * 2.4, 0, 1)
    * clamp((r - g + 30) / 90, 0, 1);

  const Saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  const chroma = clamp(1 - Math.abs(Saturation - 0.42) * 1.6, 0, 1);

  const upperBias = 0.55 + 0.9 * (1 - clamp(ny / 0.72, 0, 1));
  const likeness = skin * 0.62 + chroma * 0.20 + brightness * 0.18;
  return Math.max(0, likeness) * upperBias;
}

/**
 * Locate the strongest bright/skin-like cluster and return its normalized
 * centroid.  Falls back to a slightly-above-centre point on empty plates.
 */
export function detectFocus(image, options) {
  const data = scanPixels(image);
  if (!data) {
    return { x: 0.5, y: options && options.fallbackY != null ? options.fallbackY : 0.42, confidence: 0 };
  }

  const { width, height, data: bytes } = data;
  let weightSum = 0;
  let xSum = 0;
  let ySum = 0;
  let peak = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const score = pixelScore(bytes[i], bytes[i + 1], bytes[i + 2], y / height);
      if (score <= 0.02) continue;
      const weight = score * score; // sharpen the cluster, ignore weak noise
      weightSum += weight;
      xSum += (x + 0.5) * weight;
      ySum += (y + 0.5) * weight;
      if (score > peak) peak = score;
    }
  }

  if (weightSum < 1e-4) {
    return { x: 0.5, y: options && options.fallbackY != null ? options.fallbackY : 0.42, confidence: 0 };
  }

  return {
    x: clamp(xSum / weightSum / width, 0.06, 0.94),
    y: clamp(ySum / weightSum / height, 0.06, 0.94),
    confidence: clamp(peak, 0, 1),
  };
}

/**
 * Compute the crop that places the detected focus at `options.focusY` of the
 * panel (default 0.34), keeping it below the badge/header band.
 *
 * Returns { x, y, zoom, focus, confidence }.  x and y are in [-1, 1] and use
 * the same pan convention as render.js.  Safe to call before any photo has
 * loaded: it degrades to a neutral centred crop.
 */
export function faceAwareCrop(image, rect, options) {
  const opts = options || {};
  const panel = rect || { x: 0, y: 0, w: 1, h: 1 };
  const focus = detectFocus(image, opts);
  const targetY = clamp(opts.focusY == null ? 0.34 : opts.focusY, 0.1, 0.9);

  const size = imageSize(image);
  if (!size.w || !size.h || !panel.w || !panel.h) {
    return { x: 0, y: 0, zoom: 1, focus, confidence: focus.confidence };
  }

  const baseZoom = clamp(opts.zoom == null ? 1 : opts.zoom, 1, 3);
  // Give ourselves enough crop headroom to actually move an off-centre face.
  const need = Math.max(Math.abs(focus.x - 0.5) * 2, Math.abs(focus.y - targetY) * 2);
  const zoom = clamp(baseZoom + need * 0.32 * focus.confidence, 1, 3);

  const scale = Math.max(panel.w / size.w, panel.h / size.h) * zoom;
  const drawW = size.w * scale;
  const drawH = size.h * scale;
  const extraX = Math.max(0, (drawW - panel.w) / 2);
  const extraY = Math.max(0, (drawH - panel.h) / 2);

  const x = extraX > 0.5
    ? clamp((focus.x * drawW - 0.5 * panel.w - extraX) / extraX, -1, 1)
    : 0;
  const y = extraY > 0.5
    ? clamp((focus.y * drawH - targetY * panel.h - extraY) / extraY, -1, 1)
    : 0;

  // A weak detection gets a gentle upward nudge so faces are not hidden by
  // the title band even when no skin-like cluster was found.
  const finalY = focus.confidence < 0.08 ? clamp(y + 0.12, -1, 1) : y;

  return {
    x: Number(x.toFixed(4)),
    y: Number(finalY.toFixed(4)),
    zoom: Number(zoom.toFixed(4)),
    focus,
    confidence: focus.confidence,
  };
}

/** Neutral crop used as a deterministic fallback by callers. */
export function centeredCrop(zoom) {
  return { x: 0, y: 0, zoom: clamp(zoom == null ? 1 : zoom, 1, 3), focus: { x: 0.5, y: 0.5 }, confidence: 0 };
}

/** Human-readable crop summary, useful for debugging the compositor. */
export function describeCrop(crop) {
  if (!crop) return 'no crop';
  return `pan(${crop.x.toFixed(2)}, ${crop.y.toFixed(2)}) zoom ${crop.zoom.toFixed(2)}`;
}

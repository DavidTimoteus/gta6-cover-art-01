/*
 * Print-effects engine.
 *
 * The image algorithms in this file are pure: they accept an ImageData and
 * return a brand-new ImageData, never mutating their input and never relying
 * on Math.random.  Noise is driven by a seeded generator, so a given poster
 * renders pixel-identically every time.  The three `apply*` exports are thin
 * canvas adapters around those pure routines for the live editor.
 */

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function makeImageData(data, width, height) {
  if (typeof ImageData !== 'undefined') return new ImageData(data, width, height);
  return { data, width, height };
}

function cloneData(source) {
  return new Uint8ClampedArray(source.data);
}

/** Small, fast, seedable pseudo-random generator (mulberry32). */
export function makeRandom(seed = 1) {
  let state = (finite(seed, 1) >>> 0) || 1;
  return function next() {
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a few numbers into a stable integer seed without floating drift. */
export function seedFrom(...parts) {
  let hash = 2166136261;
  parts.forEach((part) => {
    const text = String(part);
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 0x9E3779B9;
  });
  return (hash >>> 0) || 1;
}

function asRgb(color, fallback) {
  if (Array.isArray(color) && color.length >= 3) {
    return [
      clamp(finite(color[0], fallback[0]), 0, 255),
      clamp(finite(color[1], fallback[1]), 0, 255),
      clamp(finite(color[2], fallback[2]), 0, 255)
    ];
  }
  if (color && Number.isFinite(color.r)) {
    return [
      clamp(color.r, 0, 255),
      clamp(finite(color.g, fallback[1]), 0, 255),
      clamp(finite(color.b, fallback[2]), 0, 255)
    ];
  }
  return fallback;
}

/* ------------------------------------------------------------------ *
 * pure image transforms
 * ------------------------------------------------------------------ */

/** Posterize each RGB channel into a small number of flat ink levels. */
export function posterize(imageData, levels = 4) {
  const total = Math.round(clamp(finite(levels, 4), 2, 32));
  const step = 255 / (total - 1);
  const output = cloneData(imageData);
  for (let i = 0; i < output.length; i += 4) {
    output[i] = Math.round(output[i] / step) * step;
    output[i + 1] = Math.round(output[i + 1] / step) * step;
    output[i + 2] = Math.round(output[i + 2] / step) * step;
  }
  return makeImageData(output, imageData.width, imageData.height);
}

/**
 * Classic rotated halftone screen.  Each pixel is mapped into a rotated cell;
 * the cell's average luminance sets the dot radius, and pixels inside the dot
 * take the ink colour while the rest take the paper colour.
 */
export function halftone(imageData, options = {}) {
  const width = imageData.width;
  const height = imageData.height;
  const pitch = Math.max(3, Math.round(finite(options.pitch, 6)));
  const angle = finite(options.angle, 45) * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const ink = asRgb(options.ink, [27, 16, 53]);
  const paper = asRgb(options.paper, [255, 230, 154]);
  const strength = clamp(finite(options.strength, 1), 0, 1.5);
  const source = imageData.data;
  const output = new Uint8ClampedArray(source.length);

  const sums = new Float64Array(width * height);
  const counts = new Uint32Array(width * height);
  const cellKey = new Int32Array(width * height);
  const localX = new Float32Array(width * height);
  const localY = new Float32Array(width * height);

  const centerX = width / 2;
  const centerY = height / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const px = x - centerX;
      const py = y - centerY;
      const u = px * cos + py * sin;
      const v = -px * sin + py * cos;
      const cx = Math.floor(u / pitch);
      const cy = Math.floor(v / pitch);
      const key = (cx + 4096) * 8192 + (cy + 4096);

      cellKey[index] = key;
      localX[index] = u - (cx + 0.5) * pitch;
      localY[index] = v - (cy + 0.5) * pitch;

      const offset = index * 4;
      const luma = 0.299 * source[offset]
        + 0.587 * source[offset + 1]
        + 0.114 * source[offset + 2];
      sums[index] += luma;
      counts[index] += 1;
    }
  }

  // The cells are indexed sparsely, so a Map is cheaper than a huge array.
  const averages = new Map();
  for (let i = 0; i < sums.length; i += 1) {
    const key = cellKey[i];
    const entry = averages.get(key);
    if (entry) {
      entry.sum += sums[i];
      entry.count += counts[i];
    } else {
      averages.set(key, { sum: sums[i], count: counts[i] });
    }
  }

  const radiusBase = pitch * 0.5 * strength;
  for (let i = 0; i < cellKey.length; i += 1) {
    const entry = averages.get(cellKey[i]);
    const mean = entry && entry.count ? entry.sum / entry.count : 128;
    const coverage = clamp(1 - mean / 255, 0, 1);
    const radius = radiusBase * Math.sqrt(coverage);
    const distance = Math.hypot(localX[i], localY[i]);
    const edge = clamp(radius - distance + 0.75, 0, 1);
    const offset = i * 4;
    output[offset] = paper[0] * (1 - edge) + ink[0] * edge;
    output[offset + 1] = paper[1] * (1 - edge) + ink[1] * edge;
    output[offset + 2] = paper[2] * (1 - edge) + ink[2] * edge;
    output[offset + 3] = source[offset + 3];
  }

  return makeImageData(output, width, height);
}

/** Add fine monochrome paper grain using the deterministic RNG. */
export function grain(imageData, options = {}) {
  const random = makeRandom(options.seed == null ? 1337 : options.seed);
  const amount = clamp(finite(options.amount, 0.2), 0, 1);
  const output = cloneData(imageData);
  const scale = amount * 96;
  for (let i = 0; i < output.length; i += 4) {
    const noise = (random() - 0.5) * scale;
    output[i] += noise;
    output[i + 1] += noise;
    output[i + 2] += noise;
  }
  return makeImageData(output, imageData.width, imageData.height);
}

/**
 * Two-plate channel offset.  The red plate drifts one way and the blue plate
 * the other, producing the faint colour fringe of an unpressed print.
 */
export function channelOffset(imageData, options = {}) {
  const width = imageData.width;
  const height = imageData.height;
  const dx = Math.round(clamp(finite(options.dx, 1.5), -24, 24));
  const dy = Math.round(clamp(finite(options.dy, 0.5), -24, 24));
  const source = imageData.data;
  const output = new Uint8ClampedArray(source.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const rx = clamp(x - dx, 0, width - 1);
      const ry = clamp(y - dy, 0, height - 1);
      const bx = clamp(x + dx, 0, width - 1);
      const by = clamp(y + dy, 0, height - 1);
      const redIndex = (ry * width + rx) * 4;
      const blueIndex = (by * width + bx) * 4;
      output[offset] = source[redIndex];
      output[offset + 1] = source[offset + 1];
      output[offset + 2] = source[blueIndex];
      output[offset + 3] = source[offset + 3];
    }
  }
  return makeImageData(output, width, height);
}

/** Composite finishing pass: flat ink, screen, plate drift, then grain. */
export function finishImageData(imageData, options = {}) {
  const levels = options.levels == null ? 4 : options.levels;
  const screened = halftone(posterize(imageData, levels), options.halftone || {});
  const shifted = channelOffset(screened, options.misregister || {});
  return grain(shifted, options.grain || {});
}

export const finishingPass = finishImageData;

/* ------------------------------------------------------------------ *
 * canvas adapters used by the live editor
 * ------------------------------------------------------------------ */

function readRegion(ctx, x, y, w, h) {
  try {
    return ctx.getImageData(x, y, w, h);
  } catch (error) {
    return null;
  }
}

function writeRegion(ctx, data, x, y) {
  try {
    ctx.putImageData(data, x, y);
    return true;
  } catch (error) {
    return false;
  }
}

export function applyHalftone(ctx, x, y, w, h, options = {}) {
  if (!ctx) return null;
  const canvas = ctx.canvas || { width: 0, height: 0 };
  const left = Math.max(0, Math.floor(finite(x, 0)));
  const top = Math.max(0, Math.floor(finite(y, 0)));
  const right = Math.min(canvas.width, Math.ceil(finite(x, 0) + finite(w, 0)));
  const bottom = Math.min(canvas.height, Math.ceil(finite(y, 0) + finite(h, 0)));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return null;

  const region = readRegion(ctx, left, top, width, height);
  if (!region) return null;
  const result = halftone(region, options);
  writeRegion(ctx, result, left, top);
  return result;
}

export function applyGrain(ctx, width = 0, height = 0, options = {}) {
  if (!ctx) return null;
  const canvas = ctx.canvas || { width, height };
  const w = Math.max(1, Math.round(finite(width, canvas.width)));
  const h = Math.max(1, Math.round(finite(height, canvas.height)));
  const region = readRegion(ctx, 0, 0, w, h);
  if (!region) return null;
  const result = grain(region, options);
  writeRegion(ctx, result, 0, 0);
  return result;
}

export function applyMisregistration(ctx, options = {}) {
  if (!ctx) return null;
  const canvas = ctx.canvas || {};
  const w = Math.round(finite(options.width, canvas.width || 0));
  const h = Math.round(finite(options.height, canvas.height || 0));
  if (w <= 0 || h <= 0) return null;
  const region = readRegion(ctx, 0, 0, w, h);
  if (!region) return null;
  const result = channelOffset(region, options);
  writeRegion(ctx, result, 0, 0);
  return result;
}

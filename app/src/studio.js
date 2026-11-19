/**
 * studio.js
 * ---------
 * An original, dependency-free print-finishing toolkit for the cover-art
 * studio. Everything here operates on plain ImageData-shaped objects
 * ({ data: Uint8ClampedArray, width, height }), so the same functions run
 * unchanged in a browser canvas pipeline and in a plain Node.js test harness.
 *
 * The toolkit is intentionally split into small, composable stages:
 *   1. numeric primitives            (clamp, lerp, noise, ...)
 *   2. ImageData helpers             (create / clone)
 *   3. posterize                     (flat ink levels)
 *   4. halftone                      (rotated dot screening)
 *   5. misregister                   (two-plate colour offset)
 *   6. paperGrain                    (deterministic stock texture)
 *   7. named print presets           (PRINT_PRESETS / resolvePreset)
 *   8. contrast ramp builder         (buildContrastRamp / rampToImageData)
 *   9. applyPrintFinish              (runs the whole chain)
 *
 * No existing project source was consulted while authoring this file; the
 * algorithms below are independent implementations written from scratch.
 */

/* ==========================================================================
 * 1. Numeric primitives
 * ========================================================================== */

/** Clamp a finite number into the closed interval [lo, hi]. NaNs map to lo. */
export function clamp(n, lo, hi) {
  if (Number.isNaN(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}

/** Round a number to the nearest integer and clamp it to an 8-bit channel. */
export function clampByte(n) {
  const v = Math.round(n);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Linear interpolation: a when t = 0, b when t = 1. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Cubic smoothstep easing; flattens both ends of a 0..1 ramp. */
export function smoothstep(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Rec. 709 perceptual luminance of an RGB triplet, in the range 0..255. */
export function srgbLuma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Mulberry32: a tiny deterministic PRNG. Equal seeds produce equal streams,
 * which keeps grain reproducible across renders and across machines.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic 2D value noise in [0, 1). Derived from integer coordinates
 * and a seed via integer hashing, so it is stable and cheap per pixel.
 */
export function hashNoise(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^
          Math.imul(y | 0, 668265263) ^
          Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/* ==========================================================================
 * 2. ImageData helpers (work in a browser and in plain Node)
 * ========================================================================== */

/**
 * Allocate an ImageData-shaped object. Uses the native ImageData constructor
 * when one is available, otherwise falls back to a structural object so that
 * this module can be unit-tested outside a DOM.
 */
export function createImageData(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  if (typeof ImageData !== 'undefined') {
    try {
      return new ImageData(data, width, height);
    } catch (_err) {
      // Some environments expose a constructor that rejects typed arrays.
    }
  }
  return { data, width, height };
}

/** Return a deep-enough copy of an ImageData-shaped object. */
export function cloneImageData(src) {
  const out = createImageData(src.width, src.height);
  out.data.set(src.data);
  return out;
}

/* ==========================================================================
 * 3. Posterize — reduce an image to a handful of flat ink levels
 * ========================================================================== */

/**
 * Quantize every RGB channel into `levels` evenly spaced steps. A gamma
 * exponent can bias the steps toward shadows or highlights before quantization.
 * Alpha is preserved unless `preserveAlpha` is explicitly set to false.
 *
 * @param {object} imageData source pixels
 * @param {object} options   { levels, gamma, preserveAlpha }
 * @returns {object} a new ImageData-shaped buffer
 */
export function posterize(imageData, options = {}) {
  const levels = clamp(Math.floor(options.levels ?? 4), 2, 256);
  const gamma = Math.max(0.05, options.gamma ?? 1);
  const preserveAlpha = options.preserveAlpha ?? true;
  const out = cloneImageData(imageData);
  const src = imageData.data;
  const dst = out.data;
  const buckets = levels - 1;

  // Build a 256-entry lookup table once instead of calling pow() per channel.
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v += 1) {
    const shaped = Math.pow(v / 255, gamma);
    lut[v] = clampByte((Math.round(shaped * buckets) / buckets) * 255);
  }

  for (let i = 0; i < src.length; i += 4) {
    dst[i] = lut[src[i]];
    dst[i + 1] = lut[src[i + 1]];
    dst[i + 2] = lut[src[i + 2]];
    dst[i + 3] = preserveAlpha ? src[i + 3] : 255;
  }
  return out;
}

/* ==========================================================================
 * 4. Halftone — rotated dot screening
 * ========================================================================== */

/**
 * Convert continuous tone into a grid of dots on a rotated screen. Each cell
 * of the screen carries the average luminance of the source pixels that fall
 * inside it; darker cells grow larger dots. The screen angle and dot pitch
 * (cell size in pixels) are both adjustable, as are the ink and paper colours.
 *
 * `dotGain` fakes physical ink spread by biasing coverage upward, and
 * `softness` (in pixels) antialiases the dot edge when greater than zero.
 *
 * @param {object} imageData source pixels
 * @param {object} options   { angle, pitch, ink, paper, dotGain, softness, seed }
 * @returns {object} a new ImageData-shaped buffer
 */
export function halftone(imageData, options = {}) {
  const angle = options.angle ?? 45;
  const pitch = Math.max(2, options.pitch ?? 6);
  const ink = options.ink ?? [18, 18, 20];
  const paper = options.paper ?? [244, 239, 226];
  const dotGain = options.dotGain ?? 0;
  const softness = Math.max(0, options.softness ?? 0);

  const w = imageData.width;
  const h = imageData.height;
  const out = cloneImageData(imageData);
  const src = imageData.data;
  const dst = out.data;

  const theta = (angle * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const cx = w / 2;
  const cy = h / 2;

  // Cells are indexed with a bias so negative screen coordinates stay in range.
  const diag = Math.hypot(w, h);
  const bias = Math.ceil(diag / pitch) + 2;
  const side = bias * 2 + 2;
  const sums = new Float64Array(side * side);
  const counts = new Uint32Array(side * side);

  // Cached per-pixel screen coordinates and cell indices (two passes).
  const coordU = new Float32Array(w * h);
  const coordV = new Float32Array(w * h);
  const cellXs = new Int32Array(w * h);
  const cellYs = new Int32Array(w * h);

  const cellIndex = (gx, gy) => (gx + bias) * side + (gy + bias);

  // Pass 1: rotate each pixel into screen space and accumulate cell tone.
  let p = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1, p += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      const gx = Math.floor(u / pitch);
      const gy = Math.floor(v / pitch);
      coordU[p] = u;
      coordV[p] = v;
      cellXs[p] = gx;
      cellYs[p] = gy;
      const tone = srgbLuma(src[p * 4], src[p * 4 + 1], src[p * 4 + 2]) / 255;
      const idx = cellIndex(gx, gy);
      if (idx >= 0 && idx < sums.length) {
        sums[idx] += tone;
        counts[idx] += 1;
      }
    }
  }

  // Pass 2: paint ink where the pixel falls inside its cell's dot.
  p = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1, p += 1) {
      const gx = cellXs[p];
      const gy = cellYs[p];
      const idx = cellIndex(gx, gy);
      const tone = counts[idx] ? sums[idx] / counts[idx] : 0;
      const darkness = clamp(1 - tone + dotGain, 0, 1);
      const radius = (pitch * 0.5) * Math.sqrt(darkness);
      const centreU = (gx + 0.5) * pitch;
      const centreV = (gy + 0.5) * pitch;
      const dist = Math.hypot(coordU[p] - centreU, coordV[p] - centreV);

      let coverage;
      if (softness <= 0) {
        coverage = dist <= radius ? 1 : 0;
      } else {
        coverage = clamp((radius + softness - dist) / (2 * softness), 0, 1);
      }

      const o = p * 4;
      dst[o] = clampByte(lerp(paper[0], ink[0], coverage));
      dst[o + 1] = clampByte(lerp(paper[1], ink[1], coverage));
      dst[o + 2] = clampByte(lerp(paper[2], ink[2], coverage));
      dst[o + 3] = 255;
    }
  }
  return out;
}

/* ==========================================================================
 * 5. Two-plate colour misregistration
 * ========================================================================== */

/**
 * Simulate two printing plates that are slightly out of register by sampling
 * a second, spatially offset copy of the image and mixing its channels back
 * into the base. Green (cyan plate) shifts the most, red and blue partially,
 * producing the familiar colour fringe along edges.
 *
 * @param {object} imageData source pixels
 * @param {object} options   { dx, dy, strength }
 * @returns {object} a new ImageData-shaped buffer
 */
export function misregister(imageData, options = {}) {
  const dx = Math.round(options.dx ?? 2);
  const dy = Math.round(options.dy ?? 1);
  const strength = clamp(options.strength ?? 1, 0, 1);
  const w = imageData.width;
  const h = imageData.height;
  const out = cloneImageData(imageData);
  const src = imageData.data;
  const dst = out.data;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      const sx = clamp(x + dx, 0, w - 1);
      const sy = clamp(y + dy, 0, h - 1);
      const so = (sy * w + sx) * 4;

      dst[o] = clampByte(lerp(src[o], src[so], 0.5 * strength));
      dst[o + 1] = clampByte(lerp(src[o + 1], src[so + 1], strength));
      dst[o + 2] = clampByte(lerp(src[o + 2], src[so + 2], 0.75 * strength));
      dst[o + 3] = src[o + 3];
    }
  }
  return out;
}

/* ==========================================================================
 * 6. Paper grain — deterministic stock texture
 * ========================================================================== */

/**
 * Lay a fine, repeatable noise field over the image to imitate the tooth of
 * printed paper. By default the noise is monochrome; set `monochrome: false`
 * for subtle per-channel colour speckle. `scale` controls feature size and
 * `seed` makes the texture reproducible.
 *
 * @param {object} imageData source pixels
 * @param {object} options   { amount, scale, seed, monochrome }
 * @returns {object} a new ImageData-shaped buffer
 */
export function paperGrain(imageData, options = {}) {
  const amount = Math.max(0, options.amount ?? 10);
  const scale = Math.max(0.05, options.scale ?? 1);
  const seed = options.seed ?? 7;
  const monochrome = options.monochrome ?? true;
  const w = imageData.width;
  const h = imageData.height;
  const out = cloneImageData(imageData);
  const src = imageData.data;
  const dst = out.data;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      const gx = Math.floor(x * scale);
      const gy = Math.floor(y * scale);
      const n = (hashNoise(gx, gy, seed) - 0.5) * 2 * amount;

      if (monochrome) {
        dst[o] = clampByte(src[o] + n);
        dst[o + 1] = clampByte(src[o + 1] + n);
        dst[o + 2] = clampByte(src[o + 2] + n);
      } else {
        const n1 = (hashNoise(gx + 101, gy - 57, seed + 1) - 0.5) * 2 * amount;
        const n2 = (hashNoise(gx - 83, gy + 131, seed + 2) - 0.5) * 2 * amount;
        dst[o] = clampByte(src[o] + n);
        dst[o + 1] = clampByte(src[o + 1] + n1);
        dst[o + 2] = clampByte(src[o + 2] + n2);
      }
      dst[o + 3] = src[o + 3];
    }
  }
  return out;
}

/* ==========================================================================
 * 7. Named print presets
 * ========================================================================== */

/**
 * A small library of ready-made finishing recipes. Each preset carries the
 * option object for every stage; `enabled` toggles that stage in the pipeline.
 */
export const PRINT_PRESETS = Object.freeze({
  newspaper: {
    label: 'Rough newsprint',
    posterize: { enabled: true, levels: 3, gamma: 1 },
    halftone: { enabled: true, angle: 45, pitch: 5, ink: [38, 34, 30], paper: [230, 221, 202], dotGain: 0.08, softness: 0 },
    misregister: { enabled: true, dx: 1, dy: 0, strength: 0.5 },
    grain: { enabled: true, amount: 14, scale: 1, seed: 3, monochrome: true }
  },
  risograph: {
    label: 'Two-colour riso',
    posterize: { enabled: true, levels: 4, gamma: 0.9 },
    halftone: { enabled: true, angle: 30, pitch: 7, ink: [210, 58, 74], paper: [248, 244, 233], dotGain: 0.04, softness: 0.5 },
    misregister: { enabled: true, dx: 3, dy: 2, strength: 0.8 },
    grain: { enabled: true, amount: 8, scale: 0.8, seed: 11, monochrome: false }
  },
  screenprint: {
    label: 'Bold screen print',
    posterize: { enabled: true, levels: 2, gamma: 1.1 },
    halftone: { enabled: false, angle: 22.5, pitch: 9, ink: [20, 20, 24], paper: [240, 236, 224], dotGain: 0.12, softness: 0 },
    misregister: { enabled: true, dx: 2, dy: 2, strength: 0.7 },
    grain: { enabled: true, amount: 6, scale: 1.5, seed: 5, monochrome: true }
  },
  offset: {
    label: 'Clean offset litho',
    posterize: { enabled: false, levels: 6, gamma: 1 },
    halftone: { enabled: true, angle: 15, pitch: 4, ink: [24, 24, 28], paper: [250, 249, 245], dotGain: 0.02, softness: 0.75 },
    misregister: { enabled: false, dx: 1, dy: 1, strength: 0.35 },
    grain: { enabled: true, amount: 3, scale: 2, seed: 17, monochrome: true }
  },
  comic: {
    label: 'Comic book halftone',
    posterize: { enabled: true, levels: 5, gamma: 0.85 },
    halftone: { enabled: true, angle: 45, pitch: 6, ink: [26, 24, 32], paper: [246, 240, 225], dotGain: 0.06, softness: 0 },
    misregister: { enabled: true, dx: 2, dy: 0, strength: 0.6 },
    grain: { enabled: false, amount: 5, scale: 1, seed: 9, monochrome: true }
  }
});

/** Shallow-copy a preset so callers never mutate the frozen originals. */
function clonePreset(preset) {
  const out = {};
  for (const key of Object.keys(preset)) {
    const value = preset[key];
    out[key] = value && typeof value === 'object' ? { ...value } : value;
  }
  return out;
}

/**
 * Accept either a preset name, a config object with a `preset` name plus
 * per-stage overrides, or a raw config object. Always returns a fresh object.
 */
export function resolvePreset(input) {
  if (typeof input === 'string') {
    const preset = PRINT_PRESETS[input];
    if (!preset) throw new Error(`Unknown print preset: ${input}`);
    return clonePreset(preset);
  }
  if (input && typeof input === 'object' && typeof input.preset === 'string') {
    const base = resolvePreset(input.preset);
    for (const key of Object.keys(input)) {
      if (key === 'preset') continue;
      const incoming = input[key];
      if (base[key] && typeof base[key] === 'object' &&
          incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
        base[key] = { ...base[key], ...incoming };
      } else {
        base[key] = incoming;
      }
    }
    return base;
  }
  return input && typeof input === 'object' ? { ...input } : null;
}

/* ==========================================================================
 * 8. Contrast ramp builder
 * ========================================================================== */

/**
 * Build a tonal ramp of `steps` swatches. A linear contrast/brightness curve
 * and a gamma exponent are applied around mid grey, then the result is mapped
 * from `dark` to `light`. Each entry exposes its normalized position, level,
 * RGB triplet and a CSS colour string.
 *
 * @param {number} steps  number of swatches (2..1024)
 * @param {object} options { contrast, brightness, gamma, dark, light }
 * @returns {Array<object>} the ramp entries
 */
export function buildContrastRamp(steps = 8, options = {}) {
  const count = clamp(Math.floor(steps), 2, 1024);
  const contrast = options.contrast ?? 1.2;
  const brightness = options.brightness ?? 0;
  const gamma = Math.max(0.05, options.gamma ?? 1);
  const dark = options.dark ?? [12, 12, 16];
  const light = options.light ?? [244, 240, 230];
  const ramp = [];

  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    let s = (t - 0.5) * contrast + 0.5 + brightness;
    s = clamp(s, 0, 1);
    s = Math.pow(s, gamma);
    const rgb = [
      clampByte(lerp(dark[0], light[0], s)),
      clampByte(lerp(dark[1], light[1], s)),
      clampByte(lerp(dark[2], light[2], s))
    ];
    ramp.push({
      index: i,
      t,
      level: clampByte(s * 255),
      rgb,
      css: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
    });
  }
  return ramp;
}

/** Render a ramp produced by buildContrastRamp into a swatch-strip ImageData. */
export function rampToImageData(ramp, height = 24) {
  const w = Math.max(1, ramp.length);
  const h = Math.max(1, Math.floor(height));
  const out = createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const rgb = ramp[x].rgb;
      const o = (y * w + x) * 4;
      out.data[o] = rgb[0];
      out.data[o + 1] = rgb[1];
      out.data[o + 2] = rgb[2];
      out.data[o + 3] = 255;
    }
  }
  return out;
}

/* ==========================================================================
 * 9. Apply the whole finishing chain
 * ========================================================================== */

/**
 * Run the enabled finishing stages over a copy of the input buffer, in the
 * order: posterize -> halftone -> misregister -> paper grain. Options may be
 * a preset name, a preset-plus-overrides object, or a raw per-stage config.
 * The source buffer is never modified.
 *
 * @param {object} imageData source pixels
 * @param {object|string} options finish configuration
 * @returns {object} a new, fully finished ImageData-shaped buffer
 */
export function applyPrintFinish(imageData, options = {}) {
  const cfg = resolvePreset(options) || {};
  const posterizeCfg = cfg.posterize || { enabled: false };
  const halftoneCfg = cfg.halftone || { enabled: false };
  const misCfg = cfg.misregister || { enabled: false };
  const grainCfg = cfg.grain || { enabled: false };

  let work = cloneImageData(imageData);
  if (posterizeCfg.enabled) work = posterize(work, posterizeCfg);
  if (halftoneCfg.enabled) work = halftone(work, halftoneCfg);
  if (misCfg.enabled) work = misregister(work, misCfg);
  if (grainCfg.enabled) work = paperGrain(work, grainCfg);
  return work;
}

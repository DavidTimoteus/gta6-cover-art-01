/*
 * studio.js — Print-finishing toolkit for the cover-art studio.
 * ------------------------------------------------------------------
 * This module is an original implementation written from scratch for the
 * editor. It provides a small, composable set ofImageData processors that
 * emulate analogue print finishing: halftone dot screening, posterisation
 * into flat ink levels, paper grain, two-plate colour misregistration, a
 * tonal contrast-ramp builder, and named press presets. Every processor is
 * pure: it returns a fresh ImageData and never mutates its input.
 *
 * The intended pipeline (see `applyPrintFinish`) is:
 *   misregister -> posterize -> halftone -> grain -> ramp overlay
 * which mirrors the order a real print shop would separate and lay down ink.
 */

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

/** Clamp a value into the inclusive range [lo, hi]. */
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Clamp a value to a whole-byte 0..255 integer (safe for ImageData writes). */
export const clampByte = (v) => clamp(Math.round(v), 0, 255);

/** Linear interpolation between a and b by factor t. */
export const lerp = (a, b, t) => a + (b - a) * t;

/** Convert degrees to radians. */
export const toRadians = (deg) => (deg * Math.PI) / 180;

/** Fractional part of a number (always >= 0). */
const fract = (x) => x - Math.floor(x);

/**
 * Rec. 709 relative luminance from an RGB triplet, on a 0..255 scale.
 * Used both by the halftone sampler and by the grain shadow mask.
 */
export function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Deterministic pseudo-random generator (mulberry32). Seeding keeps grain
 * and noise reproducible across renders so exports do not flicker.
 */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build an ImageData-like object, tolerating environments without the global. */
function newImageData(data, width, height) {
  if (typeof ImageData !== "undefined") return new ImageData(data, width, height);
  return { data, width, height };
}

/** Return a deep copy of an ImageData so callers keep their original buffer. */
export function cloneImageData(src) {
  return newImageData(new Uint8ClampedArray(src.data), src.width, src.height);
}

/**
 * Nearest-neighbour sample of a source buffer with edge clamping. Writes the
 * sampled RGB into `out` (a 3-slot scratch array) to avoid per-pixel garbage.
 */
function sampleClamped(data, w, h, x, y, out) {
  const xi = clamp(Math.round(x), 0, w - 1);
  const yi = clamp(Math.round(y), 0, h - 1);
  const i = (yi * w + xi) * 4;
  out[0] = data[i];
  out[1] = data[i + 1];
  out[2] = data[i + 2];
  return out;
}

// ---------------------------------------------------------------------------
// Posterize — collapse continuous tone into a few flat ink levels
// ---------------------------------------------------------------------------

/**
 * Quantise each RGB channel into `levels` discrete steps.
 *
 * @param {ImageData} src      source buffer (left untouched)
 * @param {number}    levels   number of flat levels (2..32), e.g. 4
 * @param {object}    options  { keepAlpha: boolean }
 * @returns {ImageData}
 */
export function posterize(src, levels = 4, options = {}) {
  const n = clamp(Math.round(levels), 2, 32);
  const keepAlpha = options.keepAlpha !== false;
  const out = cloneImageData(src);
  const d = out.data;
  const step = 255 / (n - 1);

  for (let i = 0; i < d.length; i += 4) {
    d[i] = clampByte(Math.round(d[i] / step) * step);
    d[i + 1] = clampByte(Math.round(d[i + 1] / step) * step);
    d[i + 2] = clampByte(Math.round(d[i + 2] / step) * step);
    if (!keepAlpha) d[i + 3] = 255;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Halftone — rotating dot screen with adjustable angle and dot pitch
// ---------------------------------------------------------------------------

/**
 * Render a classical amplitude-modulated halftone screen.
 *
 * The image is sampled on a grid rotated by `angle` degrees. Each grid cell
 * becomes a round dot whose radius encodes the local ink coverage: dark
 * source regions yield large dots, light regions small dots. `pitch` is the
 * cell size in device pixels, so smaller values produce a finer screen.
 *
 * @param {ImageData} src
 * @param {object} options
 *   angle      screen rotation in degrees (default 45)
 *   pitch      cell size in pixels (default 6)
 *   ink        RGB triplet for the dot colour
 *   paper      RGB triplet for the background (unprinted) colour
 *   gamma      tone curve applied before sizing dots (default 1)
 *   invert     swap ink and paper roles
 *   antialias  soften dot edges with a one-pixel ramp
 * @returns {ImageData}
 */
export function halftone(src, options = {}) {
  const {
    angle = 45,
    pitch = 6,
    ink = [22, 22, 26],
    paper = [244, 239, 226],
    gamma = 1,
    invert = false,
    antialias = true,
  } = options;

  const out = cloneImageData(src);
  const od = out.data;
  const sd = src.data;
  const w = src.width;
  const h = src.height;
  const theta = toRadians(angle);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const cell = Math.max(2, pitch);
  const half = cell / 2;
  const scratch = [0, 0, 0];

  // One tone sample per cell is enough; cache it to avoid repeated sampling.
  const toneCache = new Map();

  function cellCoverage(cx, cy) {
    const key = cx * 65536 + cy;
    const hit = toneCache.get(key);
    if (hit !== undefined) return hit;

    // Cell centre in rotated coordinates, then back to image coordinates.
    const uc = (cx + 0.5) * cell;
    const vc = (cy + 0.5) * cell;
    const px = uc * cos - vc * sin;
    const py = uc * sin + vc * cos;

    sampleClamped(sd, w, h, px, py, scratch);
    let light = luma(scratch[0], scratch[1], scratch[2]) / 255;
    light = clamp(Math.pow(light, gamma), 0, 1);
    const coverage = invert ? light : 1 - light;
    toneCache.set(key, coverage);
    return coverage;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Rotate pixel into screen space.
      const u = x * cos + y * sin;
      const v = -x * sin + y * cos;
      const cx = Math.floor(u / cell);
      const cy = Math.floor(v / cell);

      const coverage = cellCoverage(cx, cy);
      const radius = Math.sqrt(coverage) * half;

      // Distance from this pixel to the centre of its cell (screen space).
      const du = u - (cx + 0.5) * cell;
      const dv = v - (cy + 0.5) * cell;
      const dist = Math.sqrt(du * du + dv * dv);

      let mix;
      if (antialias) {
        mix = clamp(radius - dist + 0.75, 0, 1);
      } else {
        mix = dist <= radius ? 1 : 0;
      }

      const i = (y * w + x) * 4;
      od[i] = lerp(paper[0], ink[0], mix);
      od[i + 1] = lerp(paper[1], ink[1], mix);
      od[i + 2] = lerp(paper[2], ink[2], mix);
      od[i + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Paper grain — deterministic, luminance-aware noise
// ---------------------------------------------------------------------------

/**
 * Overlay fine paper grain. A coarse noise grid (controlled by `scale`) is
 * bilinearly-free sampled by nearest cell so the texture reads like fibres
 * rather than pure per-pixel static. Grain is reduced in highlights via a
 * shadow mask, mimicking how tooth shows more in dark ink areas.
 *
 * @param {ImageData} src
 * @param {object} options
 *   amount  peak noise amplitude in byte units (default 16)
 *   seed    PRNG seed for repeatability
 *   scale   grain block size in pixels (1 = fine)
 *   color   warm/cool bias, -1..1 (default 0.5 warm)
 *   shade   enable the luminance shadow mask
 * @returns {ImageData}
 */
export function paperGrain(src, options = {}) {
  const {
    amount = 16,
    seed = 20240614,
    scale = 1,
    color = 0.5,
    shade = true,
  } = options;

  const out = cloneImageData(src);
  const d = out.data;
  const w = src.width;
  const h = src.height;
  const s = Math.max(1, Math.floor(scale));
  const rng = makeRng(seed);

  const gw = Math.ceil(w / s) + 1;
  const gh = Math.ceil(h / s) + 1;
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = (rng() - 0.5) * 2;

  const bias = clamp(color, -1, 1);

  for (let y = 0; y < h; y++) {
    const gy = (y / s) | 0;
    for (let x = 0; x < w; x++) {
      const gx = (x / s) | 0;
      let n = grid[gy * gw + gx] * amount;

      const idx = (y * w + x) * 4;
      if (shade) {
        const light = luma(d[idx], d[idx + 1], d[idx + 2]) / 255;
        n *= lerp(1, 0.35, light);
      }

      d[idx] = clampByte(d[idx] + n * (1 + bias * 0.2));
      d[idx + 1] = clampByte(d[idx + 1] + n);
      d[idx + 2] = clampByte(d[idx + 2] + n * (1 - bias * 0.2));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Misregistration — simulate two-plate colour offset
// ---------------------------------------------------------------------------

/**
 * Shift one separation plate relative to the base to create the characteristic
 * colour fringe of misaligned presses.
 *
 * `plate` selects which pair of channels is sampled from the shifted position:
 *   cyan    -> green + blue
 *   magenta -> red + blue
 *   yellow  -> red + green
 *
 * @param {ImageData} src
 * @param {object} options { dx, dy, strength, plate }
 * @returns {ImageData}
 */
export function misregister(src, options = {}) {
  const { dx = 2, dy = -1, strength = 0.65, plate = "cyan" } = options;
  const out = cloneImageData(src);
  const d = out.data;
  const sd = src.data;
  const w = src.width;
  const h = src.height;
  const scratch = [0, 0, 0];

  const plates = {
    cyan: [1, 2],
    magenta: [0, 2],
    yellow: [0, 1],
  };
  const channels = plates[plate] || plates.cyan;
  const k = clamp(strength, 0, 1);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      sampleClamped(sd, w, h, x - dx, y - dy, scratch);
      const i = (y * w + x) * 4;
      for (let j = 0; j < channels.length; j++) {
        const c = channels[j];
        d[i + c] = lerp(d[i + c], scratch[c], k);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Contrast ramp builder
// ---------------------------------------------------------------------------

/**
 * Build a small tonal-ramp image (a printable calibration strip) by
 * interpolating a list of colour stops horizontally.
 *
 * @param {object} options
 *   width, height  output dimensions
 *   stops          [{ pos: 0..1, color: [r,g,b] }, ...]
 *   steps          >1 quantises the ramp into discrete bands
 * @returns {ImageData}
 */
export function contrastRamp(options = {}) {
  const {
    width = 256,
    height = 24,
    steps = 0,
    stops = [
      { pos: 0, color: [18, 18, 22] },
      { pos: 0.5, color: [128, 128, 132] },
      { pos: 1, color: [246, 241, 228] },
    ],
  } = options;

  const w = Math.max(1, width | 0);
  const h = Math.max(1, height | 0);
  const out = newImageData(new Uint8ClampedArray(w * h * 4), w, h);
  const d = out.data;
  const sorted = stops.slice().sort((a, b) => a.pos - b.pos);

  function sample(t) {
    let i = 0;
    while (i < sorted.length - 1 && sorted[i + 1].pos < t) i++;
    const a = sorted[i];
    const b = sorted[Math.min(i + 1, sorted.length - 1)];
    const span = b.pos - a.pos || 1;
    const f = clamp((t - a.pos) / span, 0, 1);
    return [
      lerp(a.color[0], b.color[0], f),
      lerp(a.color[1], b.color[1], f),
      lerp(a.color[2], b.color[2], f),
    ];
  }

  for (let x = 0; x < w; x++) {
    let t = w === 1 ? 0 : x / (w - 1);
    if (steps > 1) t = Math.round(t * (steps - 1)) / (steps - 1);
    const rgb = sample(t);
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      d[i] = clampByte(rgb[0]);
      d[i + 1] = clampByte(rgb[1]);
      d[i + 2] = clampByte(rgb[2]);
      d[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Complementary helper: build an S-curve contrast lookup table as 256 bytes.
 * Useful when a caller wants to remap tones before the ramp is drawn.
 */
export function buildContrastCurve(options = {}) {
  const { contrast = 1, brightness = 0, midpoint = 0.5 } = options;
  const lut = new Uint8Array(256);
  const p = clamp(contrast, 0.1, 4);
  const mp = clamp(midpoint, 0, 1);

  for (let i = 0; i < 256; i++) {
    let x = i / 255;
    x = (x - mp) * p + mp;
    x = clamp(x + brightness, 0, 1);
    lut[i] = clampByte(x * 255);
  }
  return lut;
}

/** Composite a generated ramp strip onto a band of the source image. */
export function compositeRamp(src, ramp, options = {}) {
  const { opacity = 0.35, region = "bottom", band = 0.18 } = options;
  const out = cloneImageData(src);
  const d = out.data;
  const rd = ramp.data;
  const w = src.width;
  const h = src.height;
  const rw = ramp.width;
  const rh = ramp.height;
  const bandH = Math.max(1, Math.floor(h * clamp(band, 0.02, 1)));
  const y0 = region === "top" ? 0 : h - bandH;
  const k = clamp(opacity, 0, 1);

  for (let y = y0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const rx = Math.min(rw - 1, Math.floor((x / w) * rw));
      const ry = Math.min(rh - 1, Math.floor(((y - y0) / bandH) * rh));
      const ri = (ry * rw + rx) * 4;
      const i = (y * w + x) * 4;
      d[i] = lerp(d[i], rd[ri], k);
      d[i + 1] = lerp(d[i + 1], rd[ri + 1], k);
      d[i + 2] = lerp(d[i + 2], rd[ri + 2], k);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Named print presets
// ---------------------------------------------------------------------------

/** Frozen catalogue of press recipes. Each section maps to a processor above. */
export const PRESETS = Object.freeze({
  newsprint: Object.freeze({
    label: "Newsprint",
    misregister: { enabled: true, dx: 2, dy: -1, strength: 0.45, plate: "cyan" },
    posterize: { enabled: true, levels: 4 },
    halftone: {
      enabled: true, angle: 45, pitch: 5, gamma: 0.9,
      ink: [38, 36, 34], paper: [232, 226, 210], invert: false, antialias: true,
    },
    grain: { enabled: true, amount: 20, seed: 101, scale: 1, color: 0.6, shade: true },
    ramp: { enabled: true, width: 256, height: 20, steps: 0, composite: { opacity: 0.22, region: "bottom", band: 0.12 } },
  }),
  risograph: Object.freeze({
    label: "Risograph",
    misregister: { enabled: true, dx: 4, dy: 2, strength: 0.7, plate: "magenta" },
    posterize: { enabled: true, levels: 3 },
    halftone: {
      enabled: true, angle: 22, pitch: 7, gamma: 1.1,
      ink: [214, 62, 74], paper: [246, 240, 224], invert: false, antialias: true,
    },
    grain: { enabled: true, amount: 14, seed: 202, scale: 2, color: 0.2, shade: true },
    ramp: { enabled: true, width: 256, height: 20, steps: 3, composite: { opacity: 0.3, region: "bottom", band: 0.16 } },
  }),
  silkscreen: Object.freeze({
    label: "Silkscreen",
    misregister: { enabled: false, dx: 0, dy: 0, strength: 0, plate: "cyan" },
    posterize: { enabled: true, levels: 2 },
    halftone: {
      enabled: true, angle: 67, pitch: 9, gamma: 1.3,
      ink: [18, 18, 20], paper: [238, 232, 218], invert: false, antialias: false,
    },
    grain: { enabled: true, amount: 8, seed: 303, scale: 1, color: 0, shade: false },
    ramp: { enabled: false, width: 256, height: 20, steps: 0, composite: { opacity: 0.2, region: "bottom", band: 0.14 } },
  }),
  comicBook: Object.freeze({
    label: "Comic Book",
    misregister: { enabled: true, dx: 3, dy: -2, strength: 0.55, plate: "yellow" },
    posterize: { enabled: true, levels: 5 },
    halftone: {
      enabled: true, angle: 45, pitch: 4, gamma: 0.8,
      ink: [26, 24, 30], paper: [250, 246, 232], invert: false, antialias: true,
    },
    grain: { enabled: true, amount: 10, seed: 404, scale: 1, color: 0.4, shade: true },
    ramp: { enabled: true, width: 256, height: 18, steps: 0, composite: { opacity: 0.18, region: "top", band: 0.1 } },
  }),
  duotone: Object.freeze({
    label: "Duotone",
    misregister: { enabled: true, dx: 2, dy: 2, strength: 0.5, plate: "cyan" },
    posterize: { enabled: true, levels: 6 },
    halftone: {
      enabled: true, angle: 15, pitch: 6, gamma: 1,
      ink: [24, 46, 72], paper: [226, 214, 188], invert: false, antialias: true,
    },
    grain: { enabled: true, amount: 16, seed: 505, scale: 2, color: 0.7, shade: true },
    ramp: { enabled: true, width: 256, height: 22, steps: 0, composite: { opacity: 0.28, region: "bottom", band: 0.2 } },
  }),
});

// Mutable registry so studios can define their own recipes at runtime.
const registry = new Map(Object.entries(PRESETS));

/** List the names of all available presets. */
export function listPresets() {
  return Array.from(registry.keys());
}

/** Fetch a preset by name; falls back to newsprint when unknown. */
export function getPreset(name) {
  return registry.get(name) || PRESETS.newsprint;
}

/** Register (or replace) a named preset. Returns a copy of the stored config. */
export function registerPreset(name, config) {
  registry.set(String(name), config);
  return registry.get(String(name));
}

/** Shallow section-wise merge of a base config with caller overrides. */
function mergeConfig(base, overrides) {
  const out = {};
  for (const key of Object.keys(base)) {
    const b = base[key];
    const o = overrides[key];
    if (b && typeof b === "object" && !Array.isArray(b)) {
      out[key] = { ...b, ...(o && typeof o === "object" ? o : {}) };
    } else {
      out[key] = o !== undefined ? o : b;
    }
  }
  for (const key of Object.keys(overrides)) {
    if (!(key in out)) out[key] = overrides[key];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Master processor
// ---------------------------------------------------------------------------

/**
 * Apply a complete print finish to an ImageData buffer.
 *
 * @param {ImageData} imageData   source buffer (never mutated)
 * @param {string|object} preset  preset name or an inline config object
 * @param {object} overrides      section-wise overrides (e.g. { halftone: { pitch: 3 } })
 * @returns {ImageData} a new, fully processed buffer
 */
export function applyPrintFinish(imageData, preset = "newsprint", overrides = {}) {
  const base = typeof preset === "string" ? getPreset(preset) : preset;
  const cfg = mergeConfig(base, overrides || {});

  let out = cloneImageData(imageData);

  if (cfg.misregister && cfg.misregister.enabled) {
    out = misregister(out, cfg.misregister);
  }
  if (cfg.posterize && cfg.posterize.enabled) {
    out = posterize(out, cfg.posterize.levels, cfg.posterize);
  }
  if (cfg.halftone && cfg.halftone.enabled) {
    out = halftone(out, cfg.halftone);
  }
  if (cfg.grain && cfg.grain.enabled) {
    out = paperGrain(out, cfg.grain);
  }
  if (cfg.ramp && cfg.ramp.enabled) {
    const rampOpts = { ...cfg.ramp };
    const composite = rampOpts.composite || {};
    delete rampOpts.composite;
    const ramp = contrastRamp(rampOpts);
    out = compositeRamp(out, ramp, composite);
  }
  return out;
}

/** Library version tag, handy for build metadata. */
export const VERSION = "1.0.0";

/** Expose the full processor set as one namespace object. */
export const processors = Object.freeze({
  posterize,
  halftone,
  paperGrain,
  misregister,
  contrastRamp,
  compositeRamp,
  buildContrastCurve,
  applyPrintFinish,
});

// Keep TAU referenced so bundlers do not flag it as dead when tree-shaking
// helper constants; it belongs to the public numeric vocabulary of the module.
export const FULL_TURN = TAU;

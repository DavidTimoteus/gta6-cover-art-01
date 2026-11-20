/*
 * studio.js — the print-finishing bench.
 *
 * Where effects.js builds the artwork, this module is the press operator: it
 * owns a rotatable halftone screen (angle + pitch are adjustable), a contrast
 * ramp expressed as a tone-curve LUT, deterministic grain, registration drift
 * and a batch runner. Every operation works on plain ImageData or a 2D
 * context, so it can finish a live preview or a pile of exported canvases.
 */

import { PALETTE, withAlpha, clamp01 } from './palette.js';
import { makeSeed, seededRandom } from './archive.js';

const clamp255 = (v) => Math.max(0, Math.min(255, v));
const hasDocument = () => typeof document !== 'undefined';

/** Named halftone screens, mirroring real print processes. */
export const HALFTONE_PRESETS = Object.freeze({
  newsprint: Object.freeze({ angle: 15, pitch: 9, dot: 0.30, ink: '#1B1035', amount: 0.30 }),
  magazine: Object.freeze({ angle: 30, pitch: 7, dot: 0.26, ink: '#7A2E6B', amount: 0.22 }),
  silkscreen: Object.freeze({ angle: 22.5, pitch: 11, dot: 0.34, ink: '#1B1035', amount: 0.28 }),
  risograph: Object.freeze({ angle: 45, pitch: 10, dot: 0.32, ink: '#FF5E7E', amount: 0.26 }),
  fineArt: Object.freeze({ angle: 75, pitch: 14, dot: 0.22, ink: '#1B1035', amount: 0.16 }),
});

/** Full finishing recipes built from a screen plus tone and texture budgets. */
export const FINISH_PRESETS = Object.freeze({
  proof: Object.freeze({
    label: 'Proof',
    screen: 'newsprint',
    levels: 6,
    posterize: 0.22,
    contrast: 1.06,
    gamma: 1.00,
    lift: -0.02,
    gain: 0.02,
    grain: 0.06,
    register: 1,
  }),
  magazine: Object.freeze({
    label: 'Magazine',
    screen: 'magazine',
    levels: 7,
    posterize: 0.16,
    contrast: 1.10,
    gamma: 0.98,
    lift: -0.01,
    gain: 0.03,
    grain: 0.04,
    register: 0,
  }),
  newsstand: Object.freeze({
    label: 'Newsstand',
    screen: 'newsprint',
    levels: 5,
    posterize: 0.30,
    contrast: 1.16,
    gamma: 1.05,
    lift: -0.04,
    gain: 0.04,
    grain: 0.09,
    register: 2,
  }),
  gallery: Object.freeze({
    label: 'Gallery',
    screen: 'fineArt',
    levels: 8,
    posterize: 0.10,
    contrast: 1.04,
    gamma: 1.00,
    lift: 0.00,
    gain: 0.01,
    grain: 0.025,
    register: 0,
  }),
});

/** Default screen settings used when no preset is selected. */
export const DEFAULT_SCREEN = Object.freeze({
  angle: 18,
  pitch: 12,
  dot: 0.28,
  ink: PALETTE.plum,
  amount: 0.24,
});

/* ------------------------------------------------------------------ *
 * Tone ramp
 * ------------------------------------------------------------------ */

/**
 * Build a 256-entry contrast ramp. `gamma` bends midtones, `lift` opens
 * shadows, `gain` protects highlights and `contrast` pivots around mid-grey.
 */
export function makeToneCurve(options = {}) {
  const contrast = isFinite(options.contrast) ? options.contrast : 1;
  const gamma = isFinite(options.gamma) && options.gamma > 0 ? options.gamma : 1;
  const lift = isFinite(options.lift) ? options.lift : 0;
  const gain = isFinite(options.gain) ? options.gain : 0;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i += 1) {
    let v = i / 255;
    v = Math.pow(v, gamma);
    v = (v - 0.5) * contrast + 0.5;
    v = v + lift * (1 - v) + gain * v;
    lut[i] = Math.round(clamp01(v) * 255);
  }
  return lut;
}

/** Apply a tone LUT to every RGB channel; alpha is untouched. */
export function applyToneCurve(imageData, lut) {
  if (!lut || lut.length < 256) return imageData;
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
  return imageData;
}

/** Quantize channels to a fixed number of ink levels with a blend factor. */
export function quantize(imageData, levels = 6, blend = 1) {
  const n = Math.max(2, Math.round(levels));
  const step = 255 / (n - 1);
  const k = clamp01(blend);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] += (Math.round(d[i] / step) * step - d[i]) * k;
    d[i + 1] += (Math.round(d[i + 1] / step) * step - d[i + 1]) * k;
    d[i + 2] += (Math.round(d[i + 2] / step) * step - d[i + 2]) * k;
  }
  return imageData;
}

/** Add seeded monochrome grain so repeated runs are pixel-identical. */
export function addGrain(imageData, seed, amount = 0.05) {
  const k = clamp01(amount);
  if (k <= 0) return imageData;
  const rnd = seededRandom(seed);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 255 * k;
    d[i] = clamp255(d[i] + n);
    d[i + 1] = clamp255(d[i + 1] + n);
    d[i + 2] = clamp255(d[i + 2] + n);
  }
  return imageData;
}

/** Nudge red right and blue left to emulate misregistered plates. */
export function channelShift(imageData, dx = 1, dy = 0) {
  const sx = Math.round(dx);
  const sy = Math.round(dy);
  if (!sx && !sy) return imageData;
  const { width, height, data } = imageData;
  const src = new Uint8ClampedArray(data);
  for (let y = 0; y < height; y += 1) {
    const ty = Math.max(0, Math.min(height - 1, y + sy));
    for (let x = 0; x < width; x += 1) {
      const rx = Math.max(0, Math.min(width - 1, x + sx));
      const bx = Math.max(0, Math.min(width - 1, x - sx));
      const i = (y * width + x) * 4;
      data[i] = src[(ty * width + rx) * 4];
      data[i + 2] = src[(y * width + bx) * 4 + 2];
    }
  }
  return imageData;
}

/* ------------------------------------------------------------------ *
 * Rotatable halftone screen
 * ------------------------------------------------------------------ */

const tileCache = new Map();

function screenTile(pitch, dot, ink) {
  const key = `${pitch}|${dot}|${ink}`;
  if (tileCache.has(key)) return tileCache.get(key);
  if (!hasDocument()) return null;
  const size = Math.max(4, Math.round(pitch));
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const m = c.getContext('2d');
  m.fillStyle = ink;
  m.beginPath();
  m.arc(size / 2, size / 2, Math.max(0.7, size * dot), 0, Math.PI * 2);
  m.fill();
  tileCache.set(key, c);
  return c;
}

/** Paint a rotated dot screen into a rectangular region. */
export function drawStudioHalftone(ctx, rect, settings = {}) {
  const cfg = { ...DEFAULT_SCREEN, ...settings };
  const { x, y, w, h } = rect;
  if (!ctx || w <= 0 || h <= 0) return;
  const tile = screenTile(cfg.pitch, cfg.dot, cfg.ink);
  if (!tile) return;
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const angle = (cfg.angle * Math.PI) / 180;
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(angle);
  ctx.translate(-(x + w / 2), -(y + h / 2));
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = clamp01(cfg.amount);
  ctx.fillStyle = pattern;
  ctx.fillRect(x - w, y - h, w * 3, h * 3);
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * One-shot finishing and batch finishing
 * ------------------------------------------------------------------ */

/**
 * Finish a context in place. Order: tone ramp -> quantization -> grain ->
 * registration drift -> optional rotated screen band.
 */
export function applyPrintFinish(ctx, width, height, options = {}) {
  if (!ctx) return null;
  const w = Math.max(1, width | 0);
  const h = Math.max(1, height | 0);
  const preset = FINISH_PRESETS[options.preset] || null;
  const cfg = { ...(preset || {}), ...options };
  const lut = makeToneCurve(cfg);
  let img;
  try {
    img = ctx.getImageData(0, 0, w, h);
  } catch (_) {
    return null;
  }
  applyToneCurve(img, lut);
  quantize(img, cfg.levels == null ? 6 : cfg.levels, cfg.posterize == null ? 0.2 : cfg.posterize);
  addGrain(img, cfg.seed == null ? makeSeed('studio') : cfg.seed, cfg.grain == null ? 0.05 : cfg.grain);
  channelShift(img, cfg.register == null ? 0 : cfg.register, 0);
  ctx.putImageData(img, 0, 0);

  if (cfg.screen) {
    const screenName = typeof cfg.screen === 'string' ? cfg.screen : null;
    const screen = (screenName && HALFTONE_PRESETS[screenName]) || DEFAULT_SCREEN;
    const bandH = h * (cfg.screenBand == null ? 0.22 : cfg.screenBand);
    drawStudioHalftone(ctx, { x: 0, y: h - bandH, w, h: bandH }, screen);
  }
  return img;
}

/** Finish many canvases. Each entry may be a canvas or { canvas, width, height }. */
export function finishBatch(targets, options = {}) {
  const results = [];
  (targets || []).forEach((entry, index) => {
    const canvas = entry && entry.canvas ? entry.canvas : entry;
    if (!canvas || !canvas.getContext) {
      results.push({ index, ok: false });
      return;
    }
    const ctx = canvas.getContext('2d');
    const w = (entry && entry.width) || canvas.width;
    const h = (entry && entry.height) || canvas.height;
    const seed = (options.seedFromIndex !== false)
      ? makeSeed(`${options.seed || 'batch'}-${index}`)
      : undefined;
    const img = applyPrintFinish(ctx, w, h, { ...options, seed });
    results.push({ index, ok: !!img, canvas });
  });
  return results;
}

/* ------------------------------------------------------------------ *
 * PrintStudio — stateful operator
 * ------------------------------------------------------------------ */

export class PrintStudio {
  constructor(options = {}) {
    this.screen = { ...DEFAULT_SCREEN };
    this.tone = {
      contrast: 1.05,
      gamma: 1,
      lift: 0,
      gain: 0.02,
      levels: 6,
      posterize: 0.20,
      grain: 0.05,
      register: 0,
      seed: makeSeed('print-studio'),
    };
    this.curve = makeToneCurve(this.tone);
    this.presetName = null;
    this.screenBand = 0.22;
    if (options.screenPreset) this.useScreenPreset(options.screenPreset);
    if (options.finishPreset) this.useFinishPreset(options.finishPreset);
    if (options.angle != null) this.setAngle(options.angle);
    if (options.pitch != null) this.setPitch(options.pitch);
  }

  /** Set the screen angle in degrees (any real number, wraps at 180). */
  setAngle(degrees) {
    const d = Number(degrees);
    if (isFinite(d)) this.screen.angle = ((d % 180) + 180) % 180;
    return this;
  }

  /** Set dot pitch in pixels (minimum 4 to stay printable). */
  setPitch(pixels) {
    const p = Number(pixels);
    if (isFinite(p)) this.screen.pitch = Math.max(4, Math.round(p));
    return this;
  }

  setDot(ratio) {
    const r = clamp01(ratio);
    if (r > 0) this.screen.dot = Math.min(0.48, r);
    return this;
  }

  setInk(color) {
    if (typeof color === 'string') this.screen.ink = color;
    return this;
  }

  setAmount(amount) {
    this.screen.amount = clamp01(amount);
    return this;
  }

  setTone(params = {}) {
    this.tone = { ...this.tone, ...params };
    this.curve = makeToneCurve(this.tone);
    return this;
  }

  /** Load one of the named halftone screens. */
  useScreenPreset(name) {
    const preset = HALFTONE_PRESETS[name];
    if (!preset) return this;
    this.screen = { ...preset };
    this.presetName = name;
    return this;
  }

  /** Load a full finishing recipe (screen + tone + texture budgets). */
  useFinishPreset(name) {
    const preset = FINISH_PRESETS[name];
    if (!preset) return this;
    this.useScreenPreset(preset.screen);
    this.setTone({
      contrast: preset.contrast,
      gamma: preset.gamma,
      lift: preset.lift,
      gain: preset.gain,
      levels: preset.levels,
      posterize: preset.posterize,
      grain: preset.grain,
      register: preset.register,
    });
    this.presetName = name;
    return this;
  }

  /** Finish a rectangular region of a context, honouring current settings. */
  finishRegion(ctx, rect) {
    if (!ctx || !rect) return this;
    try {
      const img = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
      applyToneCurve(img, this.curve);
      quantize(img, this.tone.levels, this.tone.posterize);
      addGrain(img, this.tone.seed, this.tone.grain);
      channelShift(img, this.tone.register, 0);
      ctx.putImageData(img, rect.x, rect.y);
    } catch (_) {
      /* nothing to finish on a tainted region */
    }
    return this;
  }

  /** Finish a whole context and optionally lay down the screen band. */
  finish(ctx, width, height) {
    if (!ctx) return this;
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    this.finishRegion(ctx, { x: 0, y: 0, w, h });
    if (this.screen.amount > 0 && this.screenBand > 0) {
      const bandH = h * this.screenBand;
      drawStudioHalftone(ctx, { x: 0, y: h - bandH, w, h: bandH }, this.screen);
    }
    return this;
  }

  /** Finish an array of canvases with a fresh deterministic seed per item. */
  finishBatch(canvases) {
    return finishBatch(canvases, {
      ...this.tone,
      screen: this.screen,
      screenBand: this.screenBand,
      seed: this.tone.seed,
    });
  }

  /** Plain-object snapshot of the operator settings, useful for presets. */
  summary() {
    return {
      preset: this.presetName,
      screen: { ...this.screen },
      tone: { ...this.tone },
      screenBand: this.screenBand,
    };
  }

  /** Clone the operator so a copy can be tuned without side effects. */
  clone() {
    const next = new PrintStudio();
    next.screen = { ...this.screen };
    next.tone = { ...this.tone };
    next.curve = new Uint8ClampedArray(this.curve);
    next.presetName = this.presetName;
    next.screenBand = this.screenBand;
    return next;
  }
}

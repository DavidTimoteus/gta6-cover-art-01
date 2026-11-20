/*
 * effects.js — colour grading and print texture.
 *
 * Two entry points are consumed by the controller: applyGrade() and
 * drawGrain(). The rest are building blocks used by render.js to assemble the
 * backdrop. The texture budget is deliberately small: halftone and posterize
 * touch only the BACKDROP, never the faces in the panels, and stay around a
 * quarter of the image's visual weight. Skin stays warm and readable.
 */

import { PALETTE, gradeGradientStops, mixColors, withAlpha, clamp01 } from './palette.js';

const clamp255 = (v) => Math.max(0, Math.min(255, v));
const hasDocument = () => typeof document !== 'undefined';

/** Deterministic tiny PRNG so a given poster always grains the same way. */
function makeRandom(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * Global grade pass
 * ------------------------------------------------------------------ */

/**
 * Apply a named grade over the finished composition. A restrained pixel pass
 * (saturation / contrast / warmth) is followed by a soft-light tint, an
 * additive glow wash and a multiply vignette. Called after renderCover().
 */
export function applyGrade(ctx, grade, width, height) {
  const g = grade || {};
  const w = Math.max(1, width | 0);
  const h = Math.max(1, height | 0);
  let img;
  try {
    img = ctx.getImageData(0, 0, w, h);
  } catch (_) {
    return;
  }

  const data = img.data;
  const sat = isFinite(g.saturation) ? g.saturation : 1.05;
  const con = isFinite(g.contrast) ? g.contrast : 1.04;
  const warm = isFinite(g.warmth) ? g.warmth : 0;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let gg = data[i + 1];
    let b = data[i + 2];
    const lum = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    r = (r - lum) * sat + lum;
    gg = (gg - lum) * sat + lum;
    b = (b - lum) * sat + lum;
    r = (r - 128) * con + 128;
    gg = (gg - 128) * con + 128;
    b = (b - 128) * con + 128;
    r += warm * 7;
    gg += warm * 1.5;
    b -= warm * 7;
    data[i] = clamp255(r);
    data[i + 1] = clamp255(gg);
    data[i + 2] = clamp255(b);
  }
  ctx.putImageData(img, 0, 0);

  ctx.save();
  if (g.tint) {
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = clamp01(g.tintAmount == null ? 0.1 : g.tintAmount);
    ctx.fillStyle = g.tint;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'screen';
  const wash = ctx.createLinearGradient(0, 0, 0, h);
  wash.addColorStop(0, withAlpha(g.glowTop || PALETTE.amber, 0.10));
  wash.addColorStop(0.5, 'rgba(0,0,0,0)');
  wash.addColorStop(1, withAlpha(g.glowBottom || PALETTE.magenta, 0.12));
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);

  if (g.vignette > 0) {
    const vg = ctx.createRadialGradient(
      w / 2, h * 0.45, Math.min(w, h) * 0.20,
      w / 2, h * 0.50, Math.max(w, h) * 0.76,
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, `rgba(8,4,18,${clamp01(g.vignette)})`);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Additive sunset light
 * ------------------------------------------------------------------ */

/** Stack two radial blooms (amber high-right, magenta low-left) behind plates. */
export function skyGlow(ctx, x, y, w, h, grade, palette = PALETTE) {
  const g = grade || {};
  const strength = g.glowStrength == null ? 1 : g.glowStrength;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  const hi = ctx.createRadialGradient(
    x + w * 0.68, y + h * 0.30, 0,
    x + w * 0.68, y + h * 0.30, Math.max(w, h) * 0.58,
  );
  hi.addColorStop(0, withAlpha(g.glowTop || palette.amber, 0.82 * strength));
  hi.addColorStop(0.42, withAlpha(g.glowMid || palette.coral, 0.34 * strength));
  hi.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hi;
  ctx.fillRect(x, y, w, h);

  const lo = ctx.createRadialGradient(
    x + w * 0.22, y + h * 0.84, 0,
    x + w * 0.22, y + h * 0.84, Math.max(w, h) * 0.52,
  );
  lo.addColorStop(0, withAlpha(g.glowBottom || palette.magenta, 0.55 * strength));
  lo.addColorStop(0.55, withAlpha(palette.magenta, 0.18 * strength));
  lo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = lo;
  ctx.fillRect(x, y, w, h);

  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Restrained background texture
 * ------------------------------------------------------------------ */

/** Cache one dot tile per pitch/radius/colour signature. */
const dotCache = new Map();

function dotTile(pitch, radius, color) {
  const key = `${pitch}|${radius}|${color}`;
  if (dotCache.has(key)) return dotCache.get(key);
  if (!hasDocument()) return null;
  const size = Math.max(4, Math.round(pitch));
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const m = c.getContext('2d');
  m.fillStyle = color;
  m.beginPath();
  m.arc(size / 2, size / 2, Math.max(0.7, radius), 0, Math.PI * 2);
  m.fill();
  dotCache.set(key, c);
  return c;
}

/**
 * Halftone a region with a rotated dot screen. Drawn as a repeating pattern
 * (cheap) and clipped to the region, multiplied at a low alpha so it reads as
 * ink texture rather than a full-frame filter.
 */
export function drawHalftone(ctx, x, y, w, h, opts = {}) {
  if (!hasDocument() || w <= 0 || h <= 0) return;
  const pitch = Math.max(8, Math.round(opts.pitch || 14));
  const radius = opts.radius == null ? pitch * 0.27 : opts.radius;
  const tile = dotTile(pitch, radius, opts.color || PALETTE.plum);
  if (!tile) return;
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const angle = ((opts.angle || 18) * Math.PI) / 180;
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(angle);
  ctx.translate(-(x + w / 2), -(y + h / 2));
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = clamp01(opts.amount == null ? 0.25 : opts.amount);
  ctx.fillStyle = pattern;
  ctx.fillRect(x - w, y - h, w * 3, h * 3);
  ctx.restore();
}

/** Quantize ImageData channels to a small number of print levels. */
export function posterizeImageData(imageData, levels = 5, blend = 1) {
  const n = Math.max(2, Math.round(levels));
  const step = 255 / (n - 1);
  const k = clamp01(blend);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i] + (Math.round(data[i] / step) * step - data[i]) * k;
    data[i + 1] = data[i + 1] + (Math.round(data[i + 1] / step) * step - data[i + 1]) * k;
    data[i + 2] = data[i + 2] + (Math.round(data[i + 2] / step) * step - data[i + 2]) * k;
  }
  return imageData;
}

/** Fine monochrome grain tile, cached and deterministic. */
let grainTile = null;
export function makeGrainTile(size = 96) {
  if (grainTile) return grainTile;
  if (!hasDocument()) return null;
  const s = Math.max(16, Math.round(size));
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const m = c.getContext('2d');
  const img = m.createImageData(s, s);
  const rnd = makeRandom(0x51f00d);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 110 + Math.round(rnd() * 145);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  m.putImageData(img, 0, 0);
  grainTile = c;
  return c;
}

/** Final finishing texture pass: a very light print grain over everything. */
export function drawGrain(ctx, width, height, opacity = 0.05) {
  const tile = makeGrainTile();
  if (!tile) return;
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return;
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = clamp01(opacity);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/** Colour fringing: offset cyan and coral copies of a region, screened back in. */
export function channelMisregistration(ctx, x, y, w, h, amount = 1) {
  if (!hasDocument() || amount <= 0 || w <= 0 || h <= 0) return;
  const sw = Math.max(1, Math.round(w));
  const sh = Math.max(1, Math.round(h));
  try {
    const copy = document.createElement('canvas');
    copy.width = sw;
    copy.height = sh;
    const cc = copy.getContext('2d');
    cc.drawImage(ctx.canvas, x, y, sw, sh, 0, 0, sw, sh);

    const tinted = (color) => {
      const t = document.createElement('canvas');
      t.width = sw;
      t.height = sh;
      const tc = t.getContext('2d');
      tc.drawImage(copy, 0, 0);
      tc.globalCompositeOperation = 'source-in';
      tc.fillStyle = color;
      tc.fillRect(0, 0, sw, sh);
      return t;
    };

    const shift = Math.max(1, Math.round(amount * 2));
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.10 * clamp01(amount);
    ctx.drawImage(tinted('#00E5C5'), x - shift, y);
    ctx.drawImage(tinted('#FF5E7E'), x + shift, y + 1);
    ctx.restore();
  } catch (_) {
    /* registry pass is decorative; skip if the canvas is tainted */
  }
}

/** Combined ImageData finishing: quantize, grain and a subtle channel shift. */
export function finishingPass(imageData, opts = {}) {
  const levels = opts.levels == null ? 6 : opts.levels;
  const pBlur = clamp01(opts.posterize == null ? 0.20 : opts.posterize);
  const gAmt = clamp01(opts.grain == null ? 0.05 : opts.grain);
  const shift = Math.max(0, Math.round(opts.misregister || 0));
  posterizeImageData(imageData, levels, pBlur);

  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  const rnd = makeRandom(opts.seed || 0x2f6a1);

  if (gAmt > 0) {
    for (let i = 0; i < data.length; i += 4) {
      const n = (rnd() - 0.5) * 255 * gAmt;
      data[i] = clamp255(data[i] + n);
      data[i + 1] = clamp255(data[i + 1] + n);
      data[i + 2] = clamp255(data[i + 2] + n);
    }
  }

  if (shift > 0) {
    const src = new Uint8ClampedArray(data);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const xr = Math.min(width - 1, x + shift);
        const xb = Math.max(0, x - shift);
        data[i] = src[(y * width + xr) * 4];
        data[i + 2] = src[(y * width + xb) * 4 + 2];
      }
    }
  }
  return imageData;
}

/* ------------------------------------------------------------------ *
 * Backdrop assembly
 * ------------------------------------------------------------------ */

/**
 * Build the full-bleed backdrop: a vertical sky gradient from the grade's
 * stops, faint diagonal light beams, the additive sunset glow, a light
 * posterize and two halftone bands. Faces never enter this canvas.
 */
export function buildBackdrop(width, height, grade, palette = PALETTE) {
  const w = Math.max(1, width | 0);
  const h = Math.max(1, height | 0);
  let c;
  if (hasDocument()) {
    c = document.createElement('canvas');
  } else if (typeof OffscreenCanvas !== 'undefined') {
    c = new OffscreenCanvas(w, h);
  } else {
    return null;
  }
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  const stops = gradeGradientStops(grade);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  stops.forEach((s) => sky.addColorStop(s.offset, s.color));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Diagonal cream beams from the sun position.
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 5; i += 1) {
    const ox = w * (0.42 + i * 0.11);
    ctx.beginPath();
    ctx.moveTo(ox, -10);
    ctx.lineTo(ox + w * 0.10, -10);
    ctx.lineTo(ox - w * 0.30, h + 10);
    ctx.lineTo(ox - w * 0.44, h + 10);
    ctx.closePath();
    ctx.fillStyle = withAlpha(palette.cream, 0.035 + (i % 2) * 0.02);
    ctx.fill();
  }
  ctx.restore();

  skyGlow(ctx, 0, 0, w, h, grade, palette);

  // Posterize a fraction of the backdrop only — never the panel images.
  const pBlur = clamp01(grade.posterize == null ? 0.22 : grade.posterize);
  if (pBlur > 0) {
    try {
      const img = ctx.getImageData(0, 0, w, h);
      posterizeImageData(img, 5, pBlur);
      ctx.putImageData(img, 0, 0);
    } catch (_) {
      /* ignore tainted backdrop */
    }
  }

  // Two restrained halftone bands with different screen angles.
  const amount = clamp01(grade.halftone == null ? 0.25 : grade.halftone) * 0.8;
  const pitch = Math.max(11, Math.round(Math.min(w, h) / 78));
  drawHalftone(ctx, 0, h * 0.06, w, h * 0.30, {
    pitch, angle: 16, color: mixColors(palette.plum, palette.magenta, 0.45), amount,
  });
  drawHalftone(ctx, 0, h * 0.66, w, h * 0.30, {
    pitch: pitch * 1.15, angle: -21, color: palette.plum, amount: amount * 0.9,
  });

  return c;
}

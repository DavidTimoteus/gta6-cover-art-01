/*
 * effects.js
 * Pure pixel-passes that give the poster its screen-printed character.
 *
 * Every transform takes pixel data and returns a *new* buffer (the only
 * exception is applyFinish, which is the deliberate in-place bridge used by
 * the canvas renderer).  No function reads global state or reaches out to the
 * DOM beyond reading a 2D context that the caller already owns.
 */

import { parseHex, clamp } from './palette.js';

const TAU = Math.PI * 2;

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Deterministic integer hash in [0, 1). No Math.random anywhere in this file. */
export function hashNoise(x, y, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Signed variant of hashNoise, in -1..1. */
export function signedNoise(x, y, seed) {
  return hashNoise(x, y, seed) * 2 - 1;
}

function makeImageData(width, height, data) {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const bytes = data || new Uint8ClampedArray(w * h * 4);
  if (typeof ImageData !== 'undefined') return new ImageData(bytes, w, h);
  return { data: bytes, width: w, height: h, colorSpace: 'srgb' };
}

/** Recover width/height from an ImageData-like object. */
export function dimensionsOf(imageData) {
  return {
    w: Math.max(1, num(imageData && imageData.width, 1)),
    h: Math.max(1, num(imageData && imageData.height, 1)),
  };
}

/** Copy an ImageData-like object into a fresh buffer. */
export function cloneImageData(source) {
  const { w, h } = dimensionsOf(source);
  const copy = new Uint8ClampedArray(source.data.length);
  copy.set(source.data);
  return makeImageData(w, h, copy);
}

/** Perceived luminance of one pixel, in 0..1. */
export function luminanceAt(data, index) {
  return (0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]) / 255;
}

/**
 * Quantize every channel to a small set of flat levels.  This is the ink-flat
 * pass: it removes gradients and leaves posterized bands.
 */
export function posterize(source, levels) {
  const { w, h } = dimensionsOf(source);
  const steps = clamp(Math.round(num(levels, 5)), 2, 16);
  const out = new Uint8ClampedArray(source.data.length);
  const data = source.data;
  const factor = 255 / steps;
  for (let i = 0; i < data.length; i += 4) {
    out[i] = Math.round(Math.min(steps, Math.floor(data[i] / factor)) * factor);
    out[i + 1] = Math.round(Math.min(steps, Math.floor(data[i + 1] / factor)) * factor);
    out[i + 2] = Math.round(Math.min(steps, Math.floor(data[i + 2] / factor)) * factor);
    out[i + 3] = data[i + 3];
  }
  return makeImageData(w, h, out);
}

/**
 * Map luminance onto a flat set of ink colours.  `inks` is an ordered list
 * from shadow to highlight; each luminance band picks exactly one ink.
 */
export function posterizeToInks(source, inks, levels) {
  const { w, h } = dimensionsOf(source);
  const data = source.data;
  const colours = (inks && inks.length ? inks : ['#1B1035', '#7A2E6B', '#FFB35C', '#FFE29A']).map(parseHex);
  const bands = clamp(Math.round(num(levels, colours.length)), 2, 16);
  const out = new Uint8ClampedArray(data.length);

  for (let i = 0; i < data.length; i += 4) {
    const lum = luminanceAt(data, i);
    const level = Math.min(bands - 1, Math.floor(lum * bands));
    const colour = colours[Math.min(colours.length - 1, Math.round(level / Math.max(1, bands - 1) * (colours.length - 1)))];
    const mix = 0.72; // keep a trace of the original hue under the flat ink
    out[i] = colour.r * mix + data[i] * (1 - mix);
    out[i + 1] = colour.g * mix + data[i + 1] * (1 - mix);
    out[i + 2] = colour.b * mix + data[i + 2] * (1 - mix);
    out[i + 3] = data[i + 3];
  }
  return makeImageData(w, h, out);
}

/**
 * Halftone dot raster.
 *
 * For each pixel we rotate into a dot grid, find the nearest cell centre and
 * grow a dot whose radius follows local darkness.  `angle` is in radians and
 * `pitch` is the cell spacing in device pixels.
 */
export function halftone(source, options) {
  const opts = options || {};
  const { w, h } = dimensionsOf(source);
  const src = source.data;
  const out = new Uint8ClampedArray(src.length);
  const angle = num(opts.angle, 0.38);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const pitch = clamp(num(opts.pitch, 6), 2, 40);
  const ink = parseHex(opts.ink || '#1B1035');
  const paper = parseHex(opts.paper || '#FFE29A');
  const strength = clamp(num(opts.strength, 0.7), 0, 1);

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const lum = luminanceAt(src, i);
      const darkness = 1 - lum;

      // Rotate sample coordinates into the halftone screen.
      const rx = x * cos + y * sin;
      const ry = -x * sin + y * cos;
      const cellX = Math.round(rx / pitch) * pitch;
      const cellY = Math.round(ry / pitch) * pitch;
      const dx = rx - cellX;
      const dy = ry - cellY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const radius = (pitch * 0.62) * Math.sqrt(darkness);

      const inside = dist <= radius ? 1 : 0;
      const coverage = inside * strength;
      out[i] = src[i] * (1 - coverage) + ink.r * coverage;
      out[i + 1] = src[i + 1] * (1 - coverage) + ink.g * coverage;
      out[i + 2] = src[i + 2] * (1 - coverage) + ink.b * coverage;

      // Lift the unprinted paper slightly for a cleaner dot edge.
      const lift = (1 - inside) * 0.06;
      out[i] = out[i] * (1 - lift) + paper.r * lift;
      out[i + 1] = out[i + 1] * (1 - lift) + paper.g * lift;
      out[i + 2] = out[i + 2] * (1 - lift) + paper.b * lift;
      out[i + 3] = src[i + 3];
    }
  }
  return makeImageData(w, h, out);
}

/**
 * Add fine deterministic paper grain.  `amount` is in 0..1 and `seed` selects
 * the noise field, so a given poster always reproduces byte-for-byte.
 */
export function paperGrain(source, options) {
  const opts = options || {};
  const { w, h } = dimensionsOf(source);
  const src = source.data;
  const out = new Uint8ClampedArray(src.length);
  const amount = clamp(num(opts.amount, 0.06), 0, 0.4);
  const seed = Math.floor(num(opts.seed, 1337));
  const scale = 255 * amount;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const n = signedNoise(x, y, seed) * scale;
      out[i] = src[i] + n;
      out[i + 1] = src[i + 1] + n * 0.92;
      out[i + 2] = src[i + 2] + n * 0.84;
      out[i + 3] = src[i + 3];
    }
  }
  return makeImageData(w, h, out);
}

/**
 * Two-plate channel offset (ink misregistration).
 * The warm plate is sampled from +offset and the cool plate from -offset.
 */
export function channelOffset(source, options) {
  const opts = options || {};
  const { w, h } = dimensionsOf(source);
  const src = source.data;
  const out = new Uint8ClampedArray(src.length);
  const dx = Math.round(num(opts.dx, 1.5));
  const dy = Math.round(num(opts.dy, -1));
  const split = clamp(num(opts.split, 0.55), 0, 1);
  const tint = parseHex(opts.tint || '#FF5E7E');

  const sample = (x, y, channel) => {
    const sx = clamp(x, 0, w - 1) | 0;
    const sy = clamp(y, 0, h - 1) | 0;
    return src[(sy * w + sx) * 4 + channel];
  };

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const warmR = sample(x + dx, y + dy, 0);
      const coolB = sample(x - dx, y - dy, 2);
      const coolG = sample(x - dx, y - dy, 1);
      out[i] = src[i] * (1 - split) + warmR * split;
      out[i + 1] = src[i + 1] * (1 - split * 0.5) + coolG * split * 0.5;
      out[i + 2] = src[i + 2] * (1 - split) + coolB * split;
      // A whisper of the accent ink rides the plate edge.
      out[i] = out[i] * 0.94 + tint.r * 0.06;
      out[i + 3] = src[i + 3];
    }
  }
  return makeImageData(w, h, out);
}

/** Normalize finishing options and scale size-dependent values by canvas width. */
export function normalizeFinishOptions(options) {
  const opts = options || {};
  const width = Math.max(1, num(opts.width, 1080));
  const scale = clamp(width / 1080, 0.6, 2.2);
  return {
    width,
    scale,
    posterize: {
      levels: clamp(Math.round(num(opts.posterizeLevels, 5)), 2, 12),
      inks: opts.inks,
    },
    halftone: {
      angle: num(opts.halftoneAngle, 0.38),
      pitch: clamp(num(opts.halftonePitch, 5.5) * scale, 2.5, 24),
      strength: clamp(num(opts.halftoneStrength, 0.62), 0, 1),
      ink: opts.ink,
      paper: opts.paper,
    },
    grain: {
      amount: clamp(num(opts.grainAmount, 0.055), 0, 0.3),
      seed: Math.floor(num(opts.seed, 1337)),
    },
    offset: {
      dx: num(opts.offsetX, 1.4) * scale,
      dy: num(opts.offsetY, -0.8) * scale,
      split: clamp(num(opts.offsetSplit, 0.5), 0, 1),
      tint: opts.tint,
    },
  };
}

/**
 * The full finishing pass.  Takes an ImageData and returns a brand new one.
 * Order: posterized flats -> halftone screen -> plate offset -> paper grain.
 */
export function finishImageData(input, palette, options) {
  const opts = normalizeFinishOptions({ ...(options || {}), width: (input && input.width) || 1080 });
  const ink = (palette && palette.ink) || '#1B1035';
  const paper = (palette && palette.paper) || '#FFE29A';
  const accent = (palette && palette.accent) || '#FF5E7E';

  const inks = opts.posterize.inks || [
    palette && palette.plum || ink,
    palette && palette.wash || '#7A2E6B',
    palette && palette.glow || '#FFB35C',
    paper,
  ];

  let current = posterizeToInks(input, inks, opts.posterize.levels);
  current = halftone(current, { ...opts.halftone, ink, paper });
  current = channelOffset(current, { ...opts.offset, tint: accent });
  current = paperGrain(current, opts.grain);
  return current;
}

/**
 * Canvas bridge: read the current pixels, finish them, draw them back.
 * Tainted or unrenderable canvases are skipped silently so the editor keeps
 * working when a cross-origin image is present.
 */
export function applyFinish(ctx, w, h, palette, options) {
  if (!ctx) return null;
  const width = Math.max(1, Math.floor(num(w, ctx.canvas ? ctx.canvas.width : 1080)));
  const height = Math.max(1, Math.floor(num(h, ctx.canvas ? ctx.canvas.height : 1080)));
  let source;
  try {
    source = ctx.getImageData(0, 0, width, height);
  } catch (err) {
    return null;
  }
  const finished = finishImageData(source, palette, options);
  try {
    ctx.putImageData(finished, 0, 0);
  } catch (err) {
    return finished;
  }
  return finished;
}

/** Convenience: sweep of halftone angles for proof-sheet comparisons. */
export function angleSweep(input, palette, angles, options) {
  const list = Array.isArray(angles) && angles.length ? angles : [0, 0.38, 0.78, 1.18];
  return list.map((angle) => finishImageData(input, palette, { ...(options || {}), halftoneAngle: angle }));
}

export { TAU };

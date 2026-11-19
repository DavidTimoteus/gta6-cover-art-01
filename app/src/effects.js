/* ============================================================================
 * effects.js
 * Pure print-finishing filters plus the in-place bridge used by the editor.
 *
 * Every exported filter takes an ImageData and returns a brand-new ImageData;
 * none of them mutate their input.  applyPrintFinish() is the single impure
 * function: it reads the canvas, runs the pure chain, and writes it back.
 * ==========================================================================*/

import { parseColor, hexToRgb } from './palette.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function blankImageData(width, height) {
  if (typeof ImageData === 'function') return new ImageData(width, height);
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function paperRgb(palette) {
  if (!palette) return [255, 226, 154];
  const c = hexToRgb(palette.cream || '#FFE29A');
  return [c.r, c.g, c.b];
}

function luminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/* --------------------------------------------------------------- posterize */
/**
 * Collapse each pixel onto a small set of flat ink levels.
 * When `colors` is supplied (array of hex values, dark to light) pixels are
 * mapped to the nearest flat by luminance; otherwise channels are quantized.
 */
export function posterize(source, options) {
  const opts = options || {};
  const width = source.width;
  const height = source.height;
  const out = blankImageData(width, height);
  const src = source.data;
  const dst = out.data;
  const levels = clamp(opts.levels || 4, 2, 12);
  const step = 255 / (levels - 1);
  const flats = Array.isArray(opts.colors) && opts.colors.length
    ? opts.colors.map((c) => parseColor(c))
    : null;

  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3];
    if (a === 0) continue;
    if (flats) {
      const lum = luminance(src[i], src[i + 1], src[i + 2]);
      let index = Math.round(lum * (flats.length - 1));
      index = clamp(index, 0, flats.length - 1);
      dst[i] = flats[index].r;
      dst[i + 1] = flats[index].g;
      dst[i + 2] = flats[index].b;
    } else {
      dst[i] = clamp(Math.round(src[i] / step) * step, 0, 255);
      dst[i + 1] = clamp(Math.round(src[i + 1] / step) * step, 0, 255);
      dst[i + 2] = clamp(Math.round(src[i + 2] / step) * step, 0, 255);
    }
    dst[i + 3] = a;
  }
  return out;
}

/* ----------------------------------------------------------------- halftone */
/**
 * Halftone dot raster on a rotated lattice.
 * Each lattice cell samples the source at its centre; darker samples grow a
 * larger dot.  The background is printed paper (cream), the dot keeps the
 * sampled ink colour so the grade survives the screening.
 */
export function halftone(source, options) {
  const opts = options || {};
  const width = source.width;
  const height = source.height;
  const out = blankImageData(width, height);
  const src = source.data;
  const dst = out.data;
  const paper = opts.paper || [255, 226, 154];
  const pitch = clamp(opts.pitch || 5, 2, 24);
  const angle = ((Number(opts.angle) || 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.hypot(width, height) / 2 + pitch;

  // Flood the sheet with paper first.
  for (let i = 0; i < dst.length; i += 4) {
    dst[i] = paper[0];
    dst[i + 1] = paper[1];
    dst[i + 2] = paper[2];
    dst[i + 3] = 255;
  }

  for (let gy = -radius; gy <= radius; gy += pitch) {
    for (let gx = -radius; gx <= radius; gx += pitch) {
      const px = cx + gx * cos - gy * sin;
      const py = cy + gx * sin + gy * cos;
      if (px < 0 || py < 0 || px >= width || py >= height) continue;

      const sx = Math.min(width - 1, Math.round(px));
      const sy = Math.min(height - 1, Math.round(py));
      const si = (sy * width + sx) * 4;
      const a = src[si + 3];
      if (a === 0) continue;

      const r = src[si];
      const g = src[si + 1];
      const b = src[si + 2];
      const lum = luminance(r, g, b);
      const dotRadius = (pitch * 0.66) * (0.28 + 0.72 * (1 - lum));
      const rr = Math.max(0.6, dotRadius);

      const minX = Math.max(0, Math.floor(px - rr));
      const maxX = Math.min(width - 1, Math.ceil(px + rr));
      const minY = Math.max(0, Math.floor(py - rr));
      const maxY = Math.min(height - 1, Math.ceil(py + rr));
      const rr2 = rr * rr;

      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const dx = x + 0.5 - px;
          const dy = y + 0.5 - py;
          if (dx * dx + dy * dy > rr2) continue;
          const di = (y * width + x) * 4;
          dst[di] = r;
          dst[di + 1] = g;
          dst[di + 2] = b;
          dst[di + 3] = 255;
        }
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------ channel offset */
/**
 * Two-plate misregistration: the red plate is shifted one way and the
 * blue/cyan plate the other.  Fractional shifts are quantized to whole pixels.
 */
export function channelOffset(source, options) {
  const opts = options || {};
  const width = source.width;
  const height = source.height;
  const out = blankImageData(width, height);
  const src = source.data;
  const dst = out.data;
  const red = Math.round(opts.redShift == null ? 1.5 : opts.redShift);
  const green = Math.round(opts.greenShift == null ? 0 : opts.greenShift);
  const blue = Math.round(opts.blueShift == null ? -1.5 : opts.blueShift);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const di = (y * width + x) * 4;
      const rIdx = (y * width + clamp(x - red, 0, width - 1)) * 4;
      const gIdx = (y * width + clamp(x - green, 0, width - 1)) * 4;
      const bIdx = (y * width + clamp(x - blue, 0, width - 1)) * 4;
      dst[di] = src[rIdx];
      dst[di + 1] = src[gIdx + 1];
      dst[di + 2] = src[bIdx + 2];
      dst[di + 3] = src[di + 3];
    }
  }
  return out;
}

/* ------------------------------------------------------------------- grain */
/**
 * Deterministic paper grain driven by a linear-congruential generator.
 * The same seed always yields the same texture for a given buffer size.
 */
export function paperGrain(source, seed, amount) {
  const width = source.width;
  const height = source.height;
  const out = blankImageData(width, height);
  const src = source.data;
  const dst = out.data;
  const strength = clamp(amount == null ? 0.06 : amount, 0, 1) * 255;
  let state = (Number(seed) >>> 0) || 0x9e3779b9;

  for (let i = 0; i < src.length; i += 4) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const noise = ((state >>> 16) / 65535 - 0.5) * strength;
    dst[i] = clamp(src[i] + noise, 0, 255);
    dst[i + 1] = clamp(src[i + 1] + noise, 0, 255);
    dst[i + 2] = clamp(src[i + 2] + noise, 0, 255);
    dst[i + 3] = src[i + 3];
  }
  return out;
}

/* ------------------------------------------------------------- finishing pass */
/**
 * Run the whole finishing chain on a copy of `source`.
 * Order matters: flats first, then screening, then plate shift, then grain.
 */
export function finishImageData(source, options) {
  const opts = options || {};
  const palette = opts.palette;
  const registration = opts.registration == null ? 1.5 : opts.registration;
  const flats = Array.isArray(opts.flats) && opts.flats.length
    ? opts.flats
    : palette
      ? [palette.plum, palette.magenta, palette.coral, palette.amber, palette.cream]
      : null;

  let current = posterize(source, { levels: opts.levels || 5, colors: flats });
  current = halftone(current, {
    pitch: opts.pitch || 5,
    angle: opts.angle || 18,
    paper: opts.paper || paperRgb(palette),
  });
  current = channelOffset(current, {
    redShift: registration,
    blueShift: -registration,
    greenShift: 0,
  });
  current = paperGrain(current, opts.seed || 0x1a2b3c4d, opts.grain == null ? 0.055 : opts.grain);
  return current;
}

/* ------------------------------------------------------------------ bridge */
/**
 * Apply the finishing chain directly to a 2D context, in place.
 * This is the function main.js calls after renderCover().
 */
export function applyPrintFinish(ctx, settings) {
  if (!ctx || !settings) return null;
  const width = Math.max(1, Math.floor(settings.width || 0));
  const height = Math.max(1, Math.floor(settings.height || 0));
  let image;
  try {
    image = ctx.getImageData(0, 0, width, height);
  } catch (error) {
    return null;
  }
  const grade = settings.grade || 'sunset';
  const finished = finishImageData(image, {
    palette: settings.palette,
    grade,
    pitch: grade === 'ink' ? 4 : grade === 'rain' ? 6 : 5,
    angle: grade === 'rain' ? 38 : grade === 'ink' ? 8 : 18,
    grain: grade === 'ink' ? 0.075 : 0.055,
    registration: grade === 'ink' ? 2 : 1.5,
    seed: grade.length * 7919 + width,
  });
  try {
    ctx.putImageData(finished, 0, 0);
  } catch (error) {
    return finished;
  }
  return finished;
}

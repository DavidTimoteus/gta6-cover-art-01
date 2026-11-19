// Halftone dot coverage maths is specified independently in app/src/printspec.js.
// Leonida Key Art Lab — screenprint finishing.
// Studio note: the independent studio.js module also exposes halftone and posterize helpers.
// Hard ink separations: five flat levels with crushed shadows, a visible
// halftone screen, coarse grain, offset colour plates and press marks.

import { hexToRgb, rampColor, rgbToCss, clamp } from './palette.js';

let noiseTile = null;
const LEVELS = 5;

// Posterise to the grade's ink ramp. Shadows collapse to the darkest ink,
// midtones snap to whole ramp stops, so the image survives heavy downscaling.
export function posterizeInPlace(canvas, ramp, amount, grain) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = canvas.width, h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    let lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    // S-curve: deepen darks, open highlights, then crush the lowest band flat.
    lum = clamp((lum - 0.5) * 1.26 + 0.5, 0, 1);
    if (lum < 0.16) lum = 0;
    const snapped = Math.round(lum * (LEVELS - 1)) / (LEVELS - 1);
    const ink = rampColor(ramp, snapped);
    let nr = r + (ink[0] - r) * amount;
    let ng = g + (ink[1] - g) * amount;
    let nb = b + (ink[2] - b) * amount;
    const n = (Math.random() - 0.5) * grain;
    d[i] = clamp(nr + n, 0, 255);
    d[i + 1] = clamp(ng + n, 0, 255);
    d[i + 2] = clamp(nb + n, 0, 255);
  }
  ctx.putImageData(img, 0, 0);
}

// A duplicate of a panel tinted with one ink, used as a misregistered plate.
export function tintedCopy(src, color) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'source-over';
  return c;
}

// Coarse dot screen. tile ~9px at 1080 so the dots remain legible in a
// contact-sheet thumbnail; radius controls how much ink each dot lays down.
export function makeHalftonePattern(tile, color, radiusFactor = 0.34) {
  const c = document.createElement('canvas');
  c.width = c.height = tile;
  const x = c.getContext('2d');
  x.fillStyle = color;
  x.beginPath();
  x.arc(tile / 2, tile / 2, tile * radiusFactor, 0, Math.PI * 2);
  x.fill();
  return c;
}

export function makeHatchPattern(tile, color = 'rgba(255,233,168,0.4)') {
  const c = document.createElement('canvas');
  c.width = c.height = tile;
  const x = c.getContext('2d');
  x.strokeStyle = color;
  x.lineWidth = 1;
  x.beginPath();
  x.moveTo(-tile, tile);
  x.lineTo(tile, -tile);
  x.moveTo(0, tile * 2);
  x.lineTo(tile * 2, 0);
  x.stroke();
  return c;
}

// Flat, cut-screen sunburst printed behind the panel stack: a solid disc,
// hard horizontal cuts and concentric halftone rings.
export function drawSun(ctx, W, H, ramp, strength) {
  const cx = W * 0.5;
  const cy = H * 0.44;
  const R = Math.min(W, H) * 0.6;
  const disc = R * 0.46;
  ctx.save();

  ctx.fillStyle = rgbToCss(rampColor(ramp, 0.96), 0.95 * strength);
  ctx.beginPath();
  ctx.arc(cx, cy, disc, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = rgbToCss(rampColor(ramp, 0.24), 0.9 * strength);
  for (let i = 0; i < 8; i++) {
    const y = cy + disc * (0.10 + i * 0.115);
    const band = disc * (0.018 + i * 0.008);
    ctx.fillRect(cx - disc, y, disc * 2, band);
  }

  const step = Math.max(9, W * 0.013);
  for (let r = disc + step; r < R; r += step) {
    const f = 1 - r / R;
    const dotR = step * 0.42 * Math.pow(f, 0.7);
    if (dotR < 0.4) continue;
    const count = Math.max(10, Math.round((2 * Math.PI * r) / (step * 1.15)));
    ctx.fillStyle = rgbToCss(rampColor(ramp, 0.25 + 0.72 * f), (0.2 + 0.5 * f) * strength);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + r * 0.011;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export function drawGrain(ctx, W, H, strength) {
  if (!noiseTile) {
    noiseTile = document.createElement('canvas');
    noiseTile.width = noiseTile.height = 160;
    const nx = noiseTile.getContext('2d');
    const nd = nx.createImageData(160, 160);
    for (let i = 0; i < nd.data.length; i += 4) {
      const light = Math.random() > 0.5;
      nd.data[i] = nd.data[i + 1] = nd.data[i + 2] = light ? 255 : 0;
      nd.data[i + 3] = Math.random() * 64;
    }
    nx.putImageData(nd, 0, 0);
  }
  const pat = ctx.createPattern(noiseTile, 'repeat');
  ctx.save();
  ctx.globalAlpha = 0.62 * strength;
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

export function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

// Crop/registration crosses, printed just outside the image field.
export function drawRegMarks(ctx, W, H, accent) {
  const pts = [
    [W * 0.018, H * 0.255],
    [W * 0.982, H * 0.255],
    [W * 0.018, H * 0.965],
    [W * 0.982, H * 0.965],
  ];
  const r = Math.max(5, W * 0.006);
  ctx.save();
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = Math.max(1, W * 0.001);
  for (const [x, y] of pts) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.moveTo(x - r * 1.7, y);
    ctx.lineTo(x + r * 1.7, y);
    ctx.moveTo(x, y - r * 1.7);
    ctx.lineTo(x, y + r * 1.7);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.4;
  ctx.strokeRect(W * 0.012, H * 0.012, W * 0.976, H * 0.976);
  ctx.restore();
}

export function inkColor(hex, alpha) {
  const c = hexToRgb(hex);
  return rgbToCss(c, alpha);
}

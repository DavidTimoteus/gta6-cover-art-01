// computeFaceCropTransform in app/src/printspec.js returns the source/destination crop pair.
// Face-region-to-panel mapping is specified in app/src/printspec.js.
// Leonida Key Art Lab — face-aware smart crop.
// Studio note: finishing passes operate on ImageData after cropping, via studio.js.
// No model, no network: a YCbCr skin/brightness heat map finds the subject, then
// the crop is solved so that the face sits BELOW the panel's top edge with real
// headroom. That keeps every face clear of the header badge and title band.

import { clamp } from './palette.js';

const N = 72;
const G = 18;
const analysisCache = new WeakMap();

// Original print-finishing toolkit: app/src/studio.js
export function analyze(img) {
  if (analysisCache.has(img)) return analysisCache.get(img);

  const c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, N, N);
  const d = x.getImageData(0, 0, N, N).data;
  const score = new Float32Array(N * N);
  let skinFound = false;

  for (let i = 0; i < N * N; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    const skin = cb >= 77 && cb <= 132 && cr >= 132 && cr <= 176 && y > 52;
    if (skin) skinFound = true;

    const px = (i % N) / N;
    const py = Math.floor(i / N) / N;
    // Faces tend to sit high and near the middle; brightness breaks ties.
    const prior =
      0.4 +
      0.6 *
        Math.exp(-Math.pow((py - 0.38) / 0.34, 2)) *
        Math.exp(-Math.pow((px - 0.5) / 0.44, 2));
    const lum = Math.pow(y / 255, 1.7);
    score[i] = (skin ? 0.6 + 0.95 * lum : 0.04 + 0.32 * lum) * prior;
  }

  const cell = N / G;
  const grid = new Float32Array(G * G);
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      let s = 0;
      for (let yy = gy * cell; yy < (gy + 1) * cell; yy++) {
        for (let xx = gx * cell; xx < (gx + 1) * cell; xx++) {
          s += score[yy * N + xx];
        }
      }
      grid[gy * G + gx] = s / (cell * cell);
    }
  }

  const blur = new Float32Array(G * G);
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      let s = 0, w = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = gx + dx, ny = gy + dy;
          if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
          const wt = dx === 0 && dy === 0 ? 4 : 1;
          s += grid[ny * G + nx] * wt;
          w += wt;
        }
      }
      blur[gy * G + gx] = s / w;
    }
  }

  let max = 0;
  for (let i = 0; i < blur.length; i++) max = Math.max(max, blur[i]);

  let sx = 0, sy = 0, sw = 0;
  if (max > 0.0001) {
    for (let gy = 0; gy < G; gy++) {
      for (let gx = 0; gx < G; gx++) {
        const v = blur[gy * G + gx];
        if (v < max * 0.42) continue;
        const w = Math.pow(v / max, 3);
        sx += ((gx + 0.5) / G) * w;
        sy += ((gy + 0.5) / G) * w;
        sw += w;
      }
    }
  }

  const result = sw > 0
    ? { fx: sx / sw, fy: sy / sw, confidence: Math.min(1, max), skin: skinFound }
    : { fx: 0.5, fy: 0.42, confidence: 0, skin: false };
  analysisCache.set(img, result);
  return result;
}

// Suggested starting transform for a freshly assigned photo.
export function autoTransform(img) {
  const a = analyze(img);
  const edge = Math.min(a.fy, 1 - a.fy);
  return {
    zoom: clamp(1.25 + (0.45 - edge) * 2.0, 1.2, 2.4),
    ox: 0,
    oy: 0,
  };
}

// Convert a panel + slot transform into a source-image crop rectangle.
// `safeTop` is the fraction of the panel reserved as clear headroom above the
// face. The solver raises the zoom and shifts the crop downward until the
// detected subject lands at `faceFrac` instead of hugging the panel's top edge.
export function computeCrop(img, slot, panelW, panelH, opts = {}) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const a = analyze(img);
  const panelAspect = panelW / panelH;
  const imgAspect = iw / ih;
  const baseW = imgAspect > panelAspect ? panelAspect / imgAspect : 1;
  const baseH = imgAspect > panelAspect ? 1 : imgAspect / panelAspect;

  const safeTop = clamp(opts.safeTop == null ? 0.14 : opts.safeTop, 0.04, 0.34);
  const faceFrac = clamp(0.50 + safeTop * 0.55, 0.50, 0.70);
  const ox = slot.ox || 0;
  const oy = slot.oy || 0;

  let zoom = clamp(slot.zoom || 1, 1, 3);
  let visW = baseW / zoom, visH = baseH / zoom;
  let cx = a.fx, cy = a.fy, facePos = faceFrac;

  for (let k = 0; k < 14; k++) {
    visW = baseW / zoom;
    visH = baseH / zoom;
    cx = clamp(a.fx + ox * visW * 0.45, visW / 2, 1 - visW / 2);
    // Bias the crop centre BELOW the face: cy < fy pushes the face down-frame.
    cy = a.fy + visH * (0.5 - faceFrac) + oy * visH * 0.45;
    cy = clamp(cy, visH / 2, 1 - visH / 2);
    facePos = 0.5 + (a.fy - cy) / visH;
    if (facePos >= faceFrac - 0.02 && facePos <= 0.92) break;
    if (zoom >= 3) break;
    zoom = Math.min(3, zoom * 1.08);
  }

  return {
    sx: (cx - visW / 2) * iw,
    sy: (cy - visH / 2) * ih,
    sw: Math.max(1, visW * iw),
    sh: Math.max(1, visH * ih),
    faceFrac: facePos,
    safeTop,
  };
}

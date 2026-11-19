/*
 * render.js
 * Compositor that paints a complete poster into a 2D canvas.
 *
 * The pipeline is: wallpaper -> five photo/ink panels -> print finishing ->
 * registration furniture -> title, tagline and badge.  Type is drawn last so
 * the halftone affects the imagery but the headline stays legible.
 */

import { getPalette } from './palette.js';
import { PANELS, SIZE_PRESETS, panelToCanvasRect, computeTitleBand, getHeroPanel } from './layouts.js';
import { computeSourceRect, detectFocusPoint } from './smartcrop.js';
import { applyFinish } from './effects.js';

/** Local-only stack: no @font-face, no web fonts, no network fetches. */
export const TITLE_FONT_STACK = '"Arial Narrow", "Helvetica Neue Condensed", Impact, "Franklin Gothic Medium", Arial, sans-serif';
export const TEXT_FONT_STACK = '"Trebuchet MS", "Helvetica Neue", Arial, sans-serif';

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, lo, hi) {
  const n = num(v, lo);
  return n < lo ? lo : (n > hi ? hi : n);
}

/** Paint the vertical wallpaper gradient behind all panels. */
function paintWallpaper(ctx, w, h, palette) {
  const stops = (palette.stops && palette.stops.length ? palette.stops : [
    { offset: 0, color: palette.cream },
    { offset: 1, color: palette.plum },
  ]);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  stops.forEach((stop) => grad.addColorStop(clamp(stop.offset, 0, 1), stop.color));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // A soft vignette keeps the eye in the duo panel.
  const vignette = ctx.createRadialGradient(w * 0.5, h * 0.55, h * 0.1, w * 0.5, h * 0.55, h * 0.85);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(27,16,53,0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Draw a single panel.  With no image it becomes a flat ink field tinted by
 * the panel role, which is exactly how an empty editor panel should look.
 */
export function drawPanel(ctx, rect, img, srcRect, palette) {
  if (!ctx || !rect) return;
  const x = num(rect.x, 0);
  const y = num(rect.y, 0);
  const w = Math.max(1, num(rect.w, 1));
  const h = Math.max(1, num(rect.h, 1));

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // Ink field underneath the photo (also the fallback when no photo exists).
  const field = rect.duo ? (palette.magenta || palette.wash) : (palette.cool || palette.cyan);
  ctx.fillStyle = field;
  ctx.fillRect(x, y, w, h);

  const iw = img ? num(img.naturalWidth || img.width, 0) : 0;
  const ih = img ? num(img.naturalHeight || img.height, 0) : 0;

  if (img && iw > 0 && ih > 0) {
    const s = srcRect || { x: 0, y: 0, w: 1, h: 1 };
    const sx = clamp(s.x, 0, 1) * iw;
    const sy = clamp(s.y, 0, 1) * ih;
    const sw = Math.max(1, clamp(s.w, 0.02, 1) * iw);
    const sh = Math.max(1, clamp(s.h, 0.02, 1) * ih);
    try {
      ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    } catch (err) {
      // Leave the flat ink field in place if the source cannot be drawn.
    }

    // Duotone wash binds the photograph to the poster palette.
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = rect.duo ? (palette.wash || palette.magenta) : (palette.ink || palette.plum);
    ctx.globalAlpha = rect.duo ? 0.28 : 0.38;
    ctx.fillRect(x, y, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  } else {
    // Posterized ink bands for an empty panel.
    ctx.fillStyle = palette.plum;
    ctx.globalAlpha = 0.22;
    ctx.fillRect(x, y + h * 0.62, w, h * 0.38);
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // Hairline keyline around every panel.
  ctx.save();
  ctx.strokeStyle = palette.ink || palette.plum;
  ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.006);
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.restore();
}

/** Convert a panel state into the normalized source rectangle drawPanel wants. */
function sourceRectFor(state, photo, panel) {
  if (!photo) return { x: 0, y: 0, w: 1, h: 1 };
  const s = state || {};
  const zoom = clamp(num(s.zoom, 1.2), 1, 3);
  const focus = detectFocusPoint(photo);
  return computeSourceRect(photo, zoom, num(s.x, 0), num(s.y, 0), focus);
}

/**
 * Draw a line of bold condensed lettering horizontally scaled to `maxWidth`.
 * Stroke and drop-shadow give the diecut sticker feel.
 */
export function drawCondensedLine(ctx, text, x, y, maxWidth, fontSize, palette, options) {
  const opts = options || {};
  const words = String(text == null ? '' : text).toUpperCase();
  if (!words || fontSize <= 0 || maxWidth <= 0) return { width: 0, scale: 1 };

  const stack = opts.fontStack || TITLE_FONT_STACK;
  ctx.save();
  ctx.font = `900 ${fontSize}px ${stack}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  const natural = Math.max(1, ctx.measureText(words).width);
  let scale = clamp(num(opts.condense, 0.82), 0.5, 1);
  if (natural * scale > maxWidth) scale = maxWidth / natural;
  const drawnWidth = natural * scale;

  const shadow = opts.shadow !== false;
  if (shadow) {
    ctx.shadowColor = opts.shadowColor || (palette.ink || palette.plum);
    ctx.shadowBlur = fontSize * 0.18;
    ctx.shadowOffsetX = fontSize * 0.05;
    ctx.shadowOffsetY = fontSize * 0.07;
  }

  ctx.translate(x, y);
  ctx.scale(scale, 1);
  ctx.lineJoin = 'round';
  ctx.lineWidth = fontSize * 0.075;
  ctx.strokeStyle = opts.stroke || (palette.ink || palette.plum);
  ctx.strokeText(words, 0, 0);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = opts.fill || (palette.cream || '#FFE29A');
  ctx.fillText(words, 0, 0);
  ctx.restore();

  return { width: drawnWidth, scale };
}

/**
 * Title, tagline and a thin rule, all placed inside the safe title band.
 * `layout` is a pixel rect (see computeTitleBand).
 */
export function drawType(ctx, layout, title, tagline, palette) {
  if (!ctx || !layout) return;
  const w = num(layout.w, 0);
  const h = num(layout.h, 0);
  if (w <= 0 || h <= 0) return;
  const x = num(layout.x, 0) + num(layout.safeInset, 0) * 0.4;
  const maxWidth = w - num(layout.safeInset, 0) * 0.8;

  let fontSize = h * 0.66;
  const heading = String(title == null ? '' : title) || 'UNTITLED';
  ctx.save();
  ctx.font = `900 ${fontSize}px ${TITLE_FONT_STACK}`;
  const natural = Math.max(1, ctx.measureText(heading.toUpperCase()).width);
  fontSize = Math.min(fontSize, (maxWidth / natural) * fontSize / 0.82);
  ctx.restore();

  const baseline = num(layout.y, 0) + h * 0.72;
  drawCondensedLine(ctx, heading, x, baseline, maxWidth, fontSize, palette, { condense: 0.84 });

  // Accent rule under the headline.
  const ruleY = num(layout.y, 0) + h * 0.86;
  ctx.save();
  ctx.strokeStyle = palette.accent || palette.coral;
  ctx.lineWidth = Math.max(2, h * 0.018);
  ctx.beginPath();
  ctx.moveTo(x, ruleY);
  ctx.lineTo(x + maxWidth * 0.34, ruleY);
  ctx.stroke();
  ctx.restore();

  // Tagline in a small tracked sans stack.
  const sub = String(tagline == null ? '' : tagline);
  if (sub) {
    const subSize = clamp(h * 0.16, 10, 46);
    ctx.save();
    ctx.font = `700 ${subSize}px ${TEXT_FONT_STACK}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = palette.ink || palette.plum;
    const tracked = sub.toUpperCase().split('').join('\u2009');
    ctx.fillText(tracked, x, ruleY + h * 0.05, maxWidth);
    ctx.restore();
  }
}

/** Small registration badge, normally parked over the hero panel corner. */
export function drawBadge(ctx, rect, text, palette) {
  if (!ctx || !rect) return;
  const x = num(rect.x, 0);
  const y = num(rect.y, 0);
  const w = Math.max(24, num(rect.w, 120));
  const h = Math.max(20, num(rect.h, 44));
  const label = String(text == null ? '' : text) || 'LK-01';

  ctx.save();
  ctx.fillStyle = palette.ink || palette.plum;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = palette.cream || '#FFE29A';
  ctx.lineWidth = Math.max(1, h * 0.05);
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

  ctx.fillStyle = palette.cyan || palette.accent || '#00E5C5';
  ctx.font = `700 ${h * 0.46}px ${TEXT_FONT_STACK}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(label.toUpperCase(), x + w / 2, y + h / 2 + h * 0.02, w * 0.86);
  ctx.restore();
}

/** Draw printer's crop marks in the four corners of the sheet. */
function drawRegistrationMarks(ctx, w, h, palette) {
  const m = Math.min(w, h) * 0.018;
  const len = m * 0.9;
  ctx.save();
  ctx.strokeStyle = palette.ink || palette.plum;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(1, m * 0.1);
  const corners = [
    [m, m, 1, 1],
    [w - m, m, -1, 1],
    [m, h - m, 1, -1],
    [w - m, h - m, -1, -1],
  ];
  corners.forEach(([cx, cy, sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy + sy * len);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + sx * len, cy);
    ctx.stroke();
  });
  ctx.restore();
}

/** Paint the complete poster described by `config` into `canvas`. */
export function renderCover(canvas, config) {
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  const cfg = config || {};
  const w = Math.max(1, Math.floor(num(cfg.width, canvas.width || 1080)));
  const h = Math.max(1, Math.floor(num(cfg.height, canvas.height || 1080)));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const palette = cfg.palette && cfg.palette.ink ? cfg.palette : getPalette(cfg.grade || 'sunset');
  const panels = Array.isArray(cfg.panels) && cfg.panels.length ? cfg.panels : PANELS;
  const panelStates = Array.isArray(cfg.panelStates) ? cfg.panelStates : [];
  const photos = cfg.photos || {};

  ctx.save();
  ctx.clearRect(0, 0, w, h);
  paintWallpaper(ctx, w, h, palette);

  // Panels first, so the finishing pass can screen them like printed ink.
  panels.forEach((panel, index) => {
    const rect = panelToCanvasRect(panel, w, h);
    rect.duo = Boolean(panel.duo);
    const state = panelStates[index] || {};
    const sourceKey = state.source;
    const photo = sourceKey && sourceKey !== 'none' ? photos[sourceKey] : null;
    const srcRect = sourceRectFor(state, photo, panel);
    drawPanel(ctx, rect, photo, srcRect, palette);
  });

  applyFinish(ctx, w, h, palette, {
    width: w,
    posterizeLevels: 5,
    halftoneAngle: 0.38,
    halftonePitch: 5.2,
    grainAmount: 0.05,
    offsetX: 1.2,
    offsetY: -0.7,
    seed: 20261119,
  });
  ctx.restore();

  const band = computeTitleBand(w, h, panels);
  drawType(ctx, band, cfg.title, cfg.tagline, palette);

  const hero = getHeroPanel(panels);
  if (hero) {
    const heroRect = panelToCanvasRect(hero, w, h);
    drawBadge(ctx, {
      x: heroRect.x + heroRect.w * 0.72,
      y: heroRect.y + heroRect.h * 0.035,
      w: Math.min(heroRect.w * 0.26, w * 0.12),
      h: Math.max(18, h * 0.032),
    }, cfg.badge, palette);
  }

  drawRegistrationMarks(ctx, w, h, palette);
  return canvas;
}

/**
 * Build a fresh canvas at a named size preset (or explicit width/height) and
 * render into it.  Used by the ?shot=cover-preview capture path.
 */
export function createPosterCanvas(config) {
  const cfg = config || {};
  let width = num(cfg.width, 0);
  let height = num(cfg.height, 0);
  if (!width || !height) {
    const preset = SIZE_PRESETS[cfg.size] || SIZE_PRESETS.square;
    width = preset.w;
    height = preset.h;
  }
  const canvas = typeof document !== 'undefined'
    ? document.createElement('canvas')
    : { width: 0, height: 0, getContext: () => null };
  canvas.width = Math.floor(width);
  canvas.height = Math.floor(height);
  return renderCover(canvas, { ...cfg, width, height });
}

/** Alias emphasising the preview use case. */
export function getPosterCanvas(config) {
  return createPosterCanvas(config);
}

/*
 * Poster compositor.
 *
 * `renderPoster` paints a complete five-panel cover into any canvas.  It is
 * deliberately tolerant of half-built config objects so the editor can call
 * it while photos are still loading.  Typography uses only local system font
 * stacks; there are no web fonts and no external requests of any kind.
 */

import { PALETTE, getGrade, gradientStops, pickInk } from './palette.js';
import { getTitleZone, getBadgeZone } from './layouts.js';
import { computeCropRects } from './smartcrop.js';

const DISPLAY_STACK = '"Arial Black", Impact, "Arial Narrow", "Helvetica Neue", sans-serif';
const LABEL_STACK = '"Arial Narrow", Arial, Helvetica, sans-serif';

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function callEffect(fn, ...args) {
  if (typeof fn !== 'function') return null;
  try {
    return fn(...args);
  } catch (error) {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * drawing primitives
 * ------------------------------------------------------------------ */

function paintBackdrop(ctx, width, height, grade) {
  const first = grade.ink[0] || PALETTE.plum;
  ctx.fillStyle = first;
  ctx.fillRect(0, 0, width, height);

  const stops = gradientStops(grade, 6);
  const glow = ctx.createLinearGradient(0, 0, width * 0.35, height);
  stops.forEach((stop) => glow.addColorStop(stop.offset, stop.color));
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 1;
}

function paintPanel(ctx, panel, index, grade, effects) {
  const x = panel.x;
  const y = panel.y;
  const w = panel.w;
  const h = panel.h;
  const inks = grade.ink.length ? grade.ink : [PALETTE.plum, PALETTE.magenta];
  const flat = inks[(index + 1) % inks.length];

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  const crop = panel.crop;
  if (panel.image && crop && Number.isFinite(crop.sw) && crop.sw > 0) {
    try {
      ctx.drawImage(panel.image, crop.sx, crop.sy, crop.sw, crop.sh, x, y, w, h);
    } catch (error) {
      ctx.fillStyle = flat;
      ctx.fillRect(x, y, w, h);
    }
  } else if (panel.image && panel.focus && panel.sourceWidth) {
    // A raw image with only a focus point: derive the frame locally.
    const rect = computeCropRects(panel.focus, panel.sourceWidth, panel.sourceHeight, panel, {
      zoom: panel.zoom || 1,
      respectBadge: index === 0
    });
    try {
      ctx.drawImage(panel.image, rect.src.x, rect.src.y, rect.src.w, rect.src.h, x, y, w, h);
    } catch (error) {
      ctx.fillStyle = flat;
      ctx.fillRect(x, y, w, h);
    }
  } else {
    ctx.fillStyle = flat;
    ctx.fillRect(x, y, w, h);
  }

  // A tonal wash unifies photographs that were shot under different light.
  const wash = ctx.createLinearGradient(x, y, x + w, y + h);
  wash.addColorStop(0, grade.accent);
  wash.addColorStop(1, inks[0]);
  ctx.globalAlpha = panel.duo ? 0.10 : 0.20;
  ctx.fillStyle = wash;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.restore();

  callEffect(effects.applyHalftone, ctx, x, y, w, h, {
    pitch: Math.max(4, Math.round(w / 150)),
    angle: panel.duo ? 45 : 15,
    ink: inks[Math.min(inks.length - 1, 1)],
    paper: grade.paper,
    strength: 0.55 + grade.halftone * 0.45
  });

  ctx.save();
  ctx.strokeStyle = panel.duo ? grade.accent : inks[Math.min(2, inks.length - 1)];
  ctx.lineWidth = Math.max(2, w * 0.006);
  ctx.strokeRect(x, y, w, h);

  // Registration ticks in the corners sell the proof-sheet look.
  const tick = Math.max(6, Math.min(w, h) * 0.035);
  ctx.lineWidth = Math.max(1, tick * 0.12);
  ctx.beginPath();
  ctx.moveTo(x, y + tick); ctx.lineTo(x, y); ctx.lineTo(x + tick, y);
  ctx.moveTo(x + w - tick, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - tick);
  ctx.stroke();
  ctx.restore();
}

/** Split long titles into at most two balanced lines. */
export function titleLines(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  if (words.length <= 2 || String(text).length <= 11) return [words.join(' ')];
  const half = Math.ceil(words.length / 2);
  return [words.slice(0, half).join(' '), words.slice(half).join(' ')];
}

/**
 * Draw a condensed display title that is stroked, shadowed and squeezed to
 * fit the title zone.  Horizontal scaling, rather than a font file, provides
 * the narrow poster lettering.
 */
export function drawTitle(ctx, text, zone, options = {}) {
  const inks = options.ink || [PALETTE.plum];
  const accent = options.accent || PALETTE.cyan;
  const paper = options.paper || PALETTE.cream;
  const lines = titleLines(text);
  const cx = zone.x + zone.w / 2;
  const lineGap = lines.length > 1 ? 0.90 : 1;
  const largest = Math.min(
    zone.h * 0.42 / lines.length * lineGap,
    zone.w * 0.92 / Math.max(4, String(text).length * 0.58)
  );
  const size = Math.max(12, finite(options.fontSize, largest));

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${size}px ${DISPLAY_STACK}`;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = inks[0] || PALETTE.plum;
  ctx.lineWidth = Math.max(2, size * 0.075);
  ctx.shadowColor = accent;
  ctx.shadowBlur = Math.max(2, size * 0.16);
  ctx.shadowOffsetX = size * 0.03;
  ctx.shadowOffsetY = size * 0.05;
  ctx.fillStyle = paper;

  lines.forEach((line, row) => {
    const measured = Math.max(1, ctx.measureText(line).width);
    const allowed = zone.w * 0.92;
    const squeeze = Math.min(1.25, allowed / measured);
    const y = zone.y + zone.h * 0.42
      + (row - (lines.length - 1) / 2) * size * lineGap;
    ctx.save();
    ctx.translate(cx, y);
    ctx.scale(squeeze, 1);
    ctx.strokeText(line, 0, 0);
    ctx.shadowColor = 'transparent';
    ctx.fillText(line, 0, 0);
    ctx.restore();
  });
  ctx.restore();
}

function drawTagline(ctx, text, zone, options = {}) {
  const width = zone.w;
  const label = String(text || '').trim();
  if (!label) return;
  const size = clamp(zone.h * 0.075, 10, width * 0.032);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${size}px ${LABEL_STACK}`;
  ctx.fillStyle = options.color || PALETTE.cyan;
  const tracking = size * 0.22;
  const glyphs = Array.from(label);
  const total = glyphs.reduce((sum, char) => sum + ctx.measureText(char).width + tracking, -tracking);
  let cursor = zone.x + (width - total) / 2;
  const baseline = zone.y + zone.h * 0.86;
  glyphs.forEach((char) => {
    const advance = ctx.measureText(char).width;
    ctx.textAlign = 'left';
    ctx.fillText(char, cursor, baseline);
    cursor += advance + tracking;
  });
  ctx.restore();
}

function drawBadge(ctx, text, width, height, grade) {
  const box = getBadgeZone(width, height);
  ctx.save();
  ctx.fillStyle = grade.accent;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = grade.ink[0] || PALETTE.plum;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = Math.max(9, box.h * 0.62);
  ctx.font = `900 ${size}px ${DISPLAY_STACK}`;
  ctx.fillText(String(text || '').trim(), box.x + box.w / 2, box.y + box.h / 2);
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * public API
 * ------------------------------------------------------------------ */

/**
 * Paint a finished poster.  `fx` is the bundle of effect adapters from
 * effects.js; missing entries are skipped rather than failing the render.
 */
export function renderPoster(canvas, config = {}, fx = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') return canvas;

  const width = Math.max(1, Math.round(finite(config.width, canvas.width || 1080)));
  const height = Math.max(1, Math.round(finite(config.height, canvas.height || 1350)));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const grade = config.grade || getGrade('sunset');
  const palette = config.palette || PALETTE;
  const effects = fx || {};
  const panels = Array.isArray(config.panels) ? config.panels : [];
  const zone = config.titleZone || getTitleZone(width, height);

  paintBackdrop(ctx, width, height, grade);

  panels.forEach((panel, index) => {
    if (panel) paintPanel(ctx, panel, index, grade, effects);
  });

  ctx.save();
  ctx.fillStyle = grade.ink[0] || palette.plum;
  ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
  ctx.fillStyle = grade.accent;
  ctx.fillRect(zone.x, zone.y, zone.w, Math.max(2, height * 0.004));
  ctx.fillRect(zone.x, zone.y + zone.h - Math.max(2, height * 0.004), zone.w, Math.max(2, height * 0.004));
  ctx.restore();

  drawTitle(ctx, config.title || 'COPPER HALO', zone, {
    ink: grade.ink,
    accent: grade.accent,
    paper: grade.paper
  });
  drawTagline(ctx, config.tagline || 'EVERY EMPIRE HAS A PRICE', zone, {
    color: grade.accent
  });
  drawBadge(ctx, config.badge || 'LK-01', width, height, grade);

  const register = grade.misregister * width * 0.0018;
  callEffect(effects.applyMisregistration, ctx, { dx: register, dy: register * 0.35, width, height });
  callEffect(effects.applyGrain, ctx, width, height, {
    amount: grade.grain * 0.28,
    seed: 9127 + panels.length
  });

  ctx.save();
  ctx.strokeStyle = pickInk(grade.ink[0], grade.paper, grade.accent);
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = Math.max(2, width * 0.0025);
  ctx.strokeRect(width * 0.012, height * 0.012, width * 0.976, height * 0.976);
  ctx.restore();

  return canvas;
}

/** Build a fresh canvas, paint a poster into it and hand it back. */
export function createCoverCanvas(config = {}, fx = {}) {
  const width = Math.round(finite(config.width, 1080));
  const height = Math.round(finite(config.height, 1350));
  const canvas = typeof document !== 'undefined'
    ? document.createElement('canvas')
    : { width, height, getContext: () => null };
  canvas.width = width;
  canvas.height = height;
  return renderPoster(canvas, config, fx);
}

export const getPosterCanvas = createCoverCanvas;

/** Convenience for the ?shot= cover modes: choose a size by key. */
export function renderCoverSize(sizeKey, config = {}, fx = {}) {
  const sizes = {
    square: [1080, 1080],
    portrait: [1080, 1350],
    wide: [1920, 1080]
  };
  const pair = sizes[sizeKey] || sizes.portrait;
  return createCoverCanvas({ ...config, width: pair[0], height: pair[1] }, fx);
}

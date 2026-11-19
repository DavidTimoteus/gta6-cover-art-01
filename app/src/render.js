/* ============================================================================
 * render.js
 * Compositor that assembles the five-panel cover inside a 2D canvas.
 *
 * renderCover() is intentionally a pure drawing pass: it never touches the
 * finishing filters.  The editor calls applyPrintFinish() afterwards so the
 * screening/grain is applied exactly once.  createCoverCanvas() is the
 * convenience entry point used by the ?shot=cover preview.
 * ==========================================================================*/

import { getPalette, parseColor, rgbaToCss, getGradientStops } from './palette.js';
import {
  COVER_SIZES,
  PANEL_IDS,
  getPanels,
  getDuoHalves,
  getTitleBand,
  getTaglineBand,
  getBadgeRect,
  getPrintFrame,
} from './layouts.js';
import { faceAwareCrop, centeredCrop } from './smartcrop.js';
import { applyPrintFinish } from './effects.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

const CONDENSED_STACK = '"Arial Narrow", "Helvetica Neue Condensed", '
  + '"Liberation Sans Narrow", "DejaVu Sans Condensed", Impact, '
  + 'system-ui, "Segoe UI", sans-serif';

/* ------------------------------------------------------------ source lookup */
function resolveImage(options, key) {
  if (!options || !options.photos) return null;
  if (key === 'duo') {
    const duo = options.duo || {};
    return options.photos[duo.a] || options.photos[duo.b] || null;
  }
  return options.photos[key] || null;
}

function configFor(options, id) {
  const state = options && options.panelState;
  if (state && state[id]) return state[id];
  return { source: id === 'center' ? 'duo' : id, zoom: 1, x: 0, y: 0 };
}

/* -------------------------------------------------------------- crop maths */
/**
 * Draw an image so it fills a rect like CSS "cover", applying pan/zoom.
 * The pan convention matches smartcrop.js exactly.
 */
function drawCoverImage(ctx, image, rect, crop) {
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  if (!w || !h || !rect.w || !rect.h) return false;

  const zoom = clamp(crop.zoom == null ? 1 : crop.zoom, 1, 3);
  const panX = clamp(crop.x == null ? 0 : crop.x, -1, 1);
  const panY = clamp(crop.y == null ? 0 : crop.y, -1, 1);

  const scale = Math.max(rect.w / w, rect.h / h) * zoom;
  const drawW = w * scale;
  const drawH = h * scale;
  const extraX = Math.max(0, (drawW - rect.w) / 2);
  const extraY = Math.max(0, (drawH - rect.h) / 2);

  let left = rect.x - extraX * (1 + panX);
  let top = rect.y - extraY * (1 + panY);

  // Guard against any sliver of empty paper at the rect edges.
  if (left > rect.x) left = rect.x;
  if (top > rect.y) top = rect.y;
  if (left + drawW < rect.x + rect.w) left = rect.x + rect.w - drawW;
  if (top + drawH < rect.y + rect.h) top = rect.y + rect.h - drawH;

  try {
    ctx.drawImage(image, left, top, drawW, drawH);
    return true;
  } catch (error) {
    return false;
  }
}

function fillWithGradientPlate(ctx, rect, palette, variant) {
  const stops = getGradientStops(palette, 5);
  const grad = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
  stops.forEach((stop) => grad.addColorStop(stop.offset, stop.color));
  ctx.fillStyle = grad;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = palette.cyan;
  const step = Math.max(14, rect.h / 9);
  for (let y = rect.y + step * 0.5; y < rect.y + rect.h; y += step) {
    const offset = variant % 2 === 0 ? 0 : step * 0.5;
    ctx.fillRect(rect.x + offset, y, rect.w, Math.max(2, step * 0.08));
  }
  ctx.restore();
}

/* ---------------------------------------------------------------- panels */
function drawPanel(ctx, panel, options, palette) {
  const cfg = configFor(options, panel.id);
  let crop = cfg;

  if (!Number.isFinite(cfg.x) || !Number.isFinite(cfg.y)) {
    const image = resolveImage(options, cfg.source);
    crop = image
      ? faceAwareCrop(image, panel, { zoom: cfg.zoom, focusY: 0.34 })
      : centeredCrop(cfg.zoom);
  }

  const image = resolveImage(options, cfg.source);
  ctx.save();
  ctx.beginPath();
  ctx.rect(panel.x, panel.y, panel.w, panel.h);
  ctx.clip();

  if (image && drawCoverImage(ctx, image, panel, crop)) {
    // A translucent two-tone wash binds the plates to the chosen ink grade.
    ctx.globalAlpha = 0.20;
    const wash = ctx.createLinearGradient(panel.x, panel.y, panel.x, panel.y + panel.h);
    wash.addColorStop(0, rgbaToCss(palette.magenta, 0.9));
    wash.addColorStop(1, rgbaToCss(palette.plum, 0.95));
    ctx.fillStyle = wash;
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    ctx.globalAlpha = 1;
  } else {
    fillWithGradientPlate(ctx, panel, palette, PANEL_IDS.indexOf(panel.id));
  }

  ctx.restore();
}

function drawDuoPanel(ctx, panel, options, palette) {
  const cfg = configFor(options, panel.id);
  const duo = options.duo || {};
  const halves = getDuoHalves(options.width, options.height);
  const plates = [duo.a, duo.b];

  ctx.save();
  ctx.beginPath();
  ctx.rect(panel.x, panel.y, panel.w, panel.h);
  ctx.clip();

  halves.forEach((half, index) => {
    const image = resolveImage(options, plates[index] || cfg.source);
    const crop = {
      zoom: cfg.zoom != null ? cfg.zoom : 1,
      x: cfg.x || 0,
      y: cfg.y || 0,
    };
    if (!image) {
      fillWithGradientPlate(ctx, half, palette, index);
      return;
    }
    if (drawCoverImage(ctx, image, half, crop)) {
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = rgbaToCss(index === 0 ? palette.magenta : palette.plum, 1);
      ctx.fillRect(half.x, half.y, half.w, half.h);
      ctx.globalAlpha = 1;
    } else {
      fillWithGradientPlate(ctx, half, palette, index);
    }
  });

  // Hairline down the centre seam of the duo.
  const seamX = halves[0] ? halves[0].x + halves[0].w : panel.x + panel.w / 2;
  ctx.strokeStyle = rgbaToCss(palette.cream, 0.65);
  ctx.lineWidth = Math.max(1, options.width * 0.0016);
  ctx.beginPath();
  ctx.moveTo(seamX, panel.y);
  ctx.lineTo(seamX, panel.y + panel.h);
  ctx.stroke();

  ctx.restore();
}

function drawPanelFrames(ctx, panels, palette, width) {
  const line = Math.max(2, width * 0.0028);
  ctx.save();
  ctx.lineWidth = line;
  ctx.strokeStyle = palette.plum;
  panels.forEach((panel) => {
    ctx.strokeRect(panel.x, panel.y, panel.w, panel.h);
  });
  ctx.lineWidth = line * 0.4;
  ctx.strokeStyle = rgbaToCss(palette.cream, 0.55);
  panels.forEach((panel) => {
    ctx.strokeRect(panel.x + line, panel.y + line, panel.w - line * 2, panel.h - line * 2);
  });
  ctx.restore();
}

/* ---------------------------------------------------------------- background */
function drawBackground(ctx, options, palette) {
  const { width, height } = options;
  const grad = ctx.createLinearGradient(0, 0, width * 0.4, height);
  grad.addColorStop(0, palette.plum);
  grad.addColorStop(0.55, palette.magenta);
  grad.addColorStop(1, palette.plum);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Soft halo echoing the title.
  const halo = ctx.createRadialGradient(
    width * 0.5, height * 0.30, width * 0.02,
    width * 0.5, height * 0.30, width * 0.55,
  );
  halo.addColorStop(0, rgbaToCss(palette.amber, 0.42));
  halo.addColorStop(0.5, rgbaToCss(palette.coral, 0.16));
  halo.addColorStop(1, rgbaToCss(palette.plum, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, width, height);
}

function drawPrintFrame(ctx, options, palette) {
  const frame = getPrintFrame(options.width, options.height);
  ctx.save();
  ctx.strokeStyle = rgbaToCss(palette.cream, 0.7);
  ctx.lineWidth = Math.max(1, options.width * 0.0018);
  ctx.strokeRect(frame.x, frame.y, frame.w, frame.h);
  ctx.restore();
}

/* --------------------------------------------------------------- lettering */
function fitFontSize(ctx, text, maxWidth, startSize) {
  let size = startSize;
  for (let i = 0; i < 14; i += 1) {
    ctx.font = `900 ${size}px ${CONDENSED_STACK}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size *= 0.93;
  }
  return size;
}

/** Draw the title with a hard stroke and a drop shadow in the deep ink. */
function drawTitle(ctx, options, palette) {
  const band = getTitleBand(options.width, options.height);
  const text = String(options.title || 'COPPER HALO').toUpperCase();
  const cx = band.x + band.w / 2;
  const baseline = band.y + band.h * 0.78;
  const start = band.h * 0.82;

  ctx.save();
  ctx.font = `900 ${start}px ${CONDENSED_STACK}`;
  const size = fitFontSize(ctx, text, band.w * 0.94, start);
  ctx.font = `900 ${size}px ${CONDENSED_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';

  const strokeWidth = Math.max(3, size * 0.07);
  ctx.shadowColor = rgbaToCss(palette.plum, 0.85);
  ctx.shadowBlur = size * 0.18;
  ctx.shadowOffsetX = size * 0.045;
  ctx.shadowOffsetY = size * 0.06;

  ctx.lineWidth = strokeWidth * 2.1;
  ctx.strokeStyle = palette.plum;
  ctx.strokeText(text, cx, baseline);

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = palette.coral;
  ctx.strokeText(text, cx, baseline);

  const fill = ctx.createLinearGradient(0, baseline - size, 0, baseline);
  fill.addColorStop(0, palette.cream);
  fill.addColorStop(0.55, palette.amber);
  fill.addColorStop(1, palette.coral);
  ctx.fillStyle = fill;
  ctx.fillText(text, cx, baseline);
  ctx.restore();
}

/** Draw the widely-tracked tagline in the footer band. */
function drawTagline(ctx, options, palette) {
  const band = getTaglineBand(options.width, options.height);
  const text = String(options.tagline || 'EVERY EMPIRE HAS A PRICE').toUpperCase();
  const size = clamp(band.h * 0.72, 10, options.width * 0.02);
  ctx.save();
  ctx.font = `700 ${size}px ${CONDENSED_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = palette.cream;
  ctx.shadowColor = rgbaToCss(palette.plum, 0.9);
  ctx.shadowBlur = size * 0.5;
  const tracking = size * 0.34;
  const widths = Array.from(text).map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * (text.length - 1);
  let cursor = band.x + (band.w - total) / 2;
  const midY = band.y + band.h / 2;
  Array.from(text).forEach((ch, i) => {
    ctx.fillText(ch, cursor + widths[i] / 2, midY);
    cursor += widths[i] + tracking;
  });
  ctx.restore();
}

/** Draw the small LK badge in the top-left of the title band. */
function drawBadge(ctx, options, palette) {
  const rect = getBadgeRect(options.width, options.height);
  const label = String(options.badge || 'LK-01').toUpperCase();
  ctx.save();
  ctx.fillStyle = palette.cyan;
  ctx.strokeStyle = palette.plum;
  ctx.lineWidth = Math.max(1, rect.w * 0.06);
  const r = rect.w * 0.16;
  ctx.beginPath();
  ctx.moveTo(rect.x + r, rect.y);
  ctx.lineTo(rect.x + rect.w - r, rect.y);
  ctx.quadraticCurveTo(rect.x + rect.w, rect.y, rect.x + rect.w, rect.y + r);
  ctx.lineTo(rect.x + rect.w, rect.y + rect.h - r);
  ctx.quadraticCurveTo(rect.x + rect.w, rect.y + rect.h, rect.x + rect.w - r, rect.y + rect.h);
  ctx.lineTo(rect.x + r, rect.y + rect.h);
  ctx.quadraticCurveTo(rect.x, rect.y + rect.h, rect.x, rect.y + rect.h - r);
  ctx.lineTo(rect.x, rect.y + r);
  ctx.quadraticCurveTo(rect.x, rect.y, rect.x + r, rect.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const size = clamp(rect.h * 0.42, 6, options.width * 0.014);
  ctx.font = `800 ${size}px ${CONDENSED_STACK}`;
  ctx.fillStyle = palette.plum;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + size * 0.04);
  ctx.restore();
}

/* ------------------------------------------------------------------ export */
/**
 * Draw a complete poster into the supplied context.  `options` is the object
 * built by main.js: { width, height, palette, grade, panels, photos,
 * panelState, duo, title, tagline, badge }.
 */
export function renderCover(ctx, options) {
  if (!ctx || !options) return null;
  const width = Math.max(1, Math.floor(options.width || 1080));
  const height = Math.max(1, Math.floor(options.height || 1080));
  const palette = options.palette || getPalette(options.grade || 'sunset');
  const panels = Array.isArray(options.panels) && options.panels.length
    ? options.panels
    : getPanels(width, height);
  const normalised = Object.assign({}, options, { width, height, palette, panels });

  ctx.save();
  drawBackground(ctx, normalised, palette);

  panels.forEach((panel) => {
    if (panel.duo || panel.id === 'center') {
      drawDuoPanel(ctx, panel, normalised, palette);
    } else {
      drawPanel(ctx, panel, normalised, palette);
    }
  });

  drawPanelFrames(ctx, panels, palette, width);
  drawPrintFrame(ctx, normalised, palette);
  drawBadge(ctx, normalised, palette);
  drawTitle(ctx, normalised, palette);
  drawTagline(ctx, normalised, palette);
  ctx.restore();

  return { width, height, panels: panels.length };
}

/**
 * Build a finished poster canvas for the ?shot=cover preview.  Accepts either
 * a size key ('square' | 'portrait' | 'wide') or an options object.
 */
export function createCoverCanvas(options) {
  const opts = typeof options === 'string'
    ? Object.assign({ size: options }, COVER_SIZES[options] || {})
    : (options || {});
  const size = opts.size ? (COVER_SIZES[opts.size] || COVER_SIZES.square) : {};
  const width = Math.floor(opts.width || size.width || 1080);
  const height = Math.floor(opts.height || size.height || 1080);
  const canvas = typeof document !== 'undefined'
    ? document.createElement('canvas')
    : { width: 0, height: 0, getContext: () => null };
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const palette = opts.palette || getPalette(opts.grade || 'sunset');
  const panels = Array.isArray(opts.panels) && opts.panels.length
    ? opts.panels
    : getPanels(width, height);
  const full = Object.assign({}, opts, {
    width, height, palette, panels,
    photos: opts.photos || {},
    panelState: opts.panelState || {},
  });
  renderCover(ctx, full);
  applyPrintFinish(ctx, { width, height, palette, grade: opts.grade || 'sunset' });
  return canvas;
}

export const createPosterCanvas = createCoverCanvas;

/** List the supported export dimensions (handy for tools and tests). */
export function listCoverSizes() {
  return Object.keys(COVER_SIZES).map((key) => Object.assign({ key }, COVER_SIZES[key]));
}

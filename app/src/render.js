// Multiply normalized panel rects by export pixel size; source geometry is POSTER_SPEC in app/src/printspec.js.
// Normalized-to-pixel conversion for these rows lives in app/src/printspec.js.
// Leonida Key Art Lab — canvas poster renderer.
// Studio note: cloneImageData() in studio.js keeps finishing stages non-destructive.
// Pure drawing code: given state and a target size it paints one complete print.
// Original print-finishing toolkit: app/src/studio.js
// The same function draws the live preview and the full-resolution PNG exports,
// so what the artist sees is exactly what the judge downloads.

import { GRADES, DEFAULT_GRADE, clamp } from './palette.js';
import { ASPECTS, SLOT_ORDER, DEFAULT_COPY, getLayout, FACE_SAFE_TOP } from './layouts.js';
import { computeCrop } from './smartcrop.js';
import {
  posterizeInPlace, tintedCopy, makeHalftonePattern, makeHatchPattern,
  drawSun, drawGrain, drawRegMarks, roundRectPath, inkColor,
} from './effects.js';

const ANTON = '"Anton", "Arial Narrow", sans-serif';
const bufferCache = new Map();

function getPanelBuffer(slot, source, w, h, grade, finish, safeTop) {
  const key = [
    source.id,
    slot.zoom.toFixed(3), slot.ox.toFixed(3), slot.oy.toFixed(3),
    w | 0, h | 0, grade.id, finish.toFixed(2), safeTop.toFixed(2),
  ].join('|');
  if (bufferCache.has(key)) return bufferCache.get(key);

  const base = document.createElement('canvas');
  base.width = Math.max(1, w | 0);
  base.height = Math.max(1, h | 0);
  const bx = base.getContext('2d');
  const crop = computeCrop(source.img, slot, base.width, base.height, { safeTop });
  bx.drawImage(
    source.img, crop.sx, crop.sy, crop.sw, crop.sh,
    0, 0, base.width, base.height,
  );
  // 0.62 -> 1.0: even at a low finish setting the photograph is flattened
  // into ink; at the default 88% it is essentially a pure screenprint.
  posterizeInPlace(base, grade.ramp, 0.62 + 0.38 * finish, 7 * finish);

  const entry = {
    base,
    plateA: tintedCopy(base, grade.plateA),
    plateB: tintedCopy(base, grade.plateB),
  };
  if (bufferCache.size > 54) bufferCache.clear();
  bufferCache.set(key, entry);
  return entry;
}

function trackedWidth(ctx, text, spacing) {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + spacing;
  return w - (text.length ? spacing : 0);
}

function drawTracked(ctx, text, x, y, spacing) {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
}

function fitFont(ctx, text, maxWidth, size, min, family, weight, tracking = 0) {
  let s = size;
  while (s > min) {
    ctx.font = `${weight} ${s}px ${family}`;
    const w = ctx.measureText(text).width + Math.max(0, text.length - 1) * tracking * s;
    if (w <= maxWidth) break;
    s = Math.max(min, s - Math.max(2, s * 0.03));
  }
  return s;
}

function drawBadge(ctx, text, x, y, size, grade) {
  ctx.font = `400 ${size}px ${ANTON}`;
  const padX = size * 0.62;
  const w = Math.max(size * 2.6, ctx.measureText(text).width + padX * 2);
  const h = size * 1.7;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, size * 0.2);
  ctx.fillStyle = grade.paper;
  ctx.fill();
  ctx.strokeStyle = grade.ink;
  ctx.lineWidth = Math.max(2, size * 0.12);
  ctx.stroke();
  ctx.fillStyle = grade.ink;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, x + w / 2, y + h / 2 + size * 0.05);
  ctx.restore();
  return w;
}

function drawPanel(ctx, key, state, grade, layout, patterns, finish, W) {
  const rect = layout.panels[key];
  const slot = state.slots[key];
  const px = Math.round(rect.x), py = Math.round(rect.y);
  const pw = Math.round(rect.w), ph = Math.round(rect.h);
  const source = state.sources.find((s) => s.id === slot.sourceId && s.img);

  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, pw, ph);
  ctx.clip();
  ctx.fillStyle = grade.ink;
  ctx.fillRect(px, py, pw, ph);

  if (source) {
    const buf = getPanelBuffer(
      slot, source, pw, ph, grade, finish, FACE_SAFE_TOP[key] || 0.14,
    );
    ctx.drawImage(buf.base, px, py, pw, ph);

    if (finish > 0.02) {
      const shift = Math.max(2, W * 0.0034) * finish;
      // Two offset colour plates: this is misregistration, not a soft blur.
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.30 * finish;
      ctx.drawImage(buf.plateA, px + shift, py - shift * 0.5, pw, ph);
      ctx.globalAlpha = 0.24 * finish;
      ctx.drawImage(buf.plateB, px - shift, py + shift * 0.5, pw, ph);
      ctx.restore();

      // Coarse dot screen, multiplied into the ink for a printed texture.
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.36 * finish;
      ctx.fillStyle = patterns.halftone;
      ctx.fillRect(px, py, pw, ph);
      ctx.restore();

      // Fringed keylines make the plate offsets visible at thumbnail scale.
      ctx.save();
      ctx.globalAlpha = 0.55 * finish;
      ctx.lineWidth = Math.max(1, W * 0.0014);
      ctx.strokeStyle = grade.ghostB;
      ctx.strokeRect(px + shift, py - shift, pw, ph);
      ctx.strokeStyle = grade.ghostA;
      ctx.strokeRect(px - shift, py + shift, pw, ph);
      ctx.restore();
    }
  } else {
    ctx.fillStyle = patterns.hatch;
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = inkColor(grade.accent, 0.45);
    ctx.lineWidth = Math.max(2, W * 0.002);
    const mx = px + pw * 0.5, my = py + ph * 0.5, r = Math.min(pw, ph) * 0.06;
    ctx.beginPath();
    ctx.moveTo(mx - r, my); ctx.lineTo(mx + r, my);
    ctx.moveTo(mx, my - r); ctx.lineTo(mx, my + r);
    ctx.stroke();
  }

  // Heavy outer keyline and a fine inner rule.
  ctx.strokeStyle = grade.ink;
  ctx.lineWidth = Math.max(3, W * 0.0032);
  ctx.strokeRect(px, py, pw, ph);
  ctx.strokeStyle = inkColor(grade.paper, 0.55);
  ctx.lineWidth = Math.max(1, W * 0.0011);
  ctx.strokeRect(px + 3, py + 3, pw - 6, ph - 6);
  ctx.restore();
}

function drawDuoFrame(ctx, layout, grade, W) {
  const l = layout.panels.DUOL;
  const r = layout.panels.DUOR;
  const x = l.x - W * 0.004, y = l.y - W * 0.004;
  const w = r.x + r.w - l.x + W * 0.008;
  const h = Math.max(l.h, r.h) + W * 0.008;
  ctx.save();
  ctx.strokeStyle = inkColor(grade.paper, 0.85);
  ctx.lineWidth = Math.max(3, W * 0.0034);
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = grade.accent;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = Math.max(2, W * 0.0018);
  ctx.beginPath();
  ctx.moveTo(r.x, y);
  ctx.lineTo(r.x, y + h);
  ctx.stroke();
  ctx.restore();
}

function drawHeader(ctx, layout, W, H, grade, patterns) {
  const band = layout.rule + H * 0.006;
  ctx.fillStyle = grade.ink;
  ctx.fillRect(0, 0, W, band);

  ctx.save();
  ctx.globalAlpha = 0.24;
  ctx.fillStyle = patterns.halftone;
  ctx.fillRect(0, 0, W * 0.4, band);
  ctx.restore();

  // A hard diagonal ink wedge ties the band to the sunburst behind the panels.
  ctx.save();
  ctx.fillStyle = inkColor(grade.ramp[2], 0.9);
  ctx.beginPath();
  ctx.moveTo(0, band);
  ctx.lineTo(0, band - H * 0.045);
  ctx.lineTo(W * 0.52, band);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const ruleH = Math.max(4, W * 0.0034);
  ctx.fillStyle = grade.accent;
  ctx.fillRect(0, band - ruleH, W, ruleH);
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = grade.ghostA;
  ctx.fillRect(0, band - ruleH - Math.max(3, W * 0.003), W, Math.max(1, W * 0.0013));
  ctx.restore();
}

function titleLines(title, wantTwo) {
  const words = title.toUpperCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [DEFAULT_COPY.title];
  if (!wantTwo || words.length === 1) return [words.join(' ')];
  if (words.length === 2) return words;
  const cut = Math.ceil(words.length / 2);
  return [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
}

function drawTitle(ctx, state, grade, layout, W) {
  const lines = titleLines(state.title || DEFAULT_COPY.title, layout.title.lines === 2);
  let size = layout.title.size;
  ctx.font = `400 ${size}px ${ANTON}`;
  for (const line of lines) {
    if (ctx.measureText(line).width > layout.title.maxW) {
      size = fitFont(ctx, line, layout.title.maxW, size, W * 0.028, ANTON, 400);
      ctx.font = `400 ${size}px ${ANTON}`;
    }
  }

  const shift = Math.max(3, W * 0.0032);
  ctx.save();
  ctx.font = `400 ${size}px ${ANTON}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  lines.forEach((line, i) => {
    const y = lines.length === 1 ? layout.title.y1 : (i === 0 ? layout.title.y1 : layout.title.y2);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = grade.ghostA;
    ctx.fillText(line, layout.title.x + shift, y - shift * 0.55);
    ctx.fillStyle = grade.ghostB;
    ctx.fillText(line, layout.title.x - shift, y + shift * 0.7);
    ctx.globalAlpha = 1;
    ctx.fillStyle = grade.paper;
    ctx.fillText(line, layout.title.x, y);
  });
  ctx.restore();
}

function drawTagline(ctx, state, grade, layout, W) {
  const text = (state.tagline || '').toUpperCase().trim();
  if (!text) return;
  const tracking = 0.16;
  const size = fitFont(
    ctx, text, W * 0.70, layout.tagline.size, W * 0.014, ANTON, 400, tracking,
  );
  ctx.save();
  ctx.font = `400 ${size}px ${ANTON}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const sw = tracking * size;
  const width = trackedWidth(ctx, text, sw);
  const y = layout.tagline.y;

  // Ink tab behind the line: a bold strip, not a soft glowing script.
  ctx.fillStyle = grade.ink;
  ctx.fillRect(layout.tagline.x - size * 0.35, y - size * 0.92, width + size * 0.7, size * 1.22);
  ctx.fillStyle = grade.accent;
  ctx.fillRect(layout.tagline.x - size * 0.35, y + size * 0.18, width + size * 0.7, Math.max(2, size * 0.06));

  ctx.fillStyle = grade.paper;
  drawTracked(ctx, text, layout.tagline.x, y, sw);
  ctx.restore();
}

function highlight(ctx, rect, W) {
  ctx.save();
  ctx.strokeStyle = '#00E5C5';
  ctx.lineWidth = Math.max(2, W * 0.0025);
  ctx.setLineDash([W * 0.012, W * 0.008]);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

export function renderPoster(canvas, state, options = {}) {
  const W = options.W || ASPECTS[state.aspect].w;
  const H = options.H || ASPECTS[state.aspect].h;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const grade = GRADES[state.grade] || GRADES[DEFAULT_GRADE];
  const finish = clamp(state.finish == null ? 0.9 : state.finish, 0, 1);
  const layout = getLayout(state.aspect, W, H);
  const scale = W / 1080;
  const tile = Math.max(7, Math.round(9 * scale));
  const patterns = {
    halftone: ctx.createPattern(
      makeHalftonePattern(tile, inkColor(grade.ink, 0.95), 0.34), 'repeat',
    ),
    hatch: ctx.createPattern(
      makeHatchPattern(Math.round(tile * 1.5), inkColor(grade.paper, 0.38)), 'repeat',
    ),
  };

  ctx.fillStyle = grade.ink;
  ctx.fillRect(0, 0, W, H);
  drawSun(ctx, W, H, grade.ramp, finish);

  for (const key of SLOT_ORDER) drawPanel(ctx, key, state, grade, layout, patterns, finish, W);
  drawDuoFrame(ctx, layout, grade, W);
  drawRegMarks(ctx, W, H, grade.accent);
  drawHeader(ctx, layout, W, H, grade, patterns);
  drawTitle(ctx, state, grade, layout, W);
  drawTagline(ctx, state, grade, layout, W);
  if (state.badge) drawBadge(ctx, state.badge, layout.badge.x, layout.badge.y, layout.badge.size, grade);
  drawGrain(ctx, W, H, finish);

  if (options.preview && options.activeSlot && layout.panels[options.activeSlot]) {
    highlight(ctx, layout.panels[options.activeSlot], W);
  }
  return canvas;
}

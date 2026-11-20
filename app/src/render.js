/*
 * render.js — composes the complete printed cover.
 *
 * renderCover(ctx, scene) is the single entry point used by the editor: it
 * paints the sky, the five tilted plates, the chrome title lockup and the
 * full authority kit in the order a print shop would lay them down.
 * getPosterCanvas()/renderPoster() wrap that with the grade and grain passes
 * for the ?shot= export modes and for programmatic use.
 */

import { PALETTE, GRADES, mixColors, withAlpha } from './palette.js';
import { buildSlantedLayout } from './layouts.js';
import {
  buildBackdrop,
  skyGlow,
  drawHalftone,
  channelMisregistration,
  applyGrade,
  drawGrain,
} from './effects.js';
import { EXPORT_SIZES, wrapTagline, makeSeed, seededRandom, CREDITS } from './archive.js';

export { EXPORT_SIZES };

const TITLE_FAMILY = 'Impact, Haettenschweiler, "Arial Narrow Bold", "Arial Black", sans-serif';
const SCRIPT_FAMILY = '"Brush Script MT", "Segoe Script", "Snell Roundhand", cursive';
const SUBTITLE = 'one last summer';
const PRESS_QUOTE = '“Pure sun-bleached cinema.” — LEONIDA TRIBUNE';

/* ------------------------------------------------------------------ *
 * Small geometry helpers
 * ------------------------------------------------------------------ */

function createCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

/** Rounded rectangle path (independent of ctx.roundRect support). */
function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

/** Multi-point seal / starburst outline. */
function starPath(ctx, cx, cy, outer, inner, points, rot = 0) {
  ctx.beginPath();
  const total = points * 2;
  for (let i = 0; i < total; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + (i * Math.PI) / points;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/* ------------------------------------------------------------------ *
 * Panels
 * ------------------------------------------------------------------ */

/** Stylized plate used when a panel has no photo: sun, horizon and streaks. */
function drawPlaceholder(ctx, pw, ph, tone, P, index, u) {
  const ramps = [
    [P.plum, P.magenta, P.amber],
    [P.magenta, P.coral, P.amber],
    [P.plum, P.coral, P.cream],
    [P.ink, P.magenta, P.cyan],
    [P.magenta, P.amber, P.cream],
  ];
  const ramp = ramps[tone % ramps.length];
  const g = ctx.createLinearGradient(0, -ph / 2, 0, ph / 2);
  g.addColorStop(0, ramp[0]);
  g.addColorStop(0.55, ramp[1]);
  g.addColorStop(1, ramp[2]);
  ctx.fillStyle = g;
  ctx.fillRect(-pw / 2, -ph / 2, pw, ph);

  const sunX = pw * 0.16;
  const sunY = -ph * 0.08;
  const r = Math.min(pw, ph) * 0.22;
  const halo = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, r * 2.4);
  halo.addColorStop(0, withAlpha(P.cream, 0.92));
  halo.addColorStop(0.34, withAlpha(P.amber, 0.55));
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
  ctx.beginPath();
  ctx.arc(sunX, sunY, r, 0, Math.PI * 2);
  ctx.fillStyle = withAlpha(P.cream, 0.82);
  ctx.fill();

  // Low skyline silhouette, deterministic per panel index.
  const rnd = seededRandom(makeSeed('skyline-' + index));
  ctx.beginPath();
  ctx.moveTo(-pw / 2, ph / 2);
  let cursor = -pw / 2;
  ctx.lineTo(cursor, ph * 0.12);
  while (cursor < pw / 2) {
    const bw = pw * (0.04 + rnd() * 0.07);
    const bh = ph * (0.04 + rnd() * 0.16);
    cursor += bw;
    ctx.lineTo(Math.min(cursor, pw / 2), ph * 0.12 - bh);
    ctx.lineTo(Math.min(cursor, pw / 2), ph * 0.12);
  }
  ctx.lineTo(pw / 2, ph / 2);
  ctx.closePath();
  ctx.fillStyle = withAlpha(P.plum, 0.86);
  ctx.fill();

  ctx.strokeStyle = withAlpha(P.cream, 0.22);
  ctx.lineWidth = Math.max(1, 1.2 * u);
  for (let i = 0; i < 7; i += 1) {
    const y = -ph * 0.34 + i * ph * 0.075;
    ctx.beginPath();
    ctx.moveTo(-pw / 2, y);
    ctx.lineTo(pw / 2, y - ph * 0.02);
    ctx.stroke();
  }
}

/** Two-tone pill tag, printed at the lower edge of each plate. */
function drawRoleTag(ctx, role, x, y, maxW, P, u) {
  const text = String(role || '').toUpperCase();
  const parts = text.split(' / ');
  const lead = parts[0] || text;
  const detail = parts.slice(1).join(' / ');
  let size = Math.max(8, Math.round(11 * u));
  ctx.font = `800 ${size}px "Arial Narrow", Arial, sans-serif`;
  let width = ctx.measureText(text).width + 20 * u;
  if (width > maxW) {
    size = Math.max(7, Math.round(size * (maxW / width)));
    ctx.font = `800 ${size}px "Arial Narrow", Arial, sans-serif`;
    width = maxW;
  }
  const height = Math.max(16, 24 * u);
  ctx.save();
  roundRectPath(ctx, x, y, width, height, height / 2);
  ctx.fillStyle = 'rgba(16,8,32,0.88)';
  ctx.fill();
  ctx.strokeStyle = withAlpha(P.cream, 0.62);
  ctx.lineWidth = Math.max(1, u);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const ty = y + height / 2;
  if (detail) {
    ctx.fillStyle = P.cyan;
    ctx.fillText(lead + '  ', x + 10 * u, ty);
    const off = ctx.measureText(lead + '  ').width;
    ctx.fillStyle = P.paper;
    ctx.fillText(detail, x + 10 * u + off, ty);
  } else {
    ctx.fillStyle = P.paper;
    ctx.fillText(lead, x + 10 * u, ty);
  }
  ctx.restore();
}

/** Draw one slanted plate: shadow, cream gutter, pigment frame, image, tag. */
function drawPanel(ctx, panel, o) {
  const { P, u } = o;
  const pw = panel.w;
  const ph = panel.h;
  const gutter = Math.max(3, 7 * u);

  ctx.save();
  ctx.translate(panel.x, panel.y);
  ctx.rotate(panel.rotate || 0);

  // Cast shadow under the cream gutter.
  ctx.save();
  ctx.shadowColor = 'rgba(6,2,16,0.6)';
  ctx.shadowBlur = 24 * u;
  ctx.shadowOffsetX = 9 * u;
  ctx.shadowOffsetY = 11 * u;
  ctx.fillStyle = P.cream;
  roundRectPath(ctx, -pw / 2 - gutter, -ph / 2 - gutter, pw + gutter * 2, ph + gutter * 2, 5 * u);
  ctx.fill();
  ctx.restore();

  // Cream die-cut gutter and dark pigment frame.
  ctx.fillStyle = P.cream;
  roundRectPath(ctx, -pw / 2 - gutter, -ph / 2 - gutter, pw + gutter * 2, ph + gutter * 2, 5 * u);
  ctx.fill();
  ctx.fillStyle = P.plum;
  roundRectPath(ctx, -pw / 2, -ph / 2, pw, ph, 3 * u);
  ctx.fill();

  ctx.save();
  roundRectPath(ctx, -pw / 2, -ph / 2, pw, ph, 3 * u);
  ctx.clip();

  if (panel.image && panel.crop) {
    const c = panel.crop;
    try {
      ctx.drawImage(panel.image, c.sx, c.sy, c.sw, c.sh, -pw / 2, -ph / 2, pw, ph);
    } catch (_) {
      drawPlaceholder(ctx, pw, ph, panel.tone || 0, P, panel.index, u);
    }
  } else {
    drawPlaceholder(ctx, pw, ph, panel.tone || 0, P, panel.index, u);
    // Plates without a photo are part of the background art, so a little
    // screen texture is allowed here — about 18%, never on real skin.
    drawHalftone(ctx, -pw / 2, -ph / 2, pw, ph, {
      pitch: Math.max(10, 12 * u),
      angle: 16 + panel.index * 7,
      color: P.plum,
      amount: 0.18,
    });
  }

  // Warm top / cool bottom inner grade keeps faces natural with accent edges.
  const inner = ctx.createLinearGradient(0, -ph / 2, 0, ph / 2);
  inner.addColorStop(0, withAlpha(P.magenta, 0.14));
  inner.addColorStop(0.55, 'rgba(0,0,0,0)');
  inner.addColorStop(1, withAlpha(P.amber, 0.17));
  ctx.fillStyle = inner;
  ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
  ctx.restore();

  ctx.strokeStyle = withAlpha(P.cream, 0.62);
  ctx.lineWidth = Math.max(1, 1.5 * u);
  roundRectPath(ctx, -pw / 2, -ph / 2, pw, ph, 3 * u);
  ctx.stroke();
  ctx.restore();
}

/** Print every role tag in a final pass so no overlapping plate hides one. */
function drawPanelTags(ctx, panels, o) {
  const { P, u } = o;
  panels.forEach((panel) => {
    ctx.save();
    ctx.translate(panel.x, panel.y);
    ctx.rotate(panel.rotate || 0);
    drawRoleTag(ctx, panel.role || panel.short, -panel.w / 2 + 10 * u, panel.h / 2 - 34 * u, panel.w - 20 * u, P, u);
    ctx.restore();
  });
}

/* ------------------------------------------------------------------ *
 * Chrome title lockup
 * ------------------------------------------------------------------ */

/**
 * Build an offscreen copy of the title filled with alternating stripe bands.
 * A white text mask is converted to stripes using source-in compositing, so
 * the bands are clipped exactly to the letterforms.
 */
function makeStripedTitleCanvas(text, fontSize, family, P, stripeH) {
  const probeCanvas = createCanvas(4, 4);
  const probe = probeCanvas && probeCanvas.getContext('2d');
  const font = `900 ${fontSize}px ${family}`;
  let textW = fontSize * text.length * 0.5;
  if (probe) {
    probe.font = font;
    textW = probe.measureText(text).width;
  }
  const w = Math.ceil(textW + fontSize * 0.24);
  const h = Math.ceil(fontSize * 1.18);
  const c = createCanvas(w, h);
  if (!c) return null;
  const m = c.getContext('2d');

  // Paint every band first, then knock away everything outside the letters.
  // (source-in would intersect each new band with the previous one, leaving
  // only the first stripe — destination-in masks the finished stripes.)
  const ramp = [P.cream, P.cream, P.amber, P.coral, P.magenta, P.plum, P.coral, P.amber];
  const band = Math.max(5, Math.round(stripeH || fontSize * 0.13));
  for (let y = 0; y < h; y += band) {
    m.fillStyle = ramp[Math.floor(y / band) % ramp.length];
    m.fillRect(0, y, w, band);
  }
  m.globalCompositeOperation = 'destination-in';
  m.font = font;
  m.textAlign = 'center';
  m.textBaseline = 'middle';
  m.fillStyle = '#FFFFFF';
  m.fillText(text, w / 2, h / 2);
  m.globalCompositeOperation = 'source-over';
  return c;
}

function drawSubtitle(ctx, text, x, y, titleFs, P, u) {
  const size = Math.max(12, Math.round(titleFs * 0.19));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.045);
  ctx.font = `italic ${size}px ${SCRIPT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = P.plum;
  ctx.lineWidth = Math.max(2, titleFs * 0.03);
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = P.cyan;
  ctx.fillText(text, 0, 0);
  // Small flourishes either side of the script line.
  ctx.strokeStyle = withAlpha(P.cream, 0.7);
  ctx.lineWidth = Math.max(1, 1.4 * u);
  const m = ctx.measureText(text).width / 2 + 10 * u;
  ctx.beginPath();
  ctx.moveTo(-m - 26 * u, 0);
  ctx.lineTo(-m, 0);
  ctx.moveTo(m, 0);
  ctx.lineTo(m + 26 * u, 0);
  ctx.stroke();
  ctx.restore();
}

function drawChip(ctx, label, x, y, P, u) {
  const size = Math.max(10, Math.round(19 * u));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(0.035);
  ctx.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
  const padX = 12 * u;
  const h = 34 * u;
  const w = ctx.measureText(label).width + padX * 2;
  roundRectPath(ctx, -w / 2, -h / 2, w, h, h / 2);
  ctx.fillStyle = P.cream;
  ctx.fill();
  ctx.strokeStyle = P.plum;
  ctx.lineWidth = Math.max(2, 3 * u);
  ctx.stroke();
  ctx.fillStyle = P.plum;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, u);
  ctx.restore();
}

function drawTitleLockup(ctx, o) {
  const { w, h, P } = o;
  const u = Math.min(w, h) / 1000;
  const title = String(o.title || 'COPPER HALO').toUpperCase();
  const cx = w * 0.5;
  const cy = h * 0.155;

  let fs = Math.min(w / (Math.max(4, title.length) * 0.56), h * 0.20);
  fs = Math.max(26 * u, fs);
  ctx.font = `900 ${fs}px ${TITLE_FAMILY}`;
  const maxW = w * 0.88;
  const measured = ctx.measureText(title).width;
  if (measured > maxW) {
    fs *= maxW / measured;
    ctx.font = `900 ${fs}px ${TITLE_FAMILY}`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  // Long, soft drop shadow thrown down-right.
  ctx.save();
  ctx.shadowColor = 'rgba(4,2,12,0.62)';
  ctx.shadowBlur = 16 * u;
  ctx.shadowOffsetX = 18 * u;
  ctx.shadowOffsetY = 22 * u;
  ctx.fillStyle = 'rgba(10,5,22,0.86)';
  ctx.fillText(title, cx, cy);
  ctx.restore();

  // Stacked extrusion: coral at the front face fading to deep plum at the back.
  const depth = Math.max(6, Math.round(fs * 0.055));
  const ex = fs * 0.012;
  const ey = fs * 0.014;
  for (let i = depth; i >= 1; i -= 1) {
    const t = i / depth;
    ctx.fillStyle = mixColors(P.coral, P.plum, t * 0.94);
    ctx.fillText(title, cx + i * ex, cy + i * ey);
  }

  // Striped front face.
  const face = makeStripedTitleCanvas(title, Math.round(fs), TITLE_FAMILY, P, fs * 0.14);
  if (face) ctx.drawImage(face, cx - face.width / 2, cy - face.height / 2);

  // Thick plum outline, then a thin cream keyline inside it.
  ctx.strokeStyle = P.plum;
  ctx.lineWidth = Math.max(4, fs * 0.046);
  ctx.strokeText(title, cx, cy);
  ctx.strokeStyle = withAlpha(P.cream, 0.55);
  ctx.lineWidth = Math.max(1, fs * 0.011);
  ctx.strokeText(title, cx, cy);

  drawSubtitle(ctx, o.subtitle || SUBTITLE, cx, cy + fs * 0.54, fs, P, u);
  drawChip(ctx, o.chip || 'VOL. 06', cx + Math.min(w * 0.33, 470 * u), cy - fs * 0.40, P, u);
}

/* ------------------------------------------------------------------ *
 * Authority kit
 * ------------------------------------------------------------------ */

function drawPressBar(ctx, x, y, width, P, u) {
  const h = 46 * u;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = P.plum;
  ctx.fillRect(0, 0, width, h);
  ctx.fillStyle = P.amber;
  ctx.fillRect(0, 0, 5 * u, h);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `900 ${Math.round(20 * u)}px "Arial Black", Arial, sans-serif`;
  ctx.fillStyle = P.amber;
  const stars = '★★★★★';
  ctx.fillText(stars, 14 * u, h / 2);
  const starW = ctx.measureText(stars).width;

  let qSize = Math.max(9, Math.round(15 * u));
  ctx.font = `italic 700 ${qSize}px Georgia, serif`;
  if (ctx.measureText(PRESS_QUOTE).width > width - starW - 32 * u) {
    qSize = Math.max(8, Math.round(qSize * 0.86));
    ctx.font = `italic 700 ${qSize}px Georgia, serif`;
  }
  ctx.fillStyle = P.paper;
  ctx.fillText(PRESS_QUOTE, 14 * u + starW + 12 * u, h / 2);
  ctx.restore();
}

function drawSeal(ctx, cx, cy, r, P, u) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.13);
  starPath(ctx, 0, 0, r, r * 0.82, 16, Math.PI / 16);
  ctx.fillStyle = P.cream;
  ctx.fill();
  ctx.strokeStyle = P.plum;
  ctx.lineWidth = Math.max(2, 4 * u);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
  ctx.strokeStyle = P.coral;
  ctx.lineWidth = Math.max(1, 2 * u);
  ctx.stroke();

  ctx.fillStyle = P.plum;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.max(7, Math.round(r * 0.19))}px "Arial Black", Arial, sans-serif`;
  ctx.fillText('ORIGINAL', 0, -r * 0.20);
  ctx.fillText('COVER ART', 0, r * 0.04);
  ctx.font = `700 ${Math.max(6, Math.round(r * 0.12))}px Arial, sans-serif`;
  ctx.fillText('★   ★   ★', 0, r * 0.36);
  ctx.restore();
}

function drawRibbon(ctx, x, y, width, height, angle, P, u, label) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const notch = height * 0.62;
  ctx.beginPath();
  ctx.moveTo(-width / 2, -height / 2);
  ctx.lineTo(width / 2, -height / 2);
  ctx.lineTo(width / 2 + notch, 0);
  ctx.lineTo(width / 2, height / 2);
  ctx.lineTo(-width / 2, height / 2);
  ctx.lineTo(-width / 2 - notch, 0);
  ctx.closePath();
  ctx.fillStyle = P.coral;
  ctx.fill();
  ctx.strokeStyle = P.plum;
  ctx.lineWidth = Math.max(2, 3 * u);
  ctx.stroke();

  ctx.fillStyle = P.plum;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = Math.max(8, Math.round(16 * u));
  ctx.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
  if (ctx.measureText(label).width > width - 20 * u) {
    size = Math.max(7, Math.round(size * 0.85));
    ctx.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
  }
  ctx.fillText(label, 0, 1 * u);
  ctx.restore();
}

function drawTaglineBand(ctx, x, y, width, P, u, tagline) {
  const h = 54 * u;
  const skew = h * 0.42;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(width, 0);
  ctx.lineTo(width - skew, h);
  ctx.lineTo(skew, h);
  ctx.closePath();
  ctx.fillStyle = P.cyan;
  ctx.fill();
  ctx.strokeStyle = P.plum;
  ctx.lineWidth = Math.max(2, 3 * u);
  ctx.stroke();

  ctx.fillStyle = P.plum;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = Math.max(10, Math.round(23 * u));
  ctx.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
  const lines = wrapTagline(tagline, 30);
  if (ctx.measureText(lines[0] || '').width > width - 34 * u) {
    size = Math.max(9, Math.round(size * 0.82));
    ctx.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
  }
  const text = (lines[0] || tagline || '').toUpperCase();
  ctx.fillText(text, width / 2, h / 2);
  ctx.restore();
}

function drawBillingBlock(ctx, x, y, P, u) {
  ctx.save();
  ctx.translate(x, y);
  ctx.font = `600 ${Math.max(8, Math.round(10 * u))}px Arial, sans-serif`;
  ctx.fillStyle = withAlpha(P.cream, 0.82);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  CREDITS.forEach((line, i) => {
    ctx.fillText(line, 0, i * 13.5 * u);
  });
  ctx.restore();
}

function drawBarcode(ctx, x, y, width, height, P, u, seed) {
  const rnd = seededRandom(seed);
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = withAlpha(P.paper, 0.92);
  ctx.fillRect(0, 0, width, height);
  let px = 5 * u;
  while (px < width - 7 * u) {
    const bw = Math.max(1, (rnd() * 3 + 1) * u);
    if (rnd() > 0.32) ctx.fillRect(px, 4 * u, bw, height - 8 * u);
    px += bw + (rnd() * 2 + 1) * u;
  }
  ctx.fillStyle = P.plum;
  ctx.font = `700 ${Math.max(6, Math.round(9 * u))}px monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('6 00123 45678 9', 4 * u, height + 3 * u);
  ctx.restore();
}

/** All authority markers: title badge is drawn by drawTitleLockup above. */
function drawAuthorityKit(ctx, o) {
  const { w, h, P } = o;
  const u = Math.min(w, h) / 1000;
  const pressW = Math.min(w * 0.44, 560 * u);
  const tagW = Math.min(w * 0.42, 520 * u);

  drawPressBar(ctx, w * 0.04, h - 150 * u, pressW, P, u);
  drawBillingBlock(ctx, w * 0.04, h - 96 * u, P, u);
  drawTaglineBand(ctx, w - tagW - w * 0.04, h - 150 * u, tagW, P, u, o.tagline);
  drawBarcode(ctx, w - 130 * u - w * 0.04, h - 86 * u, 130 * u, 46 * u, P, u, makeSeed(o.title || 'cover'));
  // On tall canvases the title reaches further across the frame; drop the
  // seal to the mid-right edge so it never sits on top of the lettering.
  const narrow = w / h < 1.4;
  drawSeal(
    ctx,
    w - (narrow ? 54 : 72) * u,
    narrow ? h * 0.405 : h * 0.17,
    (narrow ? 46 : 54) * u,
    P,
    u,
  );
  drawRibbon(ctx, w * 0.74, h * 0.29, 270 * u, 34 * u, -0.5, P, u, "COLLECTOR'S EDITION");
}

/* ------------------------------------------------------------------ *
 * Public composition entry points
 * ------------------------------------------------------------------ */

/**
 * Draw the complete poster into an existing 2D context. The controller calls
 * applyGrade() and drawGrain() afterwards; getPosterCanvas() does that too.
 */
export function renderCover(ctx, scene) {
  const s = scene || {};
  const w = Math.max(1, s.width | 0);
  const h = Math.max(1, s.height | 0);
  const P = { ...PALETTE, ...(s.palette || {}) };
  const grade = s.grade || GRADES[0];
  const u = Math.min(w, h) / 1000;

  ctx.save();
  ctx.clearRect(0, 0, w, h);

  const backdrop = buildBackdrop(w, h, grade, P);
  if (backdrop) ctx.drawImage(backdrop, 0, 0, w, h);
  skyGlow(ctx, 0, 0, w, h, grade, P);

  if (grade.misregister > 0) {
    channelMisregistration(ctx, 0, h * 0.42, w, h * 0.30, grade.misregister * 0.45);
  }

  const panels = [...(s.panels || [])].sort((a, b) => (a.z || 0) - (b.z || 0));
  panels.forEach((panel) => drawPanel(ctx, panel, { P, u, grade, w, h }));

  // Legibility scrims behind the type, top and bottom.
  const top = ctx.createLinearGradient(0, 0, 0, h * 0.34);
  top.addColorStop(0, withAlpha(P.plum, 0.60));
  top.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, w, h * 0.34);

  const bottom = ctx.createLinearGradient(0, h * 0.72, 0, h);
  bottom.addColorStop(0, 'rgba(0,0,0,0)');
  bottom.addColorStop(1, withAlpha(P.plum, 0.84));
  ctx.fillStyle = bottom;
  ctx.fillRect(0, h * 0.72, w, h * 0.28);

  drawPanelTags(ctx, panels, { P, u });

  drawTitleLockup(ctx, {
    title: s.title,
    subtitle: s.subtitle,
    chip: s.chip,
    w,
    h,
    P,
    grade,
  });
  drawAuthorityKit(ctx, {
    w,
    h,
    P,
    grade,
    tagline: s.tagline,
    title: s.title,
  });

  ctx.restore();
}

/** Build the finished poster canvas for ?shot= modes and offline export. */
export function getPosterCanvas(scene) {
  const w = Math.max(1, (scene && scene.width) | 0);
  const h = Math.max(1, (scene && scene.height) | 0);
  const canvas = createCanvas(w, h);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  renderCover(ctx, scene);
  applyGrade(ctx, scene && scene.grade, w, h);
  drawGrain(ctx, w, h, (scene && scene.grade && scene.grade.grain) || 0.05);
  return canvas;
}

/** Convenience: build a scene from plain options, then render it. */
export function renderPoster(options = {}) {
  const sizeKey = options.size && EXPORT_SIZES[options.size] ? options.size : 'wide';
  const size = EXPORT_SIZES[sizeKey];
  const width = options.width || size.w;
  const height = options.height || size.h;
  const grade = options.grade || GRADES[0];
  const layout = buildSlantedLayout(width, height).map((spec) => ({
    ...spec,
    image: null,
    crop: null,
  }));
  const scene = {
    width,
    height,
    size: sizeKey,
    palette: { ...PALETTE, ...(options.palette || {}) },
    grade,
    title: options.title || 'COPPER HALO',
    subtitle: options.subtitle || SUBTITLE,
    tagline: options.tagline || 'EVERY EMPIRE HAS A PRICE.',
    chip: options.chip || 'VOL. 06',
    panels: options.panels || layout,
  };
  return getPosterCanvas(scene);
}

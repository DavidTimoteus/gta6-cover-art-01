/*
 * printspec.js — the normalized poster specification and its math.
 *
 * A spec is the printable, serializable description of a cover: copy, grade,
 * panel assignments and safe-area rules. This module creates a default spec,
 * clamps it to a canvas, validates it, solves title placement and maps face
 * regions detected in source plates onto the tilted panel layout.
 */

import { PALETTE, GRADE_IDS } from './palette.js';
import { EXPORT_SIZES } from './archive.js';
import { TITLE_BAND } from './layouts.js';

export const SPEC_VERSION = '1.0.0';

/** A complete default spec for the flagship cover. */
export const DEFAULT_SPEC = Object.freeze({
  version: SPEC_VERSION,
  presetId: 'copperHalo',
  size: 'wide',
  gradeId: 'sunset',
  title: 'COPPER HALO',
  subtitle: 'one last summer',
  tagline: 'EVERY EMPIRE HAS A PRICE.',
  chip: 'VOL. 06',
  palette: { ...PALETTE },
  seed: 'copper-halo-master',
  titleBand: { ...TITLE_BAND },
  texture: { halftone: 0.26, posterize: 0.20, grain: 0.05 },
  panels: [],
});

/** Generic numeric clamp with a finite-value fallback. */
export function clamp(v, lo, hi, fallback = lo) {
  const n = Number(v);
  if (!isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

/** Build a fresh, mutable spec merged over the defaults. */
export function createSpec(options = {}) {
  const spec = {
    ...DEFAULT_SPEC,
    version: SPEC_VERSION,
    palette: { ...DEFAULT_SPEC.palette, ...(options.palette || {}) },
    titleBand: { ...DEFAULT_SPEC.titleBand, ...(options.titleBand || {}) },
    texture: { ...DEFAULT_SPEC.texture, ...(options.texture || {}) },
    panels: Array.isArray(options.panels) ? options.panels.map((p) => ({ ...p })) : [],
  };
  const keys = ['presetId', 'size', 'gradeId', 'title', 'subtitle', 'tagline', 'chip', 'seed'];
  keys.forEach((key) => {
    if (options[key] != null) spec[key] = options[key];
  });
  return spec;
}

/** Normalize a spec against a concrete canvas size, clamping every field. */
export function normalizeSpec(spec, width, height) {
  const w = Math.max(1, width | 0);
  const h = Math.max(1, height | 0);
  const src = spec || {};
  const out = createSpec(src);
  out.width = w;
  out.height = h;

  if (!EXPORT_SIZES[out.size]) out.size = 'wide';
  const target = EXPORT_SIZES[out.size];
  if (!w || !h) {
    out.width = target.w;
    out.height = target.h;
  }
  if (!GRADE_IDS.includes(out.gradeId)) out.gradeId = GRADE_IDS[0];

  out.title = String(out.title || 'COPPER HALO').slice(0, 40);
  out.subtitle = String(out.subtitle || '').slice(0, 40);
  out.tagline = String(out.tagline || '').slice(0, 64);
  out.chip = String(out.chip || '').slice(0, 20);

  const t = out.texture;
  t.halftone = clamp(t.halftone, 0, 0.35, 0.26);
  t.posterize = clamp(t.posterize, 0, 0.40, 0.20);
  t.grain = clamp(t.grain, 0, 0.20, 0.05);

  out.panels = (out.panels || []).map((panel, index) => ({
    index,
    x: clamp(panel.x, 0, w, w / 2),
    y: clamp(panel.y, 0, h, h / 2),
    w: clamp(panel.w, 1, w, w * 0.3),
    h: clamp(panel.h, 1, h, h * 0.3),
    rotate: isFinite(panel.rotate) ? panel.rotate : 0,
    z: isFinite(panel.z) ? panel.z : index,
    role: String(panel.role || ''),
  }));
  return out;
}

/**
 * Validate a spec. Returns { valid, errors } with human-readable messages;
 * warnings never block rendering, they just flag a spec for the archive.
 */
export function validateSpec(spec) {
  const errors = [];
  const warnings = [];
  if (!spec || typeof spec !== 'object') {
    return { valid: false, errors: ['spec must be an object'], warnings };
  }
  if (spec.version && spec.version !== SPEC_VERSION) {
    warnings.push(`spec version ${spec.version} differs from ${SPEC_VERSION}`);
  }
  if (!spec.title || !String(spec.title).trim()) errors.push('title is required');
  if (String(spec.title || '').length > 40) errors.push('title exceeds 40 characters');
  if (spec.gradeId && !GRADE_IDS.includes(spec.gradeId)) errors.push(`unknown grade: ${spec.gradeId}`);
  if (spec.size && !EXPORT_SIZES[spec.size]) errors.push(`unknown export size: ${spec.size}`);
  if (!spec.palette || typeof spec.palette !== 'object') {
    errors.push('palette is required');
  } else {
    ['plum', 'magenta', 'coral', 'amber', 'cream', 'cyan'].forEach((key) => {
      if (!spec.palette[key]) errors.push(`palette.${key} is required`);
    });
  }
  if (spec.panels && !Array.isArray(spec.panels)) errors.push('panels must be an array');
  if (Array.isArray(spec.panels) && spec.panels.length !== 5) {
    warnings.push(`expected 5 panels, found ${spec.panels.length}`);
  }
  if (spec.texture) {
    if (clamp(spec.texture.halftone, 0, 1, 0) > 0.35) {
      warnings.push('halftone above 35% will flatten the artwork');
    }
    if (clamp(spec.texture.posterize, 0, 1, 0) > 0.40) {
      warnings.push('posterize above 40% will damage skin tones');
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

/** Axis-aligned rect containment for normalized [0,1] coordinates. */
export function rectContains(rect, x, y) {
  if (!rect) return false;
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/** Overlap area of two axis-aligned rects, in the same coordinate space. */
export function overlapArea(a, b) {
  if (!a || !b) return 0;
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

/** Pixel safe area: 6% margin on each side of the canvas. */
export function safeArea(width, height) {
  const w = Math.max(1, width | 0);
  const h = Math.max(1, height | 0);
  const mx = w * 0.06;
  const my = h * 0.06;
  return { x: mx, y: my, w: w - mx * 2, h: h - my * 2 };
}

/**
 * Solve the title lockup geometry for a given canvas and title length.
 * Returns font size, centre, max width, subtitle baseline and badge box.
 */
export function titlePlacement(spec, width, height) {
  const w = Math.max(1, width | 0);
  const h = Math.max(1, height | 0);
  const title = String((spec && spec.title) || 'COPPER HALO').toUpperCase();
  const band = TITLE_BAND;
  const bandPx = { x: band.x * w, y: band.y * h, w: band.w * w, h: band.h * h };
  const maxWidth = bandPx.w * 0.96;
  const len = Math.max(4, title.length);
  let fontSize = Math.min(w / (len * 0.56), h * 0.20);
  fontSize = clamp(fontSize, Math.min(w, h) * 0.026, h * 0.20, h * 0.12);
  const cx = w / 2;
  const cy = bandPx.y + bandPx.h * 0.42;
  return {
    fontSize,
    cx,
    cy,
    maxWidth,
    band: bandPx,
    subtitleY: cy + fontSize * 0.54,
    subtitleSize: Math.max(12, fontSize * 0.19),
    chip: {
      x: cx + Math.min(w * 0.33, w * 0.28),
      y: cy - fontSize * 0.40,
      w: Math.min(w * 0.12, fontSize * 2.4),
      h: Math.max(22, fontSize * 0.42),
    },
  };
}

/**
 * Map normalized face rectangles onto the tilted panel specs.
 *
 * faces: [{ x, y, w, h, score? }] in normalized source coordinates.
 * panels: pixel specs from buildSlantedLayout().
 * Returns one record per face with its best panel and an overlap score.
 */
export function mapFacesToPanels(faces, panels, width, height) {
  const w = Math.max(1, width | 0);
  const h = Math.max(1, height | 0);
  const panelRects = (panels || []).map((p) => ({
    index: p.index,
    x: (p.x - p.w / 2) / w,
    y: (p.y - p.h / 2) / h,
    w: p.w / w,
    h: p.h / h,
  }));

  return (faces || []).map((face, faceIndex) => {
    let best = null;
    panelRects.forEach((rect) => {
      const area = overlapArea(face, rect);
      const faceArea = Math.max(1e-6, face.w * face.h);
      const ratio = area / faceArea;
      if (!best || ratio > best.overlap) best = { panelIndex: rect.index, overlap: ratio };
    });

    if (best) return { faceIndex, ...best, contained: best.overlap > 0.5 };

    // No overlap: assign to the nearest panel centre as a fallback.
    const fx = face.x + face.w / 2;
    const fy = face.y + face.h / 2;
    let nearest = 0;
    let dist = Infinity;
    panelRects.forEach((rect) => {
      const dx = fx - (rect.x + rect.w / 2);
      const dy = fy - (rect.y + rect.h / 2);
      const d = dx * dx + dy * dy;
      if (d < dist) { dist = d; nearest = rect.index; }
    });
    return { faceIndex, panelIndex: nearest, overlap: 0, contained: false };
  });
}

/** Find the topmost panel whose rotated bounds contain a pixel point. */
export function panelFromPoint(px, py, panels) {
  const sorted = [...(panels || [])].sort((a, b) => (b.z || 0) - (a.z || 0));
  for (let i = 0; i < sorted.length; i += 1) {
    const p = sorted[i];
    const dx = px - p.x;
    const dy = py - p.y;
    const a = -(p.rotate || 0);
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= p.w / 2 && Math.abs(ly) <= p.h / 2) return p;
  }
  return null;
}

/*
 * palette.js — the closed ink system for the key-art bench.
 *
 * Every poster is printed from one small set of pigments. A grade never
 * invents a new colour; it only changes the ratio of inks and the way the
 * sunset glow is stacked behind the panels. Keeping the palette closed is
 * what makes all three export sizes feel like they left the same press.
 */

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The six working inks plus two utility tones. Keys stay short for scenes. */
export const PALETTE = Object.freeze({
  plum: '#1B1035',
  magenta: '#7A2E6B',
  coral: '#FF5E7E',
  amber: '#FFB35C',
  cream: '#FFE29A',
  cyan: '#00E5C5',
  ink: '#100820',
  paper: '#FFF4DC',
});

/*
 * Five factory grades. Shared fields:
 *   tint/tintAmount  soft-light wash applied after composition
 *   saturation/contrast/warmth  pixel pass parameters
 *   glowTop/Mid/Bottom  the three-stop sunset light behind the panels
 *   sky  normalized gradient stops for the backdrop
 *   vignette/halftone/posterize/misregister/grain  texture budgets
 *   glowStrength  multiplier for the additive light bloom
 */
export const GRADES = Object.freeze([
  {
    id: 'sunset',
    name: 'Sunset',
    tint: '#FF7A5C',
    tintAmount: 0.10,
    saturation: 1.07,
    contrast: 1.05,
    warmth: 0.12,
    glowTop: '#FFB35C',
    glowMid: '#FF5E7E',
    glowBottom: '#7A2E6B',
    sky: [[0, '#FFE29A'], [0.38, '#FFB35C'], [0.72, '#FF5E7E'], [1, '#7A2E6B']],
    vignette: 0.34,
    halftone: 0.26,
    posterize: 0.20,
    misregister: 0.55,
    grain: 0.050,
    glowStrength: 0.95,
  },
  {
    id: 'rain',
    name: 'Rain',
    tint: '#3FA9B5',
    tintAmount: 0.14,
    saturation: 0.86,
    contrast: 1.08,
    warmth: -0.16,
    glowTop: '#7A2E6B',
    glowMid: '#00E5C5',
    glowBottom: '#1B1035',
    sky: [[0, '#7A2E6B'], [0.42, '#00E5C5'], [0.74, '#3A2A6B'], [1, '#1B1035']],
    vignette: 0.42,
    halftone: 0.30,
    posterize: 0.28,
    misregister: 1.10,
    grain: 0.075,
    glowStrength: 0.60,
  },
  {
    id: 'ink',
    name: 'Ink',
    tint: '#00E5C5',
    tintAmount: 0.08,
    saturation: 0.62,
    contrast: 1.20,
    warmth: -0.05,
    glowTop: '#FF5E7E',
    glowMid: '#7A2E6B',
    glowBottom: '#1B1035',
    sky: [[0, '#FFE29A'], [0.30, '#FF5E7E'], [0.70, '#7A2E6B'], [1, '#1B1035']],
    vignette: 0.50,
    halftone: 0.22,
    posterize: 0.34,
    misregister: 0.35,
    grain: 0.060,
    glowStrength: 0.50,
  },
  {
    id: 'ember',
    name: 'Ember',
    tint: '#FF5A2E',
    tintAmount: 0.14,
    saturation: 1.18,
    contrast: 1.10,
    warmth: 0.24,
    glowTop: '#FFE29A',
    glowMid: '#FFB35C',
    glowBottom: '#FF5E7E',
    sky: [[0, '#FFE29A'], [0.34, '#FFB35C'], [0.70, '#FF5E7E'], [1, '#7A2E6B']],
    vignette: 0.36,
    halftone: 0.24,
    posterize: 0.18,
    misregister: 0.80,
    grain: 0.055,
    glowStrength: 1.00,
  },
  {
    id: 'dusk',
    name: 'Dusk',
    tint: '#8A3A9E',
    tintAmount: 0.12,
    saturation: 0.94,
    contrast: 1.06,
    warmth: -0.08,
    glowTop: '#FF5E7E',
    glowMid: '#7A2E6B',
    glowBottom: '#1B1035',
    sky: [[0, '#FFB35C'], [0.30, '#FF5E7E'], [0.66, '#7A2E6B'], [1, '#1B1035']],
    vignette: 0.46,
    halftone: 0.28,
    posterize: 0.24,
    misregister: 0.70,
    grain: 0.065,
    glowStrength: 0.72,
  },
]);

/** Fast lookup used by the controller and by archived presets. */
export const GRADES_BY_ID = Object.freeze(
  GRADES.reduce((acc, grade) => {
    acc[grade.id] = grade;
    return acc;
  }, Object.create(null)),
);

export const GRADE_IDS = Object.freeze(GRADES.map((grade) => grade.id));

/** Resolve a grade by id with a safe fallback. */
export function getGrade(id) {
  return GRADES_BY_ID[id] || GRADES[0];
}

/** Parse #RGB or #RRGGBB into numeric channels. Invalid input becomes black. */
export function parseHex(input) {
  if (typeof input !== 'string') return { r: 0, g: 0, b: 0 };
  let s = input.trim();
  if (s.charAt(0) === '#') s = s.slice(1);
  if (!HEX_RE.test('#' + s)) return { r: 0, g: 0, b: 0 };
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Encode clamped channels back to #RRGGBB. */
export function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v || 0))).toString(16).padStart(2, '0').toUpperCase();
  return '#' + c(r) + c(g) + c(b);
}

/** Linear blend between two hex colours. t = 0 -> a, t = 1 -> b. */
export function mixColors(a, b, t = 0.5) {
  const A = parseHex(a);
  const B = parseHex(b);
  const k = clamp01(t);
  return rgbToHex(
    A.r + (B.r - A.r) * k,
    A.g + (B.g - A.g) * k,
    A.b + (B.b - A.b) * k,
  );
}

/** Weighted average of a list of hex colours. */
export function mixMany(colors, weights) {
  const list = (colors || []).filter(Boolean);
  if (!list.length) return PALETTE.plum;
  const w = (weights && weights.length === list.length) ? weights : list.map(() => 1);
  let total = 0;
  w.forEach((x) => { total += Math.max(0, x); });
  if (total <= 0) return list[0];
  let r = 0; let g = 0; let b = 0;
  list.forEach((color, i) => {
    const c = parseHex(color);
    const k = Math.max(0, w[i]) / total;
    r += c.r * k; g += c.g * k; b += c.b * k;
  });
  return rgbToHex(r, g, b);
}

/** Hex colour plus alpha, returned as an rgba() string for canvas use. */
export function withAlpha(hex, alpha) {
  const c = parseHex(hex);
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${clamp01(alpha == null ? 1 : alpha)})`;
}

/** Lighten (amount > 0) or darken (amount < 0) towards white or black. */
export function shade(hex, amount) {
  const k = Math.max(-1, Math.min(1, amount || 0));
  return k >= 0 ? mixColors(hex, '#FFFFFF', k) : mixColors(hex, '#000000', -k);
}

/** Perceived relative luminance using the sRGB transfer curve. */
export function luminance(hex) {
  const c = parseHex(hex);
  const ch = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

/** WCAG-style contrast ratio between two colours. */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Pick the more readable of two foreground colours against a background. */
export function bestTextColor(bg, light = PALETTE.cream, dark = PALETTE.plum) {
  return contrastRatio(bg, light) >= contrastRatio(bg, dark) ? light : dark;
}

/** Convert a grade's sky definition into canvas-ready gradient stops. */
export function gradeGradientStops(grade) {
  const stops = (grade && grade.sky) || GRADES[0].sky;
  return stops.map(([offset, color]) => ({
    offset: clamp01(offset),
    color: typeof color === 'string' ? color : PALETTE.magenta,
  }));
}

/** The alternating band sequence used inside the chrome title letters. */
export function stripeRamp(palette = PALETTE) {
  return [
    palette.cream,
    palette.cream,
    palette.amber,
    palette.coral,
    palette.magenta,
    palette.plum,
    palette.coral,
    palette.amber,
  ];
}

export function clamp01(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

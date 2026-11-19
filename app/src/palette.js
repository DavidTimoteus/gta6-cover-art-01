/*
 * palette.js
 * Colour system for the offline cover renderer.
 *
 * The module owns six named inks, three named grades, and a handful of small
 * deterministic colour helpers.  Nothing here touches the DOM or the network:
 * helpers accept plain values and return plain values so they can be reused by
 * the canvas code, by the finishing tools, and by any export pipeline.
 */

/** Fixed print inks for the poster. */
export const PALETTE = Object.freeze({
  plum: '#1B1035',
  magenta: '#7A2E6B',
  coral: '#FF5E7E',
  amber: '#FFB35C',
  cream: '#FFE29A',
  cyan: '#00E5C5',
});

/** Valid grade names, in the order shown in the editor. */
export const GRADE_KEYS = Object.freeze(['sunset', 'rain', 'ink']);

/*
 * Each grade is a small recipe.  `sky` is ordered from the lightest ink at the
 * top of the sheet to the darkest at the foot; the remaining fields label the
 * roles used downstream by the renderer and the finishing toolkit.
 */
const GRADE_DEFS = Object.freeze({
  sunset: {
    name: 'sunset',
    sky: [PALETTE.cream, PALETTE.amber, PALETTE.coral, PALETTE.magenta, PALETTE.plum],
    ink: PALETTE.plum,
    wash: PALETTE.magenta,
    accent: PALETTE.coral,
    glow: PALETTE.amber,
    paper: PALETTE.cream,
    cool: PALETTE.cyan,
  },
  rain: {
    name: 'rain',
    sky: [PALETTE.cream, PALETTE.cyan, PALETTE.magenta, PALETTE.plum, PALETTE.plum],
    ink: PALETTE.plum,
    wash: PALETTE.cyan,
    accent: PALETTE.cyan,
    glow: PALETTE.cream,
    paper: PALETTE.cream,
    cool: PALETTE.magenta,
  },
  ink: {
    name: 'ink',
    sky: [PALETTE.cream, PALETTE.amber, PALETTE.magenta, PALETTE.plum, PALETTE.plum],
    ink: PALETTE.plum,
    wash: PALETTE.plum,
    accent: PALETTE.amber,
    glow: PALETTE.cream,
    paper: PALETTE.cream,
    cool: PALETTE.magenta,
  },
});

export { GRADE_DEFS };
export const GRADES = GRADE_DEFS;

/** Clamp a number into the closed unit interval. */
export function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : (n > 1 ? 1 : n);
}

/** Clamp a number into an arbitrary closed interval. */
export function clamp(value, lo, hi) {
  const n = Number(value);
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : (n > hi ? hi : n);
}

/*
 * parseHex accepts #rgb, #rrggbb, a {r,g,b} object, or an [r,g,b] array.
 * It always returns a fresh object so callers cannot mutate a shared value.
 */
export function parseHex(value) {
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      return {
        r: clamp(Math.round(value[0]), 0, 255),
        g: clamp(Math.round(value[1]), 0, 255),
        b: clamp(Math.round(value[2]), 0, 255),
      };
    }
    return {
      r: clamp(Math.round(value.r), 0, 255),
      g: clamp(Math.round(value.g), 0, 255),
      b: clamp(Math.round(value.b), 0, 255),
    };
  }
  let text = String(value == null ? '' : value).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(text)) {
    text = text[0] + text[0] + text[1] + text[1] + text[2] + text[2];
  }
  if (!/^[0-9a-f]{6}$/i.test(text)) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(text.slice(0, 2), 16),
    g: parseInt(text.slice(2, 4), 16),
    b: parseInt(text.slice(4, 6), 16),
  };
}

/** Format a colour object as an uppercase #RRGGBB string. */
export function toHex(colour) {
  const c = parseHex(colour);
  const part = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return ('#' + part(c.r) + part(c.g) + part(c.b)).toUpperCase();
}

/** Linear blend between two colours.  t = 0 returns a, t = 1 returns b. */
export function mix(a, b, t) {
  const left = parseHex(a);
  const right = parseHex(b);
  const k = clamp01(t);
  return {
    r: left.r + (right.r - left.r) * k,
    g: left.g + (right.g - left.g) * k,
    b: left.b + (right.b - left.b) * k,
  };
}

/** Convenience wrapper around mix() that returns a hex string. */
export function mixHex(a, b, t) {
  return toHex(mix(a, b, t));
}

/** Build evenly spaced gradient stops for a grade (or for a custom array). */
export function getGradientStops(grade) {
  const def = typeof grade === 'string' ? GRADE_DEFS[grade] : null;
  const colours = def ? def.sky : (Array.isArray(grade) ? grade : (grade && grade.sky) || GRADE_DEFS.sunset.sky);
  if (!colours.length) return [];
  if (colours.length === 1) return [{ offset: 0, color: toHex(colours[0]) }];
  const last = colours.length - 1;
  return colours.map((colour, index) => ({
    offset: index / last,
    color: toHex(colour),
  }));
}

/** sRGB relative luminance, used for contrast decisions. */
export function relativeLuminance(colour) {
  const c = parseHex(colour);
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG contrast ratio between two colours, in the range 1 .. 21. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Choose whichever of two candidate inks reads better on `background`. */
export function pickTextColor(background, light = PALETTE.cream, dark = PALETTE.plum) {
  return contrastRatio(background, light) >= contrastRatio(background, dark) ? light : dark;
}

/** Nudge a colour toward white (amount > 0) or black (amount < 0). */
export function shade(colour, amount) {
  const c = parseHex(colour);
  const target = amount >= 0 ? 255 : 0;
  const k = Math.abs(amount);
  return toHex({
    r: c.r + (target - c.r) * k,
    g: c.g + (target - c.g) * k,
    b: c.b + (target - c.b) * k,
  });
}

/**
 * Resolve a grade name into the full palette object consumed by the renderer.
 * Unknown names fall back to 'sunset' rather than throwing.
 */
export function getPalette(grade) {
  const key = GRADE_KEYS.includes(grade) ? grade : 'sunset';
  const def = GRADE_DEFS[key];
  return {
    name: key,
    plum: PALETTE.plum,
    magenta: PALETTE.magenta,
    coral: PALETTE.coral,
    amber: PALETTE.amber,
    cream: PALETTE.cream,
    cyan: PALETTE.cyan,
    ink: def.ink,
    wash: def.wash,
    accent: def.accent,
    glow: def.glow,
    paper: def.paper,
    cool: def.cool,
    sky: def.sky.slice(),
    stops: getGradientStops(key),
  };
}

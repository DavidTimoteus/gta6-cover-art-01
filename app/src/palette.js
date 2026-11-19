/*
 * Cover colour system.
 *
 * Every helper here is deterministic and has no side effects.  Grades can be
 * mixed, sampled and measured repeatedly and always yield the same result,
 * which matters because the poster is repainted on every slider movement.
 * Nothing in this file reaches the network, the DOM or the filesystem.
 */

export const PALETTE = Object.freeze({
  plum: '#1B1035',
  magenta: '#7A2E6B',
  coral: '#FF5E7E',
  amber: '#FFB35C',
  cream: '#FFE29A',
  cyan: '#00E5C5'
});

const RE_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f]?)$/i;
const RE_LONG = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i;
const RE_RGB = /^rgba?\(\s*([+-]?\d+(?:\.\d+)?)\s*[, ]\s*([+-]?\d+(?:\.\d+)?)\s*[, ]\s*([+-]?\d+(?:\.\d+)?)(?:\s*[,/]\s*([+-]?\d+(?:\.\d+)?%?))?\s*\)$/i;

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/* ------------------------------------------------------------------ *
 * parsing / serialising
 * ------------------------------------------------------------------ */

/**
 * Accepts #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() strings and plain
 * colour objects.  Unrecognised input degrades to opaque black instead of
 * throwing, so a bad grade field can never break a render.
 */
export function parseColor(value) {
  if (value && typeof value === 'object' && Number.isFinite(value.r)) {
    return {
      r: clamp(value.r, 0, 255),
      g: clamp(finite(value.g, 0), 0, 255),
      b: clamp(finite(value.b, 0), 0, 255),
      a: clamp(finite(value.a, 1), 0, 1)
    };
  }
  if (typeof value !== 'string') return { r: 0, g: 0, b: 0, a: 1 };

  const text = value.trim();
  let match = RE_SHORT.exec(text);
  if (match) {
    return {
      r: parseInt(match[1] + match[1], 16),
      g: parseInt(match[2] + match[2], 16),
      b: parseInt(match[3] + match[3], 16),
      a: match[4] ? parseInt(match[4] + match[4], 16) / 255 : 1
    };
  }

  match = RE_LONG.exec(text);
  if (match) {
    return {
      r: parseInt(match[1], 16),
      g: parseInt(match[2], 16),
      b: parseInt(match[3], 16),
      a: match[4] ? parseInt(match[4], 16) / 255 : 1
    };
  }

  match = RE_RGB.exec(text);
  if (match) {
    let alpha = 1;
    if (match[4] != null) {
      alpha = match[4].endsWith('%')
        ? parseFloat(match[4]) / 100
        : parseFloat(match[4]);
    }
    return {
      r: clamp(finite(parseFloat(match[1]), 0), 0, 255),
      g: clamp(finite(parseFloat(match[2]), 0), 0, 255),
      b: clamp(finite(parseFloat(match[3]), 0), 0, 255),
      a: clamp(alpha, 0, 1)
    };
  }

  return { r: 0, g: 0, b: 0, a: 1 };
}

export function isColor(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return RE_SHORT.test(text) || RE_LONG.test(text) || RE_RGB.test(text);
}

function byteToHex(value) {
  const text = Math.round(clamp(value, 0, 255)).toString(16);
  return text.length === 1 ? '0' + text : text;
}

export function toHex(value, includeAlpha = false) {
  const color = parseColor(value);
  const base = '#' + byteToHex(color.r) + byteToHex(color.g) + byteToHex(color.b);
  if (!includeAlpha || color.a >= 1) return base.toUpperCase();
  return (base + byteToHex(color.a * 255)).toUpperCase();
}

export function rgba(value, alpha) {
  const color = parseColor(value);
  const a = clamp(finite(alpha, color.a), 0, 1);
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${a.toFixed(3)})`;
}

/* ------------------------------------------------------------------ *
 * mixing helpers
 * ------------------------------------------------------------------ */

function srgbToLinear(byte) {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value) {
  const channel = value <= 0.0031308
    ? value * 12.92
    : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return clamp(channel * 255, 0, 255);
}

/**
 * Linear interpolation between two colours.  With `gamma` enabled the blend
 * happens in linear-light space, which keeps mid-tones from turning muddy.
 */
export function mixColors(a, b, t = 0.5, gamma = false) {
  const first = parseColor(a);
  const second = parseColor(b);
  const amount = clamp(finite(t, 0.5), 0, 1);
  const mixByte = (x, y) => gamma
    ? linearToSrgb(srgbToLinear(x) * (1 - amount) + srgbToLinear(y) * amount)
    : x * (1 - amount) + y * amount;
  return {
    r: mixByte(first.r, second.r),
    g: mixByte(first.g, second.g),
    b: mixByte(first.b, second.b),
    a: first.a * (1 - amount) + second.a * amount
  };
}

export function mix(a, b, t = 0.5, gamma = false) {
  return toHex(mixColors(a, b, t, gamma));
}

export function scaleColor(value, factor) {
  const color = parseColor(value);
  const amount = finite(factor, 1);
  return {
    r: clamp(color.r * amount, 0, 255),
    g: clamp(color.g * amount, 0, 255),
    b: clamp(color.b * amount, 0, 255),
    a: color.a
  };
}

export function lighten(value, factor = 0.15) {
  return toHex(mixColors(value, '#FFFFFF', clamp(factor, 0, 1)));
}

export function darken(value, factor = 0.15) {
  return toHex(mixColors(value, '#000000', clamp(factor, 0, 1)));
}

/* ------------------------------------------------------------------ *
 * contrast utilities
 * ------------------------------------------------------------------ */

export function relativeLuminance(value) {
  const color = parseColor(value);
  return 0.2126 * srgbToLinear(color.r)
    + 0.7152 * srgbToLinear(color.g)
    + 0.0722 * srgbToLinear(color.b);
}

export function contrastRatio(a, b) {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const bright = Math.max(first, second);
  const dark = Math.min(first, second);
  return (bright + 0.05) / (dark + 0.05);
}

/** Pick whichever of two candidate inks reads more clearly on `background`. */
export function pickInk(background, darkInk = PALETTE.plum, lightInk = PALETTE.cream) {
  return contrastRatio(background, darkInk) >= contrastRatio(background, lightInk)
    ? darkInk
    : lightInk;
}

export const contrast = contrastRatio;

/* ------------------------------------------------------------------ *
 * grades + gradient ramps
 * ------------------------------------------------------------------ */

export const GRADES = Object.freeze({
  sunset: Object.freeze({
    id: 'sunset',
    name: 'Sunset',
    ink: Object.freeze([PALETTE.plum, PALETTE.magenta, PALETTE.coral, PALETTE.amber]),
    accent: PALETTE.cyan,
    paper: PALETTE.cream,
    halftone: 0.55,
    grain: 0.34,
    misregister: 0.50
  }),
  rain: Object.freeze({
    id: 'rain',
    name: 'Rain',
    ink: Object.freeze(['#0C1730', '#163A5C', '#2E7992', '#8FD9D2']),
    accent: PALETTE.cyan,
    paper: '#D9F2EF',
    halftone: 0.40,
    grain: 0.46,
    misregister: 0.28
  }),
  ink: Object.freeze({
    id: 'ink',
    name: 'Ink',
    ink: Object.freeze(['#0A0810', '#231D2A', '#4A4252', '#8E8492']),
    accent: PALETTE.amber,
    paper: '#E7E1D6',
    halftone: 0.70,
    grain: 0.24,
    misregister: 0.18
  })
});

export function gradeIds() {
  return Object.keys(GRADES);
}

/** Returns an unfrozen copy so callers may tune a grade without side effects. */
export function getGrade(id = 'sunset') {
  const source = GRADES[id] || GRADES.sunset;
  return {
    id: source.id,
    name: source.name,
    ink: source.ink.slice(),
    accent: source.accent,
    paper: source.paper,
    halftone: finite(source.halftone, 0.5),
    grain: finite(source.grain, 0.3),
    misregister: finite(source.misregister, 0.3)
  };
}

export function blendGrades(a, b, t = 0.5) {
  const first = typeof a === 'string' ? getGrade(a) : a;
  const second = typeof b === 'string' ? getGrade(b) : b;
  const amount = clamp(t, 0, 1);
  const length = Math.max(first.ink.length, second.ink.length);
  const ink = [];
  for (let i = 0; i < length; i += 1) {
    ink.push(mix(first.ink[i % first.ink.length], second.ink[i % second.ink.length], amount));
  }
  return {
    id: `${first.id}-${second.id}`,
    name: `${first.name} / ${second.name}`,
    ink,
    accent: mix(first.accent, second.accent, amount),
    paper: mix(first.paper, second.paper, amount),
    halftone: first.halftone * (1 - amount) + second.halftone * amount,
    grain: first.grain * (1 - amount) + second.grain * amount,
    misregister: first.misregister * (1 - amount) + second.misregister * amount
  };
}

/** Sample a grade's ink ramp at a normalised position (0 = first ink). */
export function sampleInk(gradeOrId, t = 0) {
  const grade = typeof gradeOrId === 'string' ? getGrade(gradeOrId) : gradeOrId;
  const inks = grade.ink && grade.ink.length ? grade.ink : [PALETTE.plum];
  if (inks.length === 1) return inks[0];
  const position = clamp(finite(t, 0), 0, 1) * (inks.length - 1);
  const index = Math.min(inks.length - 2, Math.floor(position));
  return mix(inks[index], inks[index + 1], position - index);
}

/** Build the gradient-stop array consumed by canvas gradient helpers. */
export function gradientStops(gradeOrId, count = 6) {
  const grade = typeof gradeOrId === 'string' ? getGrade(gradeOrId) : gradeOrId;
  const total = Math.max(2, Math.round(finite(count, 6)));
  const stops = [];
  for (let i = 0; i < total; i += 1) {
    const offset = total === 1 ? 0 : i / (total - 1);
    stops.push({ offset, color: sampleInk(grade, offset) });
  }
  return stops;
}

export const getGradientStops = gradientStops;

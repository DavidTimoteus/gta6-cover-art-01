/* ============================================================================
 * palette.js
 * Ink palette definitions and colour mathematics for the cover pipeline.
 *
 * The grade objects are deliberately flat: every grade exposes the same six
 * named inks so the rest of the renderer never has to know which grade is
 * active.  All colour helpers are pure and tolerate malformed input rather
 * than throwing inside a render loop.
 * ==========================================================================*/

/* ---------------------------------------------------------------- base inks */
const BASE_INKS = Object.freeze({
  plum: '#1B1035',
  magenta: '#7A2E6B',
  coral: '#FF5E7E',
  amber: '#FFB35C',
  cream: '#FFE29A',
  cyan: '#00E5C5',
});

function makeGrade(name, colors) {
  return Object.freeze(Object.assign({ name }, colors));
}

/* ------------------------------------------------------------------ grades */
export const PALETTES = Object.freeze({
  sunset: makeGrade('sunset', Object.assign({}, BASE_INKS)),

  rain: makeGrade('rain', {
    plum: '#101A36',
    magenta: '#5A2E80',
    coral: '#FF6E9E',
    amber: '#FFC46B',
    cream: '#DCE8FF',
    cyan: '#4FF2DC',
  }),

  ink: makeGrade('ink', {
    plum: '#120C24',
    magenta: '#3B2049',
    coral: '#7A3F63',
    amber: '#B07A55',
    cream: '#F3EADA',
    cyan: '#A6E7DA',
  }),
});

export const PALETTE_NAMES = Object.freeze(Object.keys(PALETTES));

/* Ordered dark-to-light ink order used by gradients and contrast ramps. */
export const INK_ORDER = Object.freeze(['plum', 'magenta', 'coral', 'amber', 'cream']);

/**
 * Resolve a grade name to a palette object. Unknown names fall back to sunset
 * so a bad query-string value never breaks the cover preview.
 */
export function getPalette(name) {
  if (name && PALETTES[name]) return PALETTES[name];
  if (typeof name === 'string') {
    const lower = name.toLowerCase();
    if (PALETTES[lower]) return PALETTES[lower];
  }
  return PALETTES.sunset;
}

/* ---------------------------------------------------------- colour parsing */
const HEX_RE = /^#?([0-9a-f]{3,8})$/i;

/**
 * Parse a colour into a normalised RGBA record.
 * Accepts #rgb, #rgba, #rrggbb, #rrggbbaa and rgb()/rgba() strings.
 */
export function parseColor(input) {
  const fallback = { r: 0, g: 0, b: 0, a: 1 };
  if (typeof input === 'number' && isFinite(input)) {
    const n = input >>> 0;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  if (typeof input !== 'string') return fallback;
  const text = input.trim();
  const hex = text.match(HEX_RE);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) {
      h = h.split('').map((c) => c + c).join('');
    }
    if (h.length >= 6) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      if ([r, g, b].every(Number.isFinite)) {
        return { r, g, b, a: clamp01(a) };
      }
    }
  }
  const fn = text.match(/^rgba?\(([^)]*)\)$/i);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return {
        r: clampByte(parts[0]),
        g: clampByte(parts[1]),
        b: clampByte(parts[2]),
        a: parts.length > 3 && Number.isFinite(parts[3]) ? clamp01(parts[3]) : 1,
      };
    }
  }
  return fallback;
}

export function hexToRgb(hex) {
  const c = parseColor(hex);
  return { r: c.r, g: c.g, b: c.b };
}

export function rgbToHex(r, g, b) {
  const toHex = (v) => clampByte(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export function rgbaToCss(input, alpha) {
  const c = parseColor(input);
  const a = alpha == null ? c.a : clamp01(alpha);
  return `rgba(${c.r},${c.g},${c.b},${a.toFixed(4)})`;
}

/* ------------------------------------------------------------- colour mixing */
function clamp01(v) {
  return Math.min(1, Math.max(0, Number(v) || 0));
}

function clampByte(v) {
  return Math.round(Math.min(255, Math.max(0, Number(v) || 0)));
}

/**
 * Linearly blend two colours in RGB space. t = 0 returns a, t = 1 returns b.
 */
export function mixColors(a, b, t) {
  const ca = parseColor(a);
  const cb = parseColor(b);
  const k = clamp01(t);
  return rgbToHex(
    ca.r + (cb.r - ca.r) * k,
    ca.g + (cb.g - ca.g) * k,
    ca.b + (cb.b - ca.b) * k,
  );
}

/** Multiply a colour's brightness. amount < 1 darkens, > 1 brightens. */
export function shadeColor(color, amount) {
  const c = parseColor(color);
  return rgbToHex(c.r * amount, c.g * amount, c.b * amount);
}

/** Blend a colour toward white (t = 1 gives white). */
export function tintColor(color, t) {
  return mixColors(color, '#FFFFFF', t);
}

/* ----------------------------------------------------------------- gradient */
/**
 * Build an evenly spread array of gradient stop records for a grade.
 * The cyan ink is included as a cool accent near the light end.
 */
export function getGradientStops(paletteOrName, count) {
  const grade = typeof paletteOrName === 'string'
    ? getPalette(paletteOrName)
    : paletteOrName || PALETTES.sunset;
  const sequence = ['plum', 'magenta', 'coral', 'amber', 'cream', 'cyan'];
  const wanted = Math.max(2, Math.min(sequence.length, count || sequence.length));
  const chosen = sequence.slice(0, wanted);
  return chosen.map((key, index) => ({
    offset: wanted === 1 ? 0 : index / (wanted - 1),
    color: grade[key] || BASE_INKS[key] || '#000000',
    ink: key,
  }));
}

export const gradientStops = getGradientStops;

/** Paint-ready CSS gradient string for DOM chrome. */
export function toCssGradient(paletteOrName, angleDeg) {
  const stops = getGradientStops(paletteOrName);
  const angle = Number(angleDeg) || 135;
  return `linear-gradient(${angle}deg, ${stops
    .map((s) => `${s.color} ${(s.offset * 100).toFixed(1)}%`)
    .join(', ')})`;
}

/* ------------------------------------------------------------------ contrast */
/** WCAG relative luminance for a colour (0 = black, 1 = white). */
export function relativeLuminance(color) {
  const c = parseColor(color);
  const channel = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG contrast ratio between two colours, in the range 1 .. 21. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

/** True when the colour is dark enough that light text reads well on it. */
export function isDark(color) {
  return relativeLuminance(color) < 0.42;
}

/**
 * Return whichever of two candidate inks has the stronger contrast on bg.
 * Handy for captions that must survive a changing plate underneath.
 */
export function readableInk(bg, lightInk, darkInk) {
  return contrastRatio(bg, lightInk) >= contrastRatio(bg, darkInk)
    ? lightInk
    : darkInk;
}

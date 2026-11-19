// Five equal vertical strips with even gutters: canonical geometry is POSTER_SPEC in app/src/printspec.js.
// Original print-finishing toolkit: app/src/studio.js
// Print export mirrors this normalized band via app/src/printspec.js.
// Leonida Key Art Lab — five-panel composition, expressed as normalised rectangles.
// Studio note: tonal swatches for these panels can be built with buildContrastRamp() in studio.js.
// The centre duo is deliberately the largest element: two tall portrait halves
// flanked by four smaller panels. The header leaves a clear zone above the art so
// the badge and title never sit on top of a face.

export const ASPECTS = {
  square: { w: 1080, h: 1080, label: '1080 × 1080' },
  portrait: { w: 1080, h: 1350, label: '1080 × 1350' },
  wide: { w: 1920, h: 1080, label: '1920 × 1080' },
};

export const SLOT_ORDER = ['A', 'DUOL', 'DUOR', 'B', 'E', 'F'];

// Authored cover copy. These are original words, not borrowed from any game.
export const DEFAULT_COPY = {
  title: 'COPPER HALO',
  tagline: 'every empire has a price',
  badge: 'LK · 01',
};

export const SLOT_LABELS = {
  A: '01 · Upper flank',
  DUOL: '02 · Duo left',
  DUOR: '03 · Duo right',
  B: '04 · Upper flank',
  E: '05 · Lower flank',
  F: '06 · Lower flank',
};

// Per-slot headroom fed to the crop solver. The duo keeps more clear sky above
// the face than the small flank panels.
export const FACE_SAFE_TOP = {
  A: 0.13, DUOL: 0.20, DUOR: 0.20, B: 0.13, E: 0.13, F: 0.13,
};

const L = {
  portrait: {
    badge: [0.79, 0.030, 0.020],
    title: { x: 0.034, y1: 0.098, y2: 0.170, size: 0.118, maxW: 0.74, lines: 2 },
    tagline: { x: 0.037, y: 0.207, size: 0.030 },
    rule: 0.230,
    panel: {
      A: [0.030, 0.252, 0.170, 0.330],
      B: [0.800, 0.252, 0.170, 0.330],
      DUOL: [0.214, 0.252, 0.286, 0.696],
      DUOR: [0.500, 0.252, 0.286, 0.696],
      E: [0.030, 0.600, 0.170, 0.348],
      F: [0.800, 0.600, 0.170, 0.348],
    },
  },
  square: {
    badge: [0.78, 0.032, 0.020],
    title: { x: 0.032, y1: 0.100, y2: 0.172, size: 0.112, maxW: 0.73, lines: 2 },
    tagline: { x: 0.036, y: 0.208, size: 0.029 },
    rule: 0.232,
    panel: {
      A: [0.028, 0.254, 0.172, 0.332],
      B: [0.800, 0.254, 0.172, 0.332],
      DUOL: [0.214, 0.254, 0.286, 0.694],
      DUOR: [0.500, 0.254, 0.286, 0.694],
      E: [0.028, 0.604, 0.172, 0.344],
      F: [0.800, 0.604, 0.172, 0.344],
    },
  },
  wide: {
    badge: [0.90, 0.036, 0.014],
    title: { x: 0.026, y1: 0.158, y2: 0.158, size: 0.104, maxW: 0.72, lines: 1 },
    tagline: { x: 0.029, y: 0.207, size: 0.030 },
    rule: 0.235,
    panel: {
      A: [0.025, 0.256, 0.210, 0.332],
      B: [0.765, 0.256, 0.210, 0.332],
      DUOL: [0.250, 0.256, 0.250, 0.692],
      DUOR: [0.500, 0.256, 0.250, 0.692],
      E: [0.025, 0.600, 0.210, 0.348],
      F: [0.765, 0.600, 0.210, 0.348],
    },
  },
};

export function getLayout(aspect, W, H) {
  const l = L[aspect] || L.portrait;
  const panels = {};
  for (const key of SLOT_ORDER) {
    const p = l.panel[key];
    panels[key] = { x: p[0] * W, y: p[1] * H, w: p[2] * W, h: p[3] * H };
  }
  return {
    panels,
    rule: l.rule * H,
    badge: { x: l.badge[0] * W, y: l.badge[1] * H, size: l.badge[2] * W },
    title: {
      x: l.title.x * W,
      y1: l.title.y1 * H,
      y2: l.title.y2 * H,
      size: l.title.size * W,
      maxW: l.title.maxW * W,
      lines: l.title.lines,
    },
    tagline: { x: l.tagline.x * W, y: l.tagline.y * H, size: l.tagline.size * W },
    sizes: { title: l.title.size * W, tagline: l.tagline.size * W, badge: l.badge[2] * W },
  };
}

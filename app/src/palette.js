// Tone-to-dot coverage for these inks is derived in app/src/printspec.js.
// Leonida Key Art Lab — colour system.
// Studio note: PRINT_PRESETS in studio.js supplies matching ink/paper colour pairs.
// High-contrast screenprint grades. Each is a five-stop luminance ramp; the
// posteriser snaps straight to those stops so a thumbnail still reads as ink,
// not as a soft photograph. The editorial grades are solar/cobalt; sunset, rain
// and ink are the deterministic cover-capture moods.

export const GRADES = {
  solar: {
    id: 'solar',
    label: 'Solar Press',
    ramp: ['#120820', '#4A1038', '#B81C4E', '#F26522', '#FFE9A8'],
    accent: '#00E5C5',
    paper: '#FFE9A8',
    ink: '#120820',
    ghostA: '#FF1E7A',
    ghostB: '#00E5C5',
    plateA: '#FF2D6F',
    plateB: '#00D9E8',
  },
  cobalt: {
    id: 'cobalt',
    label: 'Cobalt Riot',
    ramp: ['#070A22', '#251A7A', '#9B1C8E', '#12AEDA', '#EAF6FF'],
    accent: '#FF2D8F',
    paper: '#EAF6FF',
    ink: '#070A22',
    ghostA: '#FF2D8F',
    ghostB: '#00E0FF',
    plateA: '#FF2D8F',
    plateB: '#00E0FF',
  },
};

// Cover-only capture grades. They are real palettes (not a filter baked into a
// screenshot) and run through exactly the same posteriser, plates, halftone and
// grain as the two editorial grades above.
GRADES.sunset = {
  id: 'sunset',
  label: 'Sunset Burn',
  ramp: ['#1B0A1E', '#5B1636', '#C02C3F', '#FF7A2F', '#FFE0A3'],
  accent: '#FFD23F',
  paper: '#FFE0A3',
  ink: '#1B0A1E',
  ghostA: '#FF3D6E',
  ghostB: '#FFD23F',
  plateA: '#FF4D3D',
  plateB: '#FFC93C',
};
GRADES.rain = {
  id: 'rain',
  label: 'Rain Wash',
  ramp: ['#061423', '#123E5A', '#1E7A8C', '#5FC2C0', '#E8F6F2'],
  accent: '#8FE3FF',
  paper: '#E8F6F2',
  ink: '#061423',
  ghostA: '#3A8DFF',
  ghostB: '#7FE0D0',
  plateA: '#2D8CFF',
  plateB: '#57E0C8',
};
GRADES.ink = {
  id: 'ink',
  label: 'Ink Press',
  ramp: ['#0B0B0D', '#2E2E33', '#5C5C63', '#A6A6AB', '#F2F2EE'],
  accent: '#D8D8D2',
  paper: '#F2F2EE',
  ink: '#0B0B0D',
  ghostA: '#9A9A94',
  ghostB: '#D8D8D2',
  plateA: '#C8C8C2',
  plateB: '#8A8A84',
};

export const GRADE_LIST = [
  GRADES.solar, GRADES.cobalt, GRADES.sunset, GRADES.rain, GRADES.ink,
];
export const DEFAULT_GRADE = 'solar';

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function rgbToCss(c, a) {
  return a == null
    ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
    : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

export function lerpRgb(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function rampColor(ramp, t) {
  const stops = ramp.map(hexToRgb);
  const x = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return lerpRgb(stops[i], stops[i + 1], x - i);
}

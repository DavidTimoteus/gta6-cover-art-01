/*
 * Print-finishing toolkit.
 *
 * This module models the adjustable part of the press: screen angle, dot
 * pitch, ink level count, plate drift and grain.  Settings are plain objects
 * wrapped in a small class with validation, so a preset can be loaded, tweaked
 * and exported again without any global state leaking between posters.  All
 * image work delegates to the pure transforms in effects.js.
 */

import {
  halftone,
  posterize,
  channelOffset,
  grain,
  finishImageData,
  seedFrom
} from './effects.js';
import { mixColors, toHex, parseColor } from './palette.js';

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/* ------------------------------------------------------------------ *
 * screen geometry
 * ------------------------------------------------------------------ */

/** Conventional offset-print screen angles, in degrees. */
export const HALFTONE_ANGLES = Object.freeze({
  screen: 15,
  offset: 45,
  risograph: 30,
  duotone: 75,
  square: 0
});

/** Normalise any angle into the 0..90 range used by a repeating screen. */
export function normalizeAngle(degrees) {
  let value = finite(degrees, 45) % 90;
  if (value < 0) value += 90;
  return value;
}

/** Rotate a point around the origin; handy for previewing a screen grid. */
export function rotatePoint(x, y, degrees) {
  const radians = finite(degrees, 0) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos
  };
}

/**
 * Distance from a point to the centre of its halftone cell after rotation.
 * Exposed so a UI can draw the screen lattice over a zoomed preview.
 */
export function cellOffset(x, y, pitch, angle) {
  const rotated = rotatePoint(x, y, -normalizeAngle(angle));
  const step = Math.max(3, finite(pitch, 6));
  const cx = Math.floor(rotated.x / step) + 0.5;
  const cy = Math.floor(rotated.y / step) + 0.5;
  return {
    dx: rotated.x - cx * step,
    dy: rotated.y - cy * step,
    radius: Math.hypot(rotated.x - cx * step, rotated.y - cy * step)
  };
}

/* ------------------------------------------------------------------ *
 * settings object
 * ------------------------------------------------------------------ */

const DEFAULT_SETTINGS = Object.freeze({
  angle: 45,
  pitch: 6,
  levels: 4,
  strength: 0.85,
  shiftX: 1.2,
  shiftY: 0.4,
  grain: 0.18,
  seed: 4711,
  ink: '#1B1035',
  paper: '#FFE29A'
});

/** Mutable, validated finishing settings with a serialisable snapshot. */
export class PrintSettings {
  constructor(options = {}) {
    this.angle = normalizeAngle(options.angle == null ? DEFAULT_SETTINGS.angle : options.angle);
    this.pitch = clamp(Math.round(finite(options.pitch, DEFAULT_SETTINGS.pitch)), 3, 24);
    this.levels = clamp(Math.round(finite(options.levels, DEFAULT_SETTINGS.levels)), 2, 12);
    this.strength = clamp(finite(options.strength, DEFAULT_SETTINGS.strength), 0, 1.5);
    this.shiftX = clamp(finite(options.shiftX, DEFAULT_SETTINGS.shiftX), -12, 12);
    this.shiftY = clamp(finite(options.shiftY, DEFAULT_SETTINGS.shiftY), -12, 12);
    this.grain = clamp(finite(options.grain, DEFAULT_SETTINGS.grain), 0, 0.8);
    this.seed = clamp(Math.round(finite(options.seed, DEFAULT_SETTINGS.seed)), 1, 2147483647);
    this.ink = options.ink || DEFAULT_SETTINGS.ink;
    this.paper = options.paper || DEFAULT_SETTINGS.paper;
    this.label = options.label || 'Custom';
  }

  setAngle(degrees) {
    this.angle = normalizeAngle(degrees);
    return this;
  }

  setPitch(pixels) {
    this.pitch = clamp(Math.round(finite(pixels, this.pitch)), 3, 24);
    return this;
  }

  setLevels(count) {
    this.levels = clamp(Math.round(finite(count, this.levels)), 2, 12);
    return this;
  }

  setGrain(amount) {
    this.grain = clamp(finite(amount, this.grain), 0, 0.8);
    return this;
  }

  setShift(x, y) {
    this.shiftX = clamp(finite(x, this.shiftX), -12, 12);
    this.shiftY = clamp(finite(y, this.shiftY), -12, 12);
    return this;
  }

  setInks(ink, paper) {
    this.ink = ink || this.ink;
    this.paper = paper || this.paper;
    return this;
  }

  clone() {
    return new PrintSettings(this.snapshot());
  }

  snapshot() {
    return {
      angle: this.angle,
      pitch: this.pitch,
      levels: this.levels,
      strength: this.strength,
      shiftX: this.shiftX,
      shiftY: this.shiftY,
      grain: this.grain,
      seed: this.seed,
      ink: this.ink,
      paper: this.paper,
      label: this.label
    };
  }

  /** Translate the friendly settings into the options effects.js expects. */
  toOptions() {
    const ink = parseColor(this.ink);
    const paper = parseColor(this.paper);
    return {
      levels: this.levels,
      halftone: {
        pitch: this.pitch,
        angle: this.angle,
        strength: this.strength,
        ink: [ink.r, ink.g, ink.b],
        paper: [paper.r, paper.g, paper.b]
      },
      misregister: { dx: this.shiftX, dy: this.shiftY },
      grain: { amount: this.grain, seed: this.seed }
    };
  }
}

/* ------------------------------------------------------------------ *
 * named press presets
 * ------------------------------------------------------------------ */

export const PRINT_PRESETS = Object.freeze({
  newsprint: Object.freeze({
    label: 'Newsprint',
    angle: 15, pitch: 9, levels: 3, strength: 0.7,
    shiftX: 1.6, shiftY: 0.6, grain: 0.34, seed: 211,
    ink: '#231D2A', paper: '#E7E1D6'
  }),
  gloss: Object.freeze({
    label: 'Gloss proof',
    angle: 45, pitch: 4, levels: 6, strength: 0.95,
    shiftX: 0.5, shiftY: 0.2, grain: 0.08, seed: 907,
    ink: '#0C1730', paper: '#D9F2EF'
  }),
  risograph: Object.freeze({
    label: 'Risograph',
    angle: 30, pitch: 7, levels: 3, strength: 1.05,
    shiftX: 2.4, shiftY: 0.9, grain: 0.26, seed: 77,
    ink: '#7A2E6B', paper: '#FFE29A'
  }),
  duoPlate: Object.freeze({
    label: 'Two-plate duotone',
    angle: 75, pitch: 6, levels: 4, strength: 0.8,
    shiftX: 3.0, shiftY: 1.1, grain: 0.16, seed: 512,
    ink: '#1B1035', paper: '#FF5E7E'
  }),
  archival: Object.freeze({
    label: 'Archival matte',
    angle: 22, pitch: 5, levels: 5, strength: 0.62,
    shiftX: 0.3, shiftY: 0.1, grain: 0.12, seed: 3301,
    ink: '#1B1035', paper: '#F4EBD8'
  })
});

export function presetIds() {
  return Object.keys(PRINT_PRESETS);
}

export function getPreset(id) {
  const source = PRINT_PRESETS[id] || PRINT_PRESETS.newsprint;
  return new PrintSettings({ ...source, label: source.label });
}

export function settingsFrom(value) {
  if (value instanceof PrintSettings) return value.clone();
  if (typeof value === 'string') return getPreset(value);
  return new PrintSettings(value || {});
}

/* ------------------------------------------------------------------ *
 * contrast ramp builder
 * ------------------------------------------------------------------ */

/**
 * Build an evenly spaced ramp between two inks.  `gamma` performs the blend
 * in linear light, which keeps the middle steps from looking muddy in print.
 */
export function buildContrastRamp(from, to, steps = 6, gamma = true) {
  const total = clamp(Math.round(finite(steps, 6)), 2, 16);
  const ramp = [];
  for (let i = 0; i < total; i += 1) {
    const t = i / (total - 1);
    ramp.push({
      t,
      hex: toHex(mixColors(from, to, t, gamma)),
      mix: mixColors(from, to, t, gamma)
    });
  }
  return ramp;
}

/** A three-stop ramp with an explicit midpoint ink, useful for duo plates. */
export function rampWithMidpoint(dark, middle, light, steps = 7) {
  const firstHalf = buildContrastRamp(dark, middle, Math.ceil(steps / 2));
  const secondHalf = buildContrastRamp(middle, light, Math.floor(steps / 2));
  return firstHalf.slice(0, -1).concat(secondHalf);
}

/* ------------------------------------------------------------------ *
 * batch finishing
 * ------------------------------------------------------------------ */

function validBuffer(buffer) {
  return !!buffer && !!buffer.data && buffer.width > 0 && buffer.height > 0;
}

/** Apply the full finishing chain to a single ImageData buffer. */
export function applyFinishing(imageData, settingsOrPreset) {
  if (!validBuffer(imageData)) return null;
  const settings = settingsFrom(settingsOrPreset);
  return finishImageData(imageData, settings.toOptions());
}

/** Apply finishing to many buffers, preserving their original order. */
export function finishBatch(buffers = [], settingsOrPreset) {
  const settings = settingsFrom(settingsOrPreset);
  return (Array.isArray(buffers) ? buffers : []).map((buffer) => {
    if (!validBuffer(buffer)) return null;
    return finishImageData(buffer, settings.toOptions());
  });
}

/** Run only one stage of the chain, for isolated comparison proofs. */
export function applyStage(imageData, stage, settingsOrPreset) {
  if (!validBuffer(imageData)) return null;
  const options = settingsFrom(settingsOrPreset).toOptions();
  if (stage === 'posterize') return posterize(imageData, options.levels);
  if (stage === 'halftone') return halftone(imageData, options.halftone);
  if (stage === 'offset') return channelOffset(imageData, options.misregister);
  if (stage === 'grain') return grain(imageData, options.grain);
  return finishImageData(imageData, options);
}

/** Human-readable settings line for status bars and exported notes. */
export function describeSettings(settingsOrPreset) {
  const settings = settingsFrom(settingsOrPreset);
  const seed = seedFrom(settings.label, settings.pitch, settings.seed);
  return `${settings.label} · ${settings.angle}° screen · ${settings.pitch}px dot · `
    + `${settings.levels} inks · plate shift ${settings.shiftX.toFixed(1)}/${settings.shiftY.toFixed(1)} · `
    + `seed ${seed}`;
}

export default {
  PrintSettings,
  PRINT_PRESETS,
  HALFTONE_ANGLES,
  getPreset,
  settingsFrom,
  buildContrastRamp,
  rampWithMidpoint,
  applyFinishing,
  finishBatch,
  applyStage,
  describeSettings
};

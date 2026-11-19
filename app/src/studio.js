/*
 * studio.js
 * A small print-finishing toolkit layered on top of the pure pixel passes.
 *
 * Where effects.js supplies the raw transforms, this module gives them names
 * and knobs: adjustable screen angle and dot pitch, a set of stock print
 * presets, a contrast-ramp builder for proofing, and a batch runner for
 * finishing several plates (or several pages) in one call.
 */

import { parseHex, mixHex, toHex, clamp } from './palette.js';
import {
  posterizeToInks,
  halftone,
  channelOffset,
  paperGrain,
  finishImageData,
  dimensionsOf,
} from './effects.js';

/** Degrees-to-radians helper; the halftone pass works in radians. */
export function degreesToRadians(degrees) {
  return Number(degrees || 0) * Math.PI / 180;
}

/** Reverse conversion, handy for showing the current screen in the UI. */
export function radiansToDegrees(radians) {
  return Number(radians || 0) * 180 / Math.PI;
}

/*
 * Named presets.  Angles are stored in degrees so a press operator can read
 * them; pitch is in device pixels at a 1080px reference width.
 */
export const PRINT_PRESETS = Object.freeze({
  newsprint: Object.freeze({
    name: 'newsprint',
    halftoneAngleDeg: 45,
    dotPitch: 4.2,
    posterizeLevels: 4,
    grainAmount: 0.085,
    offsetX: 1.8,
    offsetY: -1.1,
    halftoneStrength: 0.72,
  }),
  gloss: Object.freeze({
    name: 'gloss',
    halftoneAngleDeg: 22.5,
    dotPitch: 7.5,
    posterizeLevels: 6,
    grainAmount: 0.025,
    offsetX: 0.6,
    offsetY: -0.4,
    halftoneStrength: 0.48,
  }),
  risograph: Object.freeze({
    name: 'risograph',
    halftoneAngleDeg: 15,
    dotPitch: 5.6,
    posterizeLevels: 3,
    grainAmount: 0.07,
    offsetX: 2.4,
    offsetY: 1.6,
    halftoneStrength: 0.66,
  }),
  zine: Object.freeze({
    name: 'zine',
    halftoneAngleDeg: 60,
    dotPitch: 3.4,
    posterizeLevels: 3,
    grainAmount: 0.11,
    offsetX: 2.2,
    offsetY: -1.8,
    halftoneStrength: 0.8,
  }),
  archival: Object.freeze({
    name: 'archival',
    halftoneAngleDeg: 30,
    dotPitch: 9.0,
    posterizeLevels: 7,
    grainAmount: 0.018,
    offsetX: 0.4,
    offsetY: -0.2,
    halftoneStrength: 0.4,
  }),
});

/** Preset keys in a stable display order. */
export const PRINT_PRESET_KEYS = Object.freeze(Object.keys(PRINT_PRESETS));

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Build a complete finishing profile from a preset name plus overrides.
 * The returned object is plain and safe to JSON-serialize.
 */
export function makeProfile(presetName, overrides) {
  const key = PRINT_PRESETS[presetName] ? presetName : 'newsprint';
  const base = PRINT_PRESETS[key];
  const o = overrides || {};
  return {
    preset: key,
    halftoneAngleDeg: numberOr(o.halftoneAngleDeg, base.halftoneAngleDeg),
    dotPitch: clamp(numberOr(o.dotPitch, base.dotPitch), 2, 24),
    posterizeLevels: clamp(Math.round(numberOr(o.posterizeLevels, base.posterizeLevels)), 2, 12),
    grainAmount: clamp(numberOr(o.grainAmount, base.grainAmount), 0, 0.3),
    offsetX: numberOr(o.offsetX, base.offsetX),
    offsetY: numberOr(o.offsetY, base.offsetY),
    halftoneStrength: clamp(numberOr(o.halftoneStrength, base.halftoneStrength), 0, 1),
    seed: Math.floor(numberOr(o.seed, 1337)),
    width: Math.floor(numberOr(o.width, 1080)),
  };
}

/** Replace only the screen angle, keeping the rest of the profile intact. */
export function setHalftoneAngle(profile, degrees) {
  const next = { ...(profile || makeProfile('newsprint')) };
  next.halftoneAngleDeg = ((numberOr(degrees, 0) % 180) + 180) % 180;
  next.halftoneAngle = degreesToRadians(next.halftoneAngleDeg);
  return next;
}

/** Replace only the dot pitch.  Smaller numbers give a finer screen. */
export function setDotPitch(profile, pitch) {
  const next = { ...(profile || makeProfile('newsprint')) };
  next.dotPitch = clamp(numberOr(pitch, 5), 2, 24);
  return next;
}

/** Scale the pitch with the target print width so a 1920px sheet matches a 1080px proof. */
export function dotPitchForWidth(profile, width) {
  const p = profile || makeProfile('newsprint');
  const reference = Math.max(1, numberOr(p.width, 1080));
  const target = Math.max(1, numberOr(width, reference));
  return clamp(p.dotPitch * target / reference, 2, 32);
}

/**
 * Build a contrast ramp: `steps` equally spaced swatches between two inks,
 * returned as uppercase hex strings.  A midpoint ink can bend the ramp.
 */
export function buildContrastRamp(dark, light, steps, midpoint) {
  const count = clamp(Math.round(numberOr(steps, 6)), 2, 24);
  const from = parseHex(dark || '#1B1035');
  const to = parseHex(light || '#FFE29A');
  const mid = midpoint ? parseHex(midpoint) : null;
  const ramp = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    if (mid && t < 0.5) {
      ramp.push(mixHex(from, mid, t * 2));
    } else if (mid) {
      ramp.push(mixHex(mid, to, (t - 0.5) * 2));
    } else {
      ramp.push(toHex({
        r: from.r + (to.r - from.r) * t,
        g: from.g + (to.g - from.g) * t,
        b: from.b + (to.b - from.b) * t,
      }));
    }
  }
  return ramp;
}

/** Turn a profile into the option bag finishImageData expects. */
export function profileToFinishOptions(profile, palette, width) {
  const p = profile || makeProfile('newsprint');
  const w = Math.max(1, numberOr(width, p.width));
  const angle = numberOr(p.halftoneAngle, degreesToRadians(p.halftoneAngleDeg));
  return {
    width: w,
    posterizeLevels: p.posterizeLevels,
    inks: buildContrastRamp(
      palette && palette.plum || '#1B1035',
      palette && palette.cream || '#FFE29A',
      Math.max(3, p.posterizeLevels),
      palette && palette.magenta || '#7A2E6B',
    ),
    halftoneAngle: angle,
    halftonePitch: dotPitchForWidth(p, w),
    halftoneStrength: p.halftoneStrength,
    ink: palette && palette.ink || '#1B1035',
    paper: palette && palette.paper || '#FFE29A',
    grainAmount: p.grainAmount,
    seed: p.seed,
    offsetX: p.offsetX,
    offsetY: p.offsetY,
    offsetSplit: 0.55,
    tint: palette && palette.accent || '#FF5E7E',
  };
}

/** Finish a single plate with a profile.  Always returns a new ImageData. */
export function applyStudioFinish(imageData, profile, palette) {
  const p = profile || makeProfile('newsprint');
  const { w, h } = dimensionsOf(imageData);
  return finishImageData(imageData, palette, profileToFinishOptions(p, palette, w || p.width));
}

/**
 * Finish several buffers with one profile.  Each buffer gets the same screen
 * angle and grain seed, which is what keeps a multi-plate job registered.
 */
export function batchFinish(buffers, profile, palette, options) {
  const list = Array.isArray(buffers) ? buffers : [];
  const opts = options || {};
  const results = [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    const source = item && item.imageData ? item.imageData : item;
    const perPlateProfile = opts.varyAngle
      ? setHalftoneAngle(profile, numberOr(profile && profile.halftoneAngleDeg, 45) + i * numberOr(opts.angleStep, 7.5))
      : profile;
    results.push(applyStudioFinish(source, perPlateProfile, palette));
  }
  return results;
}

/**
 * Low-level pass order exposed for callers that want to insert their own step
 * between posterization and halftoning (for example a spot-colour override).
 */
export function finishInStages(imageData, palette, profile) {
  const p = profile || makeProfile('newsprint');
  const opts = profileToFinishOptions(p, palette);
  const inks = opts.inks || ['#1B1035', '#7A2E6B', '#FFB35C', '#FFE29A'];
  const flat = posterizeToInks(imageData, inks, p.posterizeLevels);
  const screened = halftone(flat, {
    angle: opts.halftoneAngle,
    pitch: opts.halftonePitch,
    strength: p.halftoneStrength,
    ink: opts.ink,
    paper: opts.paper,
  });
  const offset = channelOffset(screened, {
    dx: p.offsetX,
    dy: p.offsetY,
    split: 0.55,
    tint: opts.tint,
  });
  return paperGrain(offset, { amount: p.grainAmount, seed: p.seed });
}

/** Describe a profile in one short line, useful for status labels. */
export function describeProfile(profile) {
  const p = profile || makeProfile('newsprint');
  const angle = Math.round(numberOr(p.halftoneAngleDeg, 0));
  return `${p.preset} · ${angle}° screen · ${numberOr(p.dotPitch, 0).toFixed(1)}px dots · ${p.posterizeLevels} inks`;
}

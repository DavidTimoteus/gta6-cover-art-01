/*
 * archive.js
 * Metadata and small utilities for storing, recalling and exporting posters.
 *
 * This module never paints.  It describes the saved poster presets, the paper
 * sizes we can export, and a few deterministic helpers (grain seeds, tagline
 * wrapping, palette mixing) that make saved jobs reproducible across reloads.
 */

import { PALETTE, GRADE_KEYS, parseHex, toHex, mixHex, clamp } from './palette.js';

/** Export targets with a human label and a nominal print DPI. */
export const EXPORT_SIZES = Object.freeze([
  Object.freeze({ key: 'square', w: 1080, h: 1080, label: 'Square proof', dpi: 150 }),
  Object.freeze({ key: 'portrait', w: 1080, h: 1350, label: 'Portrait proof', dpi: 150 }),
  Object.freeze({ key: 'wide', w: 1920, h: 1080, label: 'Wide banner', dpi: 150 }),
]);

/** Poster presets shipped with the archive.  Titles are kept short. */
export const POSTER_PRESETS = Object.freeze([
  Object.freeze({
    id: 'copper-halo',
    title: 'COPPER HALO',
    tagline: 'EVERY EMPIRE HAS A PRICE',
    badge: 'LK-01',
    grade: 'sunset',
    size: 'square',
    seed: 20261119,
    blurb: 'Warm duotone with a coral screen and a deep plum foot.',
  }),
  Object.freeze({
    id: 'night-transit',
    title: 'NIGHT TRANSIT',
    tagline: 'THE CITY KEEPS ITS SECRETS',
    badge: 'LK-02',
    grade: 'rain',
    size: 'portrait',
    seed: 40719,
    blurb: 'Cyan wash over magenta shadows, tuned for a tall sheet.',
  }),
  Object.freeze({
    id: 'ink-meridian',
    title: 'INK MERIDIAN',
    tagline: 'DRAWN IN THREE PLATES',
    badge: 'LK-03',
    grade: 'ink',
    size: 'wide',
    seed: 88231,
    blurb: 'A restrained ink grade with wide-plate misregistration.',
  }),
]);

/** Map a preset id to its metadata, or null when unknown. */
export function getPreset(id) {
  return POSTER_PRESETS.find((preset) => preset.id === id) || null;
}

/** List preset summaries for a picker control. */
export function listPresets() {
  return POSTER_PRESETS.map((preset) => ({
    id: preset.id,
    title: preset.title,
    grade: preset.grade,
    size: preset.size,
  }));
}

/** Find an export-size definition by key. */
export function getExportSize(key) {
  return EXPORT_SIZES.find((size) => size.key === key) || EXPORT_SIZES[0];
}

/** Validate a grade string against the known grade keys. */
export function normalizeGrade(grade) {
  return GRADE_KEYS.includes(grade) ? grade : 'sunset';
}

/**
 * Deterministic grain seed from a string.  FNV-1a keeps the same poster on the
 * same seed forever, so a saved job always reproduces its grain field.
 */
export function grainSeedFor(input) {
  const text = String(input == null ? '' : input);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Alias that reads naturally at call sites. */
export function deterministicGrainSeed(input) {
  return grainSeedFor(input);
}

/**
 * Wrap a tagline into lines no longer than `maxChars`, preferring word
 * boundaries.  A single over-long word is never split mid-glyph here.
 */
export function wrapTagline(text, maxChars) {
  const limit = Math.max(6, Math.floor(Number(maxChars) || 24));
  const words = String(text == null ? '' : text).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = '';
  words.forEach((word) => {
    const candidate = line ? line + ' ' + word : word;
    if (candidate.length <= limit || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  });
  if (line) lines.push(line);
  return lines;
}

/** Choose a wrapping width from the title length and the poster size. */
export function suggestTaglineWidth(title, sizeKey) {
  const base = sizeKey === 'wide' ? 42 : (sizeKey === 'portrait' ? 26 : 30);
  const length = String(title || '').length;
  return Math.max(16, base - Math.floor(length / 3));
}

/**
 * Mix a list of colour strings with optional weights.  Weights are normalized
 * to sum to one; an unweighted list is mixed evenly.
 */
export function mixPalette(colours, weights) {
  const list = Array.isArray(colours) && colours.length ? colours : [PALETTE.plum, PALETTE.cream];
  const parsed = list.map(parseHex);
  let w = Array.isArray(weights) && weights.length === parsed.length ? weights.slice() : parsed.map(() => 1);
  w = w.map((value) => Math.max(0, Number(value) || 0));
  const total = w.reduce((a, b) => a + b, 0) || 1;
  let r = 0;
  let g = 0;
  let b = 0;
  parsed.forEach((colour, i) => {
    const weight = w[i] / total;
    r += colour.r * weight;
    g += colour.g * weight;
    b += colour.b * weight;
  });
  return toHex({ r, g, b });
}

/** Blend two named palette inks, returning a hex string. */
export function blendInks(a, b, t) {
  return mixHex(a || PALETTE.plum, b || PALETTE.cream, clamp(t, 0, 1));
}

/** Build a fresh metadata record for a new poster in the archive. */
export function createArchiveEntry(options) {
  const o = options || {};
  const title = String(o.title || 'UNTITLED');
  const size = getExportSize(o.size);
  const grade = normalizeGrade(o.grade);
  const seed = Number.isFinite(Number(o.seed)) ? Number(o.seed) >>> 0 : grainSeedFor(title + grade);
  return {
    id: o.id || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'poster',
    title,
    tagline: String(o.tagline || ''),
    badge: String(o.badge || 'LK-01'),
    grade,
    size: size.key,
    seed,
    width: size.w,
    height: size.h,
    taglineLines: wrapTagline(o.tagline, suggestTaglineWidth(title, size.key)),
  };
}

/** Rough uncompressed buffer size in megabytes, for memory budgeting. */
export function estimateBufferMB(width, height) {
  const w = Math.max(1, Number(width) || 1080);
  const h = Math.max(1, Number(height) || 1080);
  return (w * h * 4) / (1024 * 1024);
}

/** Human-readable summary of an archive entry. */
export function describeEntry(entry) {
  if (!entry) return 'empty entry';
  return `${entry.title} · ${entry.grade} · ${entry.width}x${entry.height} · seed ${entry.seed}`;
}

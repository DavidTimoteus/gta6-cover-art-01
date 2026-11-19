/*
 * Leonida Key Art Lab — editor controller.
 *
 * This module owns the single mutable `state` object, all input handling, the
 * live proof canvas and the three PNG exports. Pixel work lives in sibling
 * modules that are authored separately; the shared named-export contract is
 * recorded below and every imported symbol is exposed on HELPERS so an
 * integration check can verify the wiring at runtime.
 *
 * ---------------------------------------------------------------------------
 * SIBLING MODULE CONTRACT (names used by this controller)
 *
 * palette.js
 *   getPalette(grade)  -> { name, plum, magenta, coral, amber, cream, cyan, ... }
 *   GRADE_KEYS         -> ['sunset', 'rain', 'ink']
 *
 * layouts.js
 *   SIZE_PRESETS       -> { square:{w:1080,h:1080}, portrait:{w:1080,h:1350},
 *                           wide:{w:1920,h:1080} }
 *   PANELS             -> five entries, each { id, x, y, w, h, role, duo, label }
 *                         with x/y/w/h normalised to 0..1; entry id 2 is the
 *                         large centre "duo" hero panel.
 *
 * smartcrop.js
 *   detectSkinRegion(img) -> { x, y, w, h } | null   (normalised source region)
 *   autoCrop(img, panelRect, { targetX, targetY })
 *                          -> { zoom, x, y, focus } that parks the brightest
 *                             skin-like patch just under the header badge.
 *
 * effects.js
 *   applyFinish(ctx, w, h, palette, options)
 *                          -> applies halftone, posterised flats, grain and
 *                             ink misregistration in place on the 2D context.
 *
 * render.js
 *   renderCover(canvas, config) -> paints the entire poster into `canvas`.
 *   drawPanel(ctx, rect, img, srcRect, palette)
 *   drawBadge(ctx, rect, text, palette)
 *   drawType(ctx, layout, title, tagline, palette)
 *   `config` = { width, height, panels, panelStates, photos, labels,
 *                title, tagline, badge, grade, palette, size }
 *   A panel whose `panelStates[i].source` has no image is painted as a flat
 *   ink field rather than throwing.
 * ---------------------------------------------------------------------------
 */

import { getPalette, GRADE_KEYS } from './palette.js';
import { SIZE_PRESETS, PANELS } from './layouts.js';
import { autoCrop, detectSkinRegion } from './smartcrop.js';
import { applyFinish } from './effects.js';
import { renderCover, drawPanel, drawBadge, drawType } from './render.js';

/** Live registry of the pipeline helpers (also handy for integration smoke tests). */
export const HELPERS = Object.freeze({
  getPalette, GRADE_KEYS, SIZE_PRESETS, PANELS,
  autoCrop, detectSkinRegion, applyFinish,
  renderCover, drawPanel, drawBadge, drawType,
});

const SAMPLE_SOURCES = {
  boulevard: new URL('../samples/boulevard.jpg', import.meta.url).href,
  pier: new URL('../samples/pier.jpg', import.meta.url).href,
};

const EXPORT_SIZES = {
  square: [1080, 1080],
  portrait: [1080, 1350],
  wide: [1920, 1080],
};

const PROOF_LONG_EDGE = 1080;
const CROP_TARGET = { targetX: 0.5, targetY: 0.58 };

const state = {
  photos: { A: null, B: null },
  labels: { A: '', B: '' },
  panelStates: PANELS.map((panel) => ({
    source: panel.duo ? 'A' : 'A',
    zoom: 1.2,
    x: 0,
    y: 0,
    autoCrop: true,
  })),
  title: 'COPPER HALO',
  tagline: 'EVERY EMPIRE HAS A PRICE',
  badge: 'LK-01',
  grade: 'sunset',
  palette: getPalette('sunset'),
  previewKey: 'square',
  activePanel: 2,
};

const byId = (id) => document.getElementById(id);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cover';

/* --------------------------------------------------------------------- ui */

let toastTimer = 0;
function toast(message) {
  const el = byId('toast');
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2400);
}

function status(message) {
  byId('statusLine').textContent = message;
}

function previewDimensions(key) {
  const base = SIZE_PRESETS[key] || SIZE_PRESETS.square;
  const scale = PROOF_LONG_EDGE / Math.max(base.w, base.h);
  return { w: Math.round(base.w * scale), h: Math.round(base.h * scale), base };
}

function setPreviewSize(key) {
  const { w, h, base } = previewDimensions(key);
  state.previewKey = key in SIZE_PRESETS ? key : 'square';
  const canvas = byId('preview');
  canvas.width = w;
  canvas.height = h;
  byId('stageMeta').textContent = `${base.w} × ${base.h} · ${state.grade}`;
  render();
}

function setGrade(grade) {
  if (!GRADE_KEYS.includes(grade)) return;
  state.grade = grade;
  state.palette = getPalette(grade);
  document.querySelectorAll('[data-grade]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.grade === grade);
  });
  const { base } = previewDimensions(state.previewKey);
  byId('stageMeta').textContent = `${base.w} × ${base.h} · ${grade}`;
  render();
}

/* ------------------------------------------------------------- image load */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image could not be decoded: ' + src));
    img.src = src;
  });
}

async function loadSample(name, slot) {
  if (!SAMPLE_SOURCES[name]) throw new Error('Unknown sample: ' + name);
  const img = await loadImage(SAMPLE_SOURCES[name]);
  state.photos[slot] = img;
  state.labels[slot] = name === 'boulevard' ? 'Boulevard sample' : 'Pier sample';
  return img;
}

function loadPhotoFromFile(file, slot) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      loadImage(String(event.target.result)).then(
        (img) => {
          state.photos[slot] = img;
          state.labels[slot] = file.name || 'Local photo';
          resolve(img);
        },
        reject,
      );
    };
    reader.onerror = () => reject(new Error('The selected file could not be read.'));
    reader.readAsDataURL(file);
  });
}

/* --------------------------------------------------------------- crop work */

function autoFill(options = {}) {
  const { silent = false } = options;
  const routing = ['A', 'B', 'A', 'B', 'A'];

  PANELS.forEach((panel, index) => {
    const ps = state.panelStates[index];
    let wanted = routing[index] || 'A';
    if (!state.photos[wanted]) wanted = state.photos.A ? 'A' : (state.photos.B ? 'B' : null);

    if (!wanted) {
      ps.source = 'none';
      ps.zoom = 1;
      ps.x = 0;
      ps.y = 0;
      return;
    }

    ps.source = wanted;
    let fit = null;
    if (ps.autoCrop) {
      fit = autoCrop(state.photos[wanted], panel, CROP_TARGET);
    }
    ps.zoom = clamp(fit && fit.zoom, 1, 3);
    ps.x = clamp(fit && fit.x, -1, 1);
    ps.y = clamp(fit && fit.y, -1, 1);
  });

  if (silent) return;

  syncControls();
  render();
  const focus = state.photos.A ? detectSkinRegion(state.photos.A) : null;
  status(focus
    ? 'Focus locked below the badge — five panels filled.'
    : 'Five panels filled — nudge the crops by hand.');
  toast('Panels filled');
}

function reCrop(index) {
  const ps = state.panelStates[index];
  const img = state.photos[ps.source];
  if (!img) return;
  const fit = autoCrop(img, PANELS[index], CROP_TARGET);
  if (!fit) return;
  ps.zoom = clamp(fit.zoom, 1, 3);
  ps.x = clamp(fit.x, -1, 1);
  ps.y = clamp(fit.y, -1, 1);
  syncControls();
}

/* ---------------------------------------------------------- panel controls */

function buildPanelControls() {
  byId('panelControls').innerHTML = PANELS.map((panel, i) => `
    <article class="panel-card${i === state.activePanel ? ' is-active' : ''}" data-panel="${i}">
      <header class="panel-card-head">
        <span class="panel-index">${String(i + 1).padStart(2, '0')}</span>
        <span class="panel-role">${panel.duo ? 'duo hero' : (panel.role || 'panel')}</span>
      </header>
      <div class="panel-card-body">
        <label class="mini-field">
          <span>Source</span>
          <select data-field="source">
            <option value="A">Photo A</option>
            <option value="B">Photo B</option>
            <option value="none">Flat ink</option>
          </select>
        </label>
        <label class="mini-field">
          <span>Zoom <output data-out="zoom"></output></span>
          <input type="range" data-field="zoom" min="1" max="3" step="0.01" value="1.2">
        </label>
        <label class="mini-field">
          <span>Offset X <output data-out="x"></output></span>
          <input type="range" data-field="x" min="-1" max="1" step="0.01" value="0">
        </label>
        <label class="mini-field">
          <span>Offset Y <output data-out="y"></output></span>
          <input type="range" data-field="y" min="-1" max="1" step="0.01" value="0">
        </label>
        <label class="mini-check">
          <input type="checkbox" data-field="auto" checked> Face-aware auto crop
        </label>
      </div>
    </article>`).join('');
}

function syncCardOutputs(card) {
  const ps = state.panelStates[Number(card.dataset.panel)];
  if (!ps) return;
  const read = (field) => card.querySelector(`[data-field="${field}"]`);
  const write = (name, value) => {
    const out = card.querySelector(`[data-out="${name}"]`);
    if (out) out.textContent = value;
  };
  const source = read('source'); if (source) source.value = ps.source;
  const zoom = read('zoom'); if (zoom) zoom.value = String(ps.zoom);
  const x = read('x'); if (x) x.value = String(ps.x);
  const y = read('y'); if (y) y.value = String(ps.y);
  const auto = read('auto'); if (auto) auto.checked = ps.autoCrop;
  write('zoom', Number(ps.zoom).toFixed(2) + '×');
  write('x', Number(ps.x).toFixed(2));
  write('y', Number(ps.y).toFixed(2));
}

function syncControls() {
  document.querySelectorAll('.panel-card').forEach(syncCardOutputs);
}

function bindEvents() {
  const host = byId('panelControls');

  host.addEventListener('click', (event) => {
    const card = event.target.closest('.panel-card');
    if (!card) return;
    state.activePanel = Number(card.dataset.panel);
    host.querySelectorAll('.panel-card').forEach((c) => c.classList.toggle('is-active', c === card));
  });

  host.addEventListener('input', (event) => {
    const field = event.target.dataset.field;
    const card = event.target.closest('.panel-card');
    if (!field || !card) return;
    const ps = state.panelStates[Number(card.dataset.panel)];
    if (!ps) return;

    if (field === 'source') {
      ps.source = event.target.value;
    } else if (field === 'auto') {
      ps.autoCrop = event.target.checked;
      if (ps.autoCrop) reCrop(Number(card.dataset.panel));
    } else {
      ps[field] = parseFloat(event.target.value);
      ps.autoCrop = false;
    }
    syncCardOutputs(card);
    render();
  });

  const dropzone = byId('dropzone');
  const fileInput = byId('fileInput');
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  ['dragenter', 'dragover'].forEach((type) => dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.add('is-over');
  }));
  ['dragleave', 'dragend'].forEach((type) => dropzone.addEventListener(type, () => {
    dropzone.classList.remove('is-over');
  }));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-over');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    const slot = byId('uploadSlot').value;
    loadPhotoFromFile(file, slot).then(() => {
      status(`${state.labels[slot]} loaded into Photo ${slot}.`);
      render();
      toast('Photo loaded');
    }).catch((err) => { status(err.message); toast('Load failed'); });
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const slot = byId('uploadSlot').value;
    loadPhotoFromFile(file, slot).then(() => {
      status(`${state.labels[slot]} loaded into Photo ${slot}.`);
      render();
      toast('Photo loaded');
    }).catch((err) => { status(err.message); toast('Load failed'); });
    fileInput.value = '';
  });

  document.querySelectorAll('[data-sample]').forEach((button) => {
    button.addEventListener('click', () => {
      const slot = byId('uploadSlot').value;
      loadSample(button.dataset.sample, slot).then(() => {
        status(`${state.labels[slot]} loaded into Photo ${slot}.`);
        render();
        toast('Sample loaded');
      }).catch((err) => { status(err.message); toast('Sample unavailable'); });
    });
  });

  byId('autoFill').addEventListener('click', () => autoFill());

  byId('titleInput').addEventListener('input', (e) => {
    state.title = e.target.value;
    byId('stageName').textContent = state.title || 'UNTITLED';
    render();
  });
  byId('taglineInput').addEventListener('input', (e) => {
    state.tagline = e.target.value;
    render();
  });
  byId('gradeControls').addEventListener('click', (e) => {
    const button = e.target.closest('[data-grade]');
    if (button) setGrade(button.dataset.grade);
  });
  byId('previewSize').addEventListener('change', (e) => setPreviewSize(e.target.value));

  document.querySelectorAll('[data-export]').forEach((button) => {
    button.addEventListener('click', () => {
      const dims = EXPORT_SIZES[button.dataset.export];
      if (dims) download(byId('preview'), dims[0], dims[1]);
    });
  });
}

/* ------------------------------------------------------------ render/export */

function buildConfig(canvas) {
  return {
    width: canvas.width,
    height: canvas.height,
    panels: PANELS,
    panelStates: state.panelStates,
    photos: state.photos,
    labels: state.labels,
    title: state.title,
    tagline: state.tagline,
    badge: state.badge,
    grade: state.grade,
    palette: state.palette,
    size: state.previewKey,
  };
}

function render() {
  if (document.body.classList.contains('cover-mode')) return;
  const canvas = byId('preview');
  renderCover(canvas, buildConfig(canvas));
}

/**
 * Paint a fresh canvas at the requested pixel dimensions and save a real PNG.
 * Re-rendering at export resolution keeps type, dot pitch and grain correct.
 */
function download(canvas, width, height) {
  const sheet = document.createElement('canvas');
  sheet.width = width;
  sheet.height = height;

  const config = buildConfig(canvas);
  config.width = width;
  config.height = height;
  renderCover(sheet, config);

  const filename = `leonida-${slug(state.title)}-${width}x${height}.png`;
  const save = (href) => {
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  if (typeof sheet.toBlob === 'function') {
    sheet.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      save(url);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
  } else {
    save(sheet.toDataURL('image/png'));
  }

  toast(`Exported ${width}×${height} PNG`);
}

/* --------------------------------------------------------------- url modes */

function loadBothSamples() {
  return Promise.all([
    loadSample('boulevard', 'A'),
    loadSample('pier', 'B'),
  ]);
}

function setupCoverMode(params) {
  const requestedSize = params.get('size');
  const requestedGrade = params.get('grade');
  const sizeKey = requestedSize && requestedSize in SIZE_PRESETS ? requestedSize : 'square';
  const gradeKey = requestedGrade && GRADE_KEYS.includes(requestedGrade) ? requestedGrade : 'sunset';

  state.previewKey = sizeKey;
  state.grade = gradeKey;
  state.palette = getPalette(gradeKey);

  document.body.classList.add('cover-mode');
  const stage = byId('coverStage');
  stage.hidden = false;

  const { w, h } = SIZE_PRESETS[sizeKey];
  const canvas = byId('coverCanvas');
  canvas.width = w;
  canvas.height = h;

  loadBothSamples().then(() => {
    autoFill({ silent: true });
    renderCover(canvas, buildConfig(canvas));
  }).catch((err) => {
    status(err.message);
    renderCover(canvas, buildConfig(canvas));
  });
}

function setupEditorMode(params) {
  setPreviewSize(state.previewKey);
  if (params.get('shot') !== 'editor') return;

  loadBothSamples().then(() => {
    autoFill();
    toast('Samples loaded — panels filled');
  }).catch((err) => {
    status(err.message);
    render();
  });
}

function init() {
  buildPanelControls();
  bindEvents();

  const params = new URLSearchParams(location.search);
  if (params.get('shot') === 'cover') {
    setupCoverMode(params);
  } else {
    setupEditorMode(params);
  }
}

init();

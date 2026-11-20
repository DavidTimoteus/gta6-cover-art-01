/*
 * Leonida Key Art Lab — editor controller.
 *
 * This module owns UI state and orchestration. The drawing work lives in five
 * small sibling modules; their expected shapes are documented here so each can
 * be implemented independently and swapped without touching this file.
 *
 * palette.js
 *   PALETTE : { plum, magenta, coral, amber, cream, cyan, ... }  (hex strings)
 *   GRADES  : Array<{ id: string, name: string, ...gradeParams }>  — five presets
 *
 * layouts.js
 *   buildSlantedLayout(width, height) -> Array<Spec> of length 5
 *   Spec = { index, role, x, y, w, h, rotate, z }
 *   x/y are panel CENTRES in canvas pixels, w/h are pixel sizes, rotate is in
 *   radians. Spec index 2 is the large centre "duo" panel.
 *
 * smartcrop.js
 *   faceAwareCrop(image, outW, outH, opts) -> { sx, sy, sw, sh }
 *   opts = { autoCrop: boolean, zoom: number, panX: number, panY: number }
 *   Returns a source rectangle in image pixels; when autoCrop is true it
 *   biases the framing downward so subjects sit below the header badge.
 *
 * effects.js
 *   applyGrade(ctx, grade, width, height) -> void   (global colour pass)
 *   drawGrain(ctx, width, height, opacity?) -> void (finishing texture pass)
 *
 * render.js
 *   renderCover(ctx, scene) -> void  (draws the complete poster composition)
 *   scene = {
 *     width, height, size, palette: PALETTE, grade,
 *     title, tagline, chip,
 *     panels: Array<Spec & { crop, image, zoom, x, y }>
 *   }
 *   A panel whose image is null should be drawn as a gradient placeholder.
 */

import { PALETTE, GRADES } from './palette.js';
import { buildSlantedLayout } from './layouts.js';
import { faceAwareCrop } from './smartcrop.js';
import { applyGrade, drawGrain } from './effects.js';
import { renderCover } from './render.js';

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

const SIZES = {
  square:   { w: 1080, h: 1080, label: 'SQUARE' },
  portrait: { w: 1080, h: 1350, label: 'PORTRAIT' },
  wide:     { w: 1920, h: 1080, label: 'WIDE' },
};

const PANEL_COUNT = 5;
const APP_BASE = new URL('../', import.meta.url);
const SAMPLE_PATHS = {
  boulevard: new URL('samples/boulevard.jpg', APP_BASE).href,
  pier:      new URL('samples/pier.jpg', APP_BASE).href,
};

const $ = (selector) => document.querySelector(selector);

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const state = {
  size: 'wide',                 // hero view is the 16:9 wide cover
  gradeId: GRADES[0] ? GRADES[0].id : 'default',
  autoCrop: true,
  title: 'COPPER HALO',
  tagline: 'EVERY EMPIRE HAS A PRICE.',
  chip: 'VOL. 06',
  activePanel: 0,
  photos: new Map(),            // id -> { id, name, image }
  panels: Array.from({ length: PANEL_COUNT }, () => ({
    source: null,
    zoom: 1.12,
    x: 0,
    y: 0,
  })),
};

const stage = $('#stage');

/* ------------------------------------------------------------------ *
 * Small utilities
 * ------------------------------------------------------------------ */

function currentGrade() {
  return GRADES.find((g) => g.id === state.gradeId) || GRADES[0] ||
    { id: 'default', name: 'Default' };
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cover';
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/* ------------------------------------------------------------------ *
 * Photo pipeline
 * ------------------------------------------------------------------ */

async function registerPhoto(id, name, src) {
  const image = await loadImage(src);
  if (!image) return null;
  const photo = { id, name, image };
  state.photos.set(id, photo);
  refreshSourceOptions();
  return photo;
}

function autofill() {
  const ids = [...state.photos.keys()];
  if (!ids.length) return;
  state.panels.forEach((panel, i) => {
    panel.source = ids[i % ids.length];
    panel.zoom = 1.12;
    panel.x = 0;
    panel.y = i === 2 ? 0.04 : 0;   // centre duo sits a touch lower
  });
  syncPanelControls();
}

async function handleFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('image/'));
  for (const file of files) {
    let dataUrl;
    try {
      dataUrl = await readFileAsDataURL(file);
    } catch (_) {
      continue;
    }
    const id = 'file-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const photo = await registerPhoto(id, file.name, dataUrl);
    if (!photo) continue;

    const alreadyFilled = state.panels.some((p) => p.source);
    if (!alreadyFilled) autofill();
    else state.panels[state.activePanel].source = id;
  }
  syncPanelControls();
  render();
}

/* ------------------------------------------------------------------ *
 * Control construction & synchronisation
 * ------------------------------------------------------------------ */

function buildPanelTabs() {
  const wrap = $('#panel-tabs');
  wrap.innerHTML = '';
  for (let i = 0; i < PANEL_COUNT; i += 1) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab';
    btn.dataset.panel = String(i);
    btn.textContent = i === 2 ? 'CENTRE' : String(i + 1).padStart(2, '0');
    btn.addEventListener('click', () => {
      state.activePanel = i;
      syncPanelControls();
      render();
    });
    wrap.appendChild(btn);
  }
}

function buildGradeButtons() {
  const wrap = $('#grades');
  wrap.innerHTML = '';
  GRADES.forEach((grade) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'grade-btn';
    btn.dataset.grade = grade.id;
    btn.textContent = grade.name;
    btn.addEventListener('click', () => {
      state.gradeId = grade.id;
      syncGrades();
      render();
    });
    wrap.appendChild(btn);
  });
  syncGrades();
}

function refreshSourceOptions() {
  const select = $('#panel-source');
  const previous = select.value;
  select.innerHTML = '<option value="">— empty —</option>';
  state.photos.forEach((photo) => {
    const option = document.createElement('option');
    option.value = photo.id;
    option.textContent = photo.name;
    select.appendChild(option);
  });
  if (previous && state.photos.has(previous)) select.value = previous;
}

function syncPanelControls() {
  const panel = state.panels[state.activePanel];

  document.querySelectorAll('.tab').forEach((tab) => {
    const active = Number(tab.dataset.panel) === state.activePanel;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });

  refreshSourceOptions();
  $('#panel-source').value = panel.source || '';

  $('#panel-zoom').value = panel.zoom;
  $('#panel-x').value = panel.x;
  $('#panel-y').value = panel.y;
  $('#zoom-out').textContent = Number(panel.zoom).toFixed(2);
  $('#x-out').textContent = Number(panel.x).toFixed(2);
  $('#y-out').textContent = Number(panel.y).toFixed(2);

  $('#autocrop').checked = state.autoCrop;
}

function syncGrades() {
  document.querySelectorAll('.grade-btn').forEach((btn) => {
    const active = btn.dataset.grade === state.gradeId;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

/* ------------------------------------------------------------------ *
 * Scene assembly, painting and export
 * ------------------------------------------------------------------ */

function buildScene(width, height) {
  const specs = buildSlantedLayout(width, height);

  let size = 'wide';
  Object.keys(SIZES).forEach((key) => {
    if (SIZES[key].w === width && SIZES[key].h === height) size = key;
  });

  const panels = specs.map((spec, i) => {
    const cfg = state.panels[i] || {};
    const photo = cfg.source ? state.photos.get(cfg.source) : null;
    const image = photo && photo.image && photo.image.complete && photo.image.naturalWidth
      ? photo.image
      : null;
    const zoom = cfg.zoom == null ? 1.12 : cfg.zoom;
    const x = cfg.x == null ? 0 : cfg.x;
    const y = cfg.y == null ? 0 : cfg.y;
    const crop = image
      ? faceAwareCrop(image, spec.w, spec.h, { autoCrop: state.autoCrop, zoom, panX: x, panY: y })
      : null;

    return { ...spec, crop, image, zoom, x, y };
  });

  return {
    width,
    height,
    size,
    palette: PALETTE,
    grade: currentGrade(),
    title: state.title,
    tagline: state.tagline,
    chip: state.chip,
    panels,
  };
}

function paint(canvas, width, height) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  const scene = buildScene(width, height);
  renderCover(ctx, scene);          // composition: background, panels, lettering
  applyGrade(ctx, scene.grade, width, height);
  drawGrain(ctx, width, height);
}

function render() {
  const { w, h } = SIZES[state.size];
  paint(stage, w, h);
  $('#stage-size').textContent = `${SIZES[state.size].label} · ${w} × ${h}`;
  $('#stage-grade').textContent = `GRADE · ${currentGrade().name}`;
}

function download(canvas, width, height) {
  paint(canvas, width, height);
  const filename = `${slug(state.title)}-${width}x${height}.png`;

  const save = (href, revoke) => {
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (revoke) window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  if (typeof canvas.toBlob === 'function') {
    canvas.toBlob((blob) => {
      if (blob) save(URL.createObjectURL(blob), true);
      else save(canvas.toDataURL('image/png'), false);
    }, 'image/png');
  } else {
    save(canvas.toDataURL('image/png'), false);
  }
}

/* ------------------------------------------------------------------ *
 * Event wiring
 * ------------------------------------------------------------------ */

function bindEvents() {
  document.querySelectorAll('[data-export]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const { w, h } = SIZES[btn.dataset.export];
      download(document.createElement('canvas'), w, h);
    });
  });

  const dropzone = $('#dropzone');
  const fileInput = $('#file-input');
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFiles(fileInput.files);
    fileInput.value = '';
  });
  ['dragenter', 'dragover'].forEach((type) => {
    dropzone.addEventListener(type, (e) => {
      e.preventDefault();
      dropzone.classList.add('is-dragging');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    dropzone.addEventListener(type, (e) => {
      e.preventDefault();
      dropzone.classList.remove('is-dragging');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });

  document.querySelectorAll('.sample-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await registerPhoto(btn.dataset.src, btn.dataset.label, btn.dataset.src);
      state.panels[state.activePanel].source = btn.dataset.src;
      syncPanelControls();
      render();
    });
  });

  $('#autofill').addEventListener('click', () => {
    autofill();
    render();
  });

  $('#panel-source').addEventListener('change', (e) => {
    state.panels[state.activePanel].source = e.target.value || null;
    render();
  });

  const bindSlider = (selector, output, key) => {
    $(selector).addEventListener('input', (e) => {
      const value = Number(e.target.value);
      state.panels[state.activePanel][key] = value;
      $(output).textContent = value.toFixed(2);
      render();
    });
  };
  bindSlider('#panel-zoom', '#zoom-out', 'zoom');
  bindSlider('#panel-x', '#x-out', 'x');
  bindSlider('#panel-y', '#y-out', 'y');

  $('#autocrop').addEventListener('change', (e) => {
    state.autoCrop = e.target.checked;
    render();
  });

  const bindCopy = (selector, key) => {
    $(selector).addEventListener('input', (e) => {
      state[key] = e.target.value;
      render();
    });
  };
  bindCopy('#field-title', 'title');
  bindCopy('#field-tagline', 'tagline');
  bindCopy('#field-chip', 'chip');
}

/* ------------------------------------------------------------------ *
 * Query modes
 * ------------------------------------------------------------------ */

async function applyQueryModes() {
  const params = new URLSearchParams(window.location.search);
  const shot = params.get('shot');

  if (shot === 'cover') {
    document.body.classList.add('shot-cover');
    const requestedSize = params.get('size');
    if (requestedSize && SIZES[requestedSize]) state.size = requestedSize;
    const requestedGrade = params.get('grade');
    if (requestedGrade && GRADES.some((g) => g.id === requestedGrade)) {
      state.gradeId = requestedGrade;
      syncGrades();
    }
  }

  if (shot === 'editor' || shot === 'cover') {
    await registerPhoto('boulevard', 'Boulevard', SAMPLE_PATHS.boulevard);
    await registerPhoto('pier', 'Pier', SAMPLE_PATHS.pier);
    autofill();
  }
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function init() {
  buildPanelTabs();
  buildGradeButtons();
  bindEvents();
  syncPanelControls();
  applyQueryModes().then(render);
}

init();

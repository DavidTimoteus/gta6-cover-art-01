/* ============================================================================
 * Leonida Key Art Lab — editor controller.
 *
 * CROSS-MODULE CONTRACTS
 * These sibling ES modules are authored in parallel; the names below are the
 * exact imports this controller relies on.
 *
 *   ./palette.js
 *     PALETTES : { [grade]: {...} }   grade keys: sunset | rain | ink
 *     getPalette(name) -> { name, plum, magenta, coral, amber, cream, cyan }
 *
 *   ./layouts.js
 *     COVER_SIZES : { square:{width,height}, portrait:{width,height},
 *                     wide:{width,height} }
 *     PANEL_IDS   : string[] — ids of the five panels, centre included
 *     getPanels(width, height) -> [{ id, label, x, y, w, h, duo }]
 *         x/y/w/h are pixel rects in the given canvas; `duo` marks the large
 *         centre panel that composites two plates.
 *
 *   ./smartcrop.js
 *     faceAwareCrop(image, rect, options) -> { x, y, zoom }
 *         Finds a bright / skin-like region ("the face") and returns pan
 *         offsets x,y in [-1,1] plus a zoom >= 1 so the region lands at
 *         options.focusY (fraction of panel height, below the header badge).
 *
 *   ./effects.js
 *     applyPrintFinish(ctx, { width, height, palette, grade })
 *         Applies halftone dots, posterized flats, grain and ink
 *         misregistration directly onto ctx, in place.
 *
 *   ./render.js
 *     renderCover(ctx, options) — draws the complete poster (background, the
 *     five photo panels, badge, title and tagline) into ctx. `options` is the
 *     object produced by buildRenderOptions() below.
 * ==========================================================================*/

import { PALETTES, getPalette } from './palette.js';
import { COVER_SIZES, PANEL_IDS, getPanels } from './layouts.js';
import { faceAwareCrop } from './smartcrop.js';
import { applyPrintFinish } from './effects.js';
import { renderCover } from './render.js';

/* ------------------------------------------------------------------ constants */
const SAMPLE_SOURCES = {
  boulevard: './samples/boulevard.jpg',
  pier: './samples/pier.jpg',
};

const SAMPLE_LABELS = {
  boulevard: 'Boulevard',
  pier: 'Pier',
};

// Internal resolution used for the live preview; CSS scales it into the stage.
const PREVIEW_SIZE = { width: 1080, height: 1080 };

const FOCUS_Y = 0.34; // keep detected faces below the badge / header band

/* ----------------------------------------------------------------------- state */
const state = {
  grade: 'sunset',
  title: 'COPPER HALO',
  tagline: 'EVERY EMPIRE HAS A PRICE',
  badge: 'LK-01',
  photos: {},        // key -> drawable image (HTMLImageElement or canvas)
  photoLabels: {},   // key -> human label
  photoOrder: [],    // insertion order of keys
  uploadCount: 0,
  autoCrop: true,
  activePanel: 'center',
  panels: {},        // id -> { source, zoom, x, y }
  duo: { a: 'boulevard', b: 'pier' },
};

function defaultPanelConfig() {
  const config = {};
  PANEL_IDS.forEach((id, index) => {
    config[id] = {
      source: id === 'center' ? 'duo' : index % 2 === 0 ? 'boulevard' : 'pier',
      zoom: 1,
      x: 0,
      y: 0,
    };
  });
  return config;
}
state.panels = defaultPanelConfig();
if (!PANEL_IDS.includes(state.activePanel) && PANEL_IDS.length) {
  state.activePanel = PANEL_IDS[0];
}

/* ------------------------------------------------------------------- DOM refs */
const el = {
  editorRoot: document.getElementById('editorRoot'),
  coverRoot: document.getElementById('coverRoot'),
  previewCanvas: document.getElementById('previewCanvas'),
  coverCanvas: document.getElementById('coverCanvas'),
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('fileInput'),
  autoFillBtn: document.getElementById('autoFillBtn'),
  panelList: document.getElementById('panelList'),
  panelSource: document.getElementById('panelSource'),
  zoomRange: document.getElementById('zoomRange'),
  xRange: document.getElementById('xRange'),
  yRange: document.getElementById('yRange'),
  zoomOut: document.getElementById('zoomOut'),
  xOut: document.getElementById('xOut'),
  yOut: document.getElementById('yOut'),
  autoCropToggle: document.getElementById('autoCropToggle'),
  titleInput: document.getElementById('titleInput'),
  taglineInput: document.getElementById('taglineInput'),
  stageMeta: document.getElementById('stageMeta'),
  toast: document.getElementById('toast'),
};

/* --------------------------------------------------------------- render bridge */
function buildRenderOptions(width, height) {
  return {
    width,
    height,
    palette: getPalette(state.grade),
    grade: state.grade,
    panels: getPanels(width, height),
    photos: state.photos,
    panelState: state.panels,
    duo: state.duo,
    title: state.title,
    tagline: state.tagline,
    badge: state.badge,
  };
}

// Paint a finished poster into an arbitrary canvas at an arbitrary resolution.
function paint(canvas, width, height) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const options = buildRenderOptions(width, height);
  renderCover(ctx, options);
  applyPrintFinish(ctx, {
    width,
    height,
    palette: options.palette,
    grade: state.grade,
  });
  return canvas;
}

let scheduled = false;
function scheduleRender() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    if (el.previewCanvas) {
      paint(el.previewCanvas, PREVIEW_SIZE.width, PREVIEW_SIZE.height);
    }
    updateStageMeta();
  });
}

function render() {
  if (!el.previewCanvas) return;
  paint(el.previewCanvas, PREVIEW_SIZE.width, PREVIEW_SIZE.height);
  updateStageMeta();
}

function updateStageMeta() {
  if (!el.stageMeta) return;
  el.stageMeta.textContent = `${state.title || 'UNTITLED'} · ${state.badge} · ${state.grade}`;
}

/* ------------------------------------------------------------------- exporting */
function download(canvas, width, height) {
  paint(canvas, width, height);
  const link = document.createElement('a');
  link.download = `${slug(state.title)}-${width}x${height}.png`;
  link.href = canvas.toDataURL('image/png');
  document.body.appendChild(link);
  link.click();
  link.remove();
  showToast(`Saved ${width} × ${height} PNG`);
}

function slug(text) {
  return String(text || 'cover')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'cover';
}

let toastTimer = null;
function showToast(message) {
  if (!el.toast) return;
  el.toast.textContent = message;
  el.toast.hidden = false;
  el.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.classList.remove('is-visible');
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 220);
  }, 1800);
}

/* --------------------------------------------------------------- photo loading */
function storePhoto(key, image, label) {
  if (!state.photos[key]) state.photoOrder.push(key);
  state.photos[key] = image;
  state.photoLabels[key] = label || key;
  const sampleButton = document.querySelector(`[data-sample="${key}"]`);
  if (sampleButton) sampleButton.classList.add('is-loaded');
  refreshSourceOptions();
  scheduleRender();
}

function loadSample(key) {
  return new Promise((resolve) => {
    const path = SAMPLE_SOURCES[key];
    if (!path) return resolve(null);
    const image = new Image();
    image.onload = () => {
      storePhoto(key, image, SAMPLE_LABELS[key] || key);
      resolve(image);
    };
    image.onerror = () => {
      // If a sample plate is missing, still deliver something drawable so the
      // renderer and crop analyser have a real pixel source to work with.
      const fallback = makeFallbackPlate(key);
      storePhoto(key, fallback, SAMPLE_LABELS[key] || key);
      resolve(fallback);
    };
    image.src = path;
  });
}

function makeFallbackPlate(key) {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 900;
  const ctx = canvas.getContext('2d');
  const tint = key === 'pier' ? ['#7A2E6B', '#1B1035'] : ['#FF5E7E', '#1B1035'];
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, tint[0]);
  gradient.addColorStop(1, tint[1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#FFE29A';
  for (let y = 80; y < canvas.height; y += 46) {
    ctx.fillRect(0, y, canvas.width, 6);
  }
  ctx.globalAlpha = 1;
  return canvas;
}

function loadUploadedFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      state.uploadCount += 1;
      const key = `upload-${state.uploadCount}`;
      storePhoto(key, image, file.name || `Upload ${state.uploadCount}`);
      showToast(`Loaded ${file.name || 'photo'}`);
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* ------------------------------------------------------------------ auto crop */
function autoCropAll(width, height) {
  const panels = getPanels(width, height);
  PANEL_IDS.forEach((id) => {
    const panel = panels.find((entry) => entry.id === id);
    const config = state.panels[id];
    if (!panel || !config) return;

    const key = config.source === 'duo' ? (state.duo.a || state.photoOrder[0]) : config.source;
    const image = state.photos[key];
    if (!image) return;

    const crop = faceAwareCrop(image, panel, { zoom: config.zoom, focusY: FOCUS_Y });
    if (crop && typeof crop.x === 'number') {
      config.x = clamp(crop.x, -1, 1);
      config.y = clamp(crop.y, -1, 1);
      config.zoom = clamp(crop.zoom || config.zoom, 1, 3);
    }
  });
  syncPanelControls();
  scheduleRender();
}

async function autoFill() {
  await Promise.all([loadSample('boulevard'), loadSample('pier')]);
  autoCropAll(PREVIEW_SIZE.width, PREVIEW_SIZE.height);
  showToast('Panels filled');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/* ------------------------------------------------------------- panel controls */
function buildPanelButtons() {
  if (!el.panelList) return;
  const panels = getPanels(PREVIEW_SIZE.width, PREVIEW_SIZE.height);
  el.panelList.innerHTML = '';
  PANEL_IDS.forEach((id) => {
    const panel = panels.find((entry) => entry.id === id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-pick';
    button.dataset.panel = id;
    const title = document.createElement('strong');
    title.textContent = panel ? panel.label : id;
    const sub = document.createElement('span');
    sub.textContent = panel && panel.duo ? 'duo · large' : 'single plate';
    button.append(title, sub);
    button.addEventListener('click', () => selectPanel(id));
    el.panelList.appendChild(button);
  });
  markActivePanelButton();
}

function markActivePanelButton() {
  document.querySelectorAll('.panel-pick').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.panel === state.activePanel);
  });
}

function selectPanel(id) {
  state.activePanel = id;
  markActivePanelButton();
  syncPanelControls();
}

function refreshSourceOptions() {
  if (!el.panelSource) return;
  const select = el.panelSource;
  const previous = select.value || state.panels[state.activePanel]?.source || '';
  select.innerHTML = '';

  const duo = document.createElement('option');
  duo.value = 'duo';
  duo.textContent = 'Duo (two plates)';
  select.appendChild(duo);

  state.photoOrder.forEach((key) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = state.photoLabels[key] || key;
    select.appendChild(option);
  });

  const config = state.panels[state.activePanel];
  const target = config && (config.source === 'duo' || state.photos[config.source]) ? config.source : 'duo';
  select.value = state.photos[previous] || previous === 'duo' ? previous : target;
}

function syncPanelControls() {
  const config = state.panels[state.activePanel];
  if (!config) return;
  refreshSourceOptions();
  if (el.panelSource) el.panelSource.value = config.source;

  if (el.zoomRange) el.zoomRange.value = String(config.zoom);
  if (el.xRange) el.xRange.value = String(config.x);
  if (el.yRange) el.yRange.value = String(config.y);
  if (el.zoomOut) el.zoomOut.textContent = Number(config.zoom).toFixed(2);
  if (el.xOut) el.xOut.textContent = Number(config.x).toFixed(2);
  if (el.yOut) el.yOut.textContent = Number(config.y).toFixed(2);
}

/* --------------------------------------------------------------- editor wiring */
function wireEditor() {
  el.fileInput?.addEventListener('change', (event) => {
    Array.from(event.target.files || []).forEach(loadUploadedFile);
    event.target.value = '';
  });

  ['dragenter', 'dragover'].forEach((type) => {
    el.dropzone?.addEventListener(type, (event) => {
      event.preventDefault();
      el.dropzone.classList.add('is-dragging');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    el.dropzone?.addEventListener(type, (event) => {
      event.preventDefault();
      el.dropzone.classList.remove('is-dragging');
    });
  });
  el.dropzone?.addEventListener('drop', (event) => {
    Array.from(event.dataTransfer?.files || []).forEach(loadUploadedFile);
  });

  document.querySelectorAll('[data-sample]').forEach((button) => {
    button.addEventListener('click', () => loadSample(button.dataset.sample));
  });

  el.autoFillBtn?.addEventListener('click', autoFill);

  el.panelSource?.addEventListener('change', (event) => {
    const config = state.panels[state.activePanel];
    if (!config) return;
    config.source = event.target.value;
    if (state.autoCrop) {
      const panel = getPanels(PREVIEW_SIZE.width, PREVIEW_SIZE.height).find((p) => p.id === state.activePanel);
      const key = config.source === 'duo' ? state.duo.a : config.source;
      const image = state.photos[key];
      if (panel && image) {
        const crop = faceAwareCrop(image, panel, { zoom: config.zoom, focusY: FOCUS_Y });
        config.x = clamp(crop.x, -1, 1);
        config.y = clamp(crop.y, -1, 1);
      }
    }
    scheduleRender();
  });

  const bindSlider = (input, output, field, digits) => {
    input?.addEventListener('input', () => {
      const config = state.panels[state.activePanel];
      if (!config) return;
      config[field] = Number(input.value);
      if (output) output.textContent = Number(input.value).toFixed(digits);
      scheduleRender();
    });
  };
  bindSlider(el.zoomRange, el.zoomOut, 'zoom', 2);
  bindSlider(el.xRange, el.xOut, 'x', 2);
  bindSlider(el.yRange, el.yOut, 'y', 2);

  el.autoCropToggle?.addEventListener('change', () => {
    state.autoCrop = Boolean(el.autoCropToggle.checked);
    if (state.autoCrop) autoCropAll(PREVIEW_SIZE.width, PREVIEW_SIZE.height);
  });

  el.titleInput?.addEventListener('input', () => {
    state.title = el.titleInput.value;
    scheduleRender();
  });
  el.taglineInput?.addEventListener('input', () => {
    state.tagline = el.taglineInput.value;
    scheduleRender();
  });

  document.querySelectorAll('[data-grade]').forEach((button) => {
    button.addEventListener('click', () => setGrade(button.dataset.grade));
  });

  document.querySelectorAll('[data-export]').forEach((button) => {
    button.addEventListener('click', () => {
      const size = COVER_SIZES[button.dataset.export];
      if (!size) return;
      download(document.createElement('canvas'), size.width, size.height);
    });
  });
}

function setGrade(grade) {
  if (!PALETTES[grade]) return;
  state.grade = grade;
  document.querySelectorAll('[data-grade]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.grade === grade);
  });
  scheduleRender();
}

/* -------------------------------------------------------------- cover mode */
async function initCoverMode(params) {
  document.body.classList.add('cover-mode');
  if (el.editorRoot) el.editorRoot.hidden = true;
  if (el.coverRoot) el.coverRoot.hidden = false;

  const sizeKey = params.get('size');
  const grade = params.get('grade');
  const dims = COVER_SIZES[sizeKey] || COVER_SIZES.square;

  if (grade && PALETTES[grade]) state.grade = grade;

  if (el.coverCanvas) {
    const scale = Math.min(
      window.innerWidth / dims.width,
      window.innerHeight / dims.height,
    );
    el.coverCanvas.style.width = `${Math.floor(dims.width * scale)}px`;
    el.coverCanvas.style.height = `${Math.floor(dims.height * scale)}px`;
  }

  await Promise.all([loadSample('boulevard'), loadSample('pier')]);
  autoCropAll(dims.width, dims.height);

  if (el.coverCanvas) paint(el.coverCanvas, dims.width, dims.height);

  window.addEventListener('resize', () => {
    if (!el.coverCanvas) return;
    const scale = Math.min(
      window.innerWidth / dims.width,
      window.innerHeight / dims.height,
    );
    el.coverCanvas.style.width = `${Math.floor(dims.width * scale)}px`;
    el.coverCanvas.style.height = `${Math.floor(dims.height * scale)}px`;
  });
}

/* ---------------------------------------------------------------- bootstrap */
function initEditor(autoFillOnStart) {
  buildPanelButtons();
  wireEditor();
  syncPanelControls();
  render();
  if (autoFillOnStart) autoFill();
}

function init() {
  const params = new URLSearchParams(window.location.search);
  const shot = params.get('shot');

  if (shot === 'cover') {
    initCoverMode(params);
    return;
  }

  // Default and ?shot=editor both show the full editor; the latter auto-fills.
  initEditor(shot === 'editor');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

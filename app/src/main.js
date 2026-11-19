/*
 * Leonida Key Art Lab — editor controller.
 *
 * NAMED-EXPORT CONTRACT FOR THE FIVE MODULES WRITTEN IN PARALLEL
 * (every call below is guarded, so the console still works if a module
 *  is briefly absent or returns something unexpected):
 *
 *   ./palette.js
 *     PALETTE                         { plum, magenta, coral, amber, cream, cyan } (hex strings)
 *     getGrade(id)                    -> { id, name, ink:[hex,...], accent:hex,
 *                                          paper:hex, halftone:number, grain:number,
 *                                          misregister:number }
 *
 *   ./layouts.js
 *     resolvePanels(layout, W, H)     -> [{ id, label, x, y, w, h, duo }] in pixels
 *     getTitleZone(W, H)              -> { x, y, w, h } in pixels
 *
 *   ./smartcrop.js
 *     faceAwareCrop(image, opts)      -> { x, y, confidence }  normalized 0..1 focus
 *                                         point, biased just under the poster badge
 *
 *   ./effects.js
 *     applyHalftone(ctx, x, y, w, h, opts)
 *     applyGrain(ctx, W, H, opts)
 *     applyMisregistration(ctx, opts)
 *     posterize(imageData, levels)    -> ImageData
 *
 *   ./render.js
 *     renderPoster(canvas, config, fx) -> void
 *       config = { width, height, grade, palette, panels, title, tagline,
 *                  badge, titleZone, layout }
 *       panels[i] = { id, label, x, y, w, h, duo, index,
 *                     image: HTMLImageElement|null,
 *                     crop: { sx, sy, sw, sh }|null }
 *       fx = the four effects functions listed above
 */

import { renderPoster } from './render.js';
import { applyHalftone, applyGrain, applyMisregistration, posterize } from './effects.js';
import { resolvePanels, getTitleZone } from './layouts.js';
import { PALETTE, getGrade } from './palette.js';
import { faceAwareCrop } from './smartcrop.js';

/* ------------------------------------------------------------------ *
 * constants
 * ------------------------------------------------------------------ */

const DISPLAY_FONT = '"Arial Black", Impact, "Arial Narrow", sans-serif';
const UI_FONT = '"Arial Narrow", Arial, Helvetica, sans-serif';

const LOCAL_PALETTE = {
  plum: '#1B1035',
  magenta: '#7A2E6B',
  coral: '#FF5E7E',
  amber: '#FFB35C',
  cream: '#FFE29A',
  cyan: '#00E5C5'
};

const LOCAL_GRADES = {
  sunset: {
    id: 'sunset', name: 'Sunset',
    ink: [LOCAL_PALETTE.plum, LOCAL_PALETTE.magenta, LOCAL_PALETTE.coral, LOCAL_PALETTE.amber],
    accent: LOCAL_PALETTE.cyan, paper: LOCAL_PALETTE.cream,
    halftone: 0.55, grain: 0.34, misregister: 0.50
  },
  rain: {
    id: 'rain', name: 'Rain',
    ink: ['#0C1730', '#163A5C', '#2E7992', '#8FD9D2'],
    accent: LOCAL_PALETTE.cyan, paper: '#D9F2EF',
    halftone: 0.40, grain: 0.46, misregister: 0.28
  },
  ink: {
    id: 'ink', name: 'Ink',
    ink: ['#0A0810', '#231D2A', '#4A4252', '#8E8492'],
    accent: LOCAL_PALETTE.amber, paper: '#E7E1D6',
    halftone: 0.70, grain: 0.24, misregister: 0.18
  }
};

const EXPORT_SIZES = {
  square: [1080, 1080],
  portrait: [1080, 1350],
  wide: [1920, 1080]
};

/* Normalized poster geometry. Index 0 is the oversized centre "duo" panel;
   the four satellite panels hug it on both sides, leaving a bottom band
   for the title lockup. render helpers receive this array untouched. */
const PANEL_LAYOUT = [
  { id: 'centre',    label: 'Centre duo', x: 0.275, y: 0.060, w: 0.450, h: 0.515, duo: true },
  { id: 'northwest', label: 'Northwest',  x: 0.045, y: 0.060, w: 0.210, h: 0.255, duo: false },
  { id: 'southwest', label: 'Southwest',  x: 0.045, y: 0.325, w: 0.210, h: 0.250, duo: false },
  { id: 'northeast', label: 'Northeast',  x: 0.745, y: 0.060, w: 0.210, h: 0.255, duo: false },
  { id: 'southeast', label: 'Southeast',  x: 0.745, y: 0.325, w: 0.210, h: 0.250, duo: false }
];

const SAMPLE_SOURCES = [
  { id: 'sample-boulevard', label: 'Boulevard', path: 'app/samples/boulevard.jpg' },
  { id: 'sample-pier',      label: 'Pier',      path: 'app/samples/pier.jpg' }
];

/* ------------------------------------------------------------------ *
 * tiny utilities
 * ------------------------------------------------------------------ */

const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function safeCall(fn, ...args) {
  if (typeof fn !== 'function') return null;
  try {
    return fn(...args);
  } catch (error) {
    console.warn('[LK Lab] helper call failed:', error);
    return null;
  }
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/* ------------------------------------------------------------------ *
 * state
 * ------------------------------------------------------------------ */

function freshPanel() {
  return { photoId: null, zoom: 1, x: 0, y: 0, autoCrop: true };
}

const state = {
  photos: [],
  panels: PANEL_LAYOUT.map(() => freshPanel()),
  selectedPanel: 0,
  title: 'COPPER HALO',
  tagline: 'EVERY EMPIRE HAS A PRICE',
  badge: 'LK-01',
  grade: 'sunset'
};

/* ------------------------------------------------------------------ *
 * photo intake
 * ------------------------------------------------------------------ */

function makePhoto(image, id, label) {
  let focus = { x: 0.5, y: 0.45, confidence: 0 };
  const found = safeCall(faceAwareCrop, image, { preferredY: 0.42, searchTop: 0.18, searchBottom: 0.72 });
  if (found && Number.isFinite(found.x) && Number.isFinite(found.y)) {
    focus = {
      x: clamp(found.x, 0, 1),
      y: clamp(found.y, 0, 1),
      confidence: Number.isFinite(found.confidence) ? found.confidence : 1
    };
  }
  return {
    id,
    label: label || id,
    image,
    focus,
    width: image.naturalWidth || image.width || 1,
    height: image.naturalHeight || image.height || 1
  };
}

function addPhoto(photo) {
  if (!photo) return;
  const existing = state.photos.findIndex((p) => p.id === photo.id);
  if (existing >= 0) state.photos[existing] = photo;
  else state.photos.push(photo);
  populateSourceSelects();
  updateStatus();
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not decode ${src}`));
    image.src = src;
  });
}

async function loadSample(entry) {
  if (state.photos.some((p) => p.id === entry.id)) return;
  try {
    const image = await loadImageElement(entry.path);
    addPhoto(makePhoto(image, entry.id, entry.label));
  } catch (error) {
    console.warn('[LK Lab] sample unavailable:', entry.path, error);
  }
}

async function ensureSamples() {
  await Promise.all(SAMPLE_SOURCES.map(loadSample));
}

function handleFiles(fileList) {
  const files = Array.from(fileList || []).filter((file) => /^image\//i.test(file.type));
  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => addPhoto(makePhoto(image, uid('photo'), file.name.replace(/\.[^.]+$/, '')));
      image.onerror = () => console.warn('[LK Lab] skipped unreadable image:', file.name);
      image.src = String(reader.result);
    };
    reader.onerror = () => console.warn('[LK Lab] FileReader failed for:', file.name);
    reader.readAsDataURL(file);
  });
}

/* Auto-fill: hand the strongest subject to the centre duo, then deal the
   remaining photographs round-robin into the four satellite panels. */
function autoFill() {
  if (!state.photos.length) return;
  const ordered = state.photos.slice().sort((a, b) => b.focus.confidence - a.focus.confidence);
  const centre = ordered[0];
  const rest = ordered.slice(1);

  state.panels.forEach((panel, index) => {
    const source = index === 0 ? centre : rest[(index - 1) % rest.length] || ordered[index % ordered.length];
    panel.photoId = source ? source.id : null;
    panel.zoom = 1 + (index === 0 ? 0.04 : 0);
    panel.x = 0;
    panel.y = 0;
    panel.autoCrop = true;
  });

  populateSourceSelects();
  syncControls();
  render();
}

/* ------------------------------------------------------------------ *
 * crops + render configuration
 * ------------------------------------------------------------------ */

function computeCrop(photo, rect, panelState) {
  const iw = photo.width || 1;
  const ih = photo.height || 1;
  const pw = Math.max(1, rect.w);
  const ph = Math.max(1, rect.h);
  const targetAspect = pw / ph;

  let sw = iw;
  let sh = iw / targetAspect;
  if (sh > ih) {
    sh = ih;
    sw = ih * targetAspect;
  }

  const zoom = clamp(Number(panelState.zoom) || 1, 1, 4);
  sw = Math.max(1, sw / zoom);
  sh = Math.max(1, sh / zoom);

  const slackX = Math.max(0, iw - sw);
  const slackY = Math.max(0, ih - sh);
  const nudgeX = (clamp(Number(panelState.x) || 0, -1, 1) * slackX) / 2;
  const nudgeY = (clamp(Number(panelState.y) || 0, -1, 1) * slackY) / 2;

  let sx = slackX / 2;
  let sy = slackY / 2;

  if (panelState.autoCrop) {
    const fx = clamp(photo.focus.x, 0, 1);
    const fy = clamp(photo.focus.y, 0, 1);
    sx = fx * iw - sw / 2 + nudgeX * 0.6;
    sy = fy * ih - sh / 2 + nudgeY * 0.6;
  } else {
    sx += nudgeX;
    sy += nudgeY;
  }

  return {
    sx: clamp(sx, 0, slackX),
    sy: clamp(sy, 0, slackY),
    sw,
    sh
  };
}

function getGradeConfig() {
  const fromModule = safeCall(getGrade, state.grade);
  if (fromModule && fromModule.ink) return fromModule;
  return LOCAL_GRADES[state.grade] || LOCAL_GRADES.sunset;
}

function buildConfig(width, height) {
  const grade = getGradeConfig();
  const palette = PALETTE && PALETTE.cream ? PALETTE : LOCAL_PALETTE;

  let rects = safeCall(resolvePanels, PANEL_LAYOUT, width, height);
  if (!Array.isArray(rects) || rects.length !== PANEL_LAYOUT.length) {
    rects = PANEL_LAYOUT.map((panel) => ({
      id: panel.id,
      label: panel.label,
      duo: panel.duo,
      x: panel.x * width,
      y: panel.y * height,
      w: panel.w * width,
      h: panel.h * height
    }));
  }

  const panels = rects.map((rect, index) => {
    const control = state.panels[index] || freshPanel();
    const photo = state.photos.find((item) => item.id === control.photoId) || null;
    return {
      ...rect,
      index,
      image: photo ? photo.image : null,
      crop: photo ? computeCrop(photo, rect, control) : null,
      zoom: control.zoom,
      x: control.x,
      y: control.y,
      autoCrop: control.autoCrop
    };
  });

  let titleZone = safeCall(getTitleZone, width, height);
  if (!titleZone || !Number.isFinite(titleZone.x)) {
    titleZone = {
      x: width * 0.045,
      y: height * 0.605,
      w: width * 0.910,
      h: height * 0.330
    };
  }

  return {
    width,
    height,
    grade,
    palette,
    panels,
    title: state.title || 'COPPER HALO',
    tagline: state.tagline || 'EVERY EMPIRE HAS A PRICE',
    badge: state.badge || 'LK-01',
    titleZone,
    layout: PANEL_LAYOUT
  };
}

const fx = {
  applyHalftone: (...args) => safeCall(applyHalftone, ...args),
  applyGrain: (...args) => safeCall(applyGrain, ...args),
  applyMisregistration: (...args) => safeCall(applyMisregistration, ...args),
  posterize: (...args) => safeCall(posterize, ...args)
};

/* A self-contained safety render. It keeps the studio usable while the
   dedicated rendering modules are still being authored elsewhere. */
function drawFallback(canvas, config) {
  const ctx = canvas.getContext('2d');
  const { width: W, height: H, grade, panels, titleZone } = config;
  const ink = grade.ink.length ? grade.ink : [LOCAL_PALETTE.plum, LOCAL_PALETTE.magenta];
  const accent = grade.accent || LOCAL_PALETTE.cyan;
  const paper = grade.paper || LOCAL_PALETTE.cream;

  ctx.save();
  ctx.fillStyle = ink[0];
  ctx.fillRect(0, 0, W, H);

  panels.forEach((panel, index) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(panel.x, panel.y, panel.w, panel.h);
    ctx.clip();
    if (panel.image && panel.crop) {
      const c = panel.crop;
      ctx.drawImage(panel.image, c.sx, c.sy, c.sw, c.sh, panel.x, panel.y, panel.w, panel.h);
    } else {
      ctx.fillStyle = ink[1 + (index % Math.max(1, ink.length - 1))];
      ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    }
    ctx.restore();

    ctx.strokeStyle = panel.duo ? accent : ink[Math.min(2, ink.length - 1)];
    ctx.lineWidth = Math.max(2, W * 0.0035);
    ctx.strokeRect(panel.x, panel.y, panel.w, panel.h);
  });

  ctx.fillStyle = ink[0];
  ctx.fillRect(titleZone.x, titleZone.y, titleZone.w, titleZone.h);
  ctx.fillStyle = accent;
  ctx.fillRect(titleZone.x, titleZone.y, titleZone.w, Math.max(2, H * 0.0035));

  const titleSize = Math.min(titleZone.h * 0.40, titleZone.w / (Math.max(4, config.title.length) * 0.60));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = paper;
  ctx.font = `900 ${titleSize}px ${DISPLAY_FONT}`;
  ctx.fillText(config.title, titleZone.x + titleZone.w / 2, titleZone.y + titleZone.h * 0.40);

  ctx.fillStyle = accent;
  ctx.font = `700 ${Math.max(10, titleSize * 0.17)}px ${UI_FONT}`;
  ctx.fillText(config.tagline, titleZone.x + titleZone.w / 2, titleZone.y + titleZone.h * 0.78);

  const badgeW = W * 0.085;
  const badgeH = H * 0.030;
  ctx.fillStyle = accent;
  ctx.fillRect(W * 0.045, H * 0.012, badgeW, badgeH);
  ctx.fillStyle = ink[0];
  ctx.font = `900 ${Math.max(9, badgeH * 0.62)}px ${DISPLAY_FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText(config.badge, W * 0.045 + badgeW * 0.10, H * 0.012 + badgeH * 0.52);
  ctx.restore();
}

function paint(canvas, config) {
  const result = safeCall(renderPoster, canvas, config, fx);
  if (result === null) drawFallback(canvas, config);
}

function render() {
  const canvas = qs('#preview');
  if (!canvas) return;
  paint(canvas, buildConfig(canvas.width, canvas.height));
  updateStatus();
}

/* ------------------------------------------------------------------ *
 * PNG export
 * ------------------------------------------------------------------ */

function triggerDownload(href, filename, revoke) {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(href), 1500);
}

function exportPNG(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas, buildConfig(width, height));

  const filename = `copper-halo-${width}x${height}.png`;
  if (typeof canvas.toBlob === 'function') {
    canvas.toBlob((blob) => {
      if (blob) triggerDownload(URL.createObjectURL(blob), filename, true);
      else triggerDownload(canvas.toDataURL('image/png'), filename, false);
    }, 'image/png');
  } else {
    triggerDownload(canvas.toDataURL('image/png'), filename, false);
  }
}

/* ------------------------------------------------------------------ *
 * controls
 * ------------------------------------------------------------------ */

function populateSourceSelects() {
  PANEL_LAYOUT.forEach((panel, index) => {
    const select = qs(`#source-${index}`);
    if (!select) return;
    select.innerHTML = '';

    const none = document.createElement('option');
    none.value = '';
    none.textContent = '— empty —';
    select.appendChild(none);

    state.photos.forEach((photo) => {
      const option = document.createElement('option');
      option.value = photo.id;
      option.textContent = photo.label;
      select.appendChild(option);
    });

    select.value = state.panels[index].photoId || '';
  });
}

function buildPanelTabs() {
  const host = qs('#panel-tabs');
  if (!host) return;
  host.innerHTML = '';
  PANEL_LAYOUT.forEach((panel, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-tab';
    button.dataset.panel = String(index);
    button.setAttribute('role', 'tab');
    button.textContent = panel.label.split(' ')[0];
    button.title = panel.label;
    button.addEventListener('click', () => {
      state.selectedPanel = index;
      syncControls();
    });
    host.appendChild(button);
  });
}

function syncControls() {
  const control = state.panels[state.selectedPanel] || freshPanel();

  qsa('.panel-tab').forEach((tab) => {
    tab.classList.toggle('is-active', Number(tab.dataset.panel) === state.selectedPanel);
  });

  const zoom = qs('#zoom');
  const posX = qs('#pos-x');
  const posY = qs('#pos-y');
  const cropToggle = qs('#auto-crop');

  if (zoom) zoom.value = String(control.zoom);
  if (posX) posX.value = String(control.x);
  if (posY) posY.value = String(control.y);
  if (cropToggle) cropToggle.checked = !!control.autoCrop;

  const zoomVal = qs('#zoom-val');
  const xVal = qs('#pos-x-val');
  const yVal = qs('#pos-y-val');
  if (zoomVal) zoomVal.textContent = `${Number(control.zoom).toFixed(2)}×`;
  if (xVal) xVal.textContent = Number(control.x).toFixed(2);
  if (yVal) yVal.textContent = Number(control.y).toFixed(2);

  const titleInput = qs('#title-input');
  const taglineInput = qs('#tagline-input');
  const badgeInput = qs('#badge-input');
  if (titleInput) titleInput.value = state.title;
  if (taglineInput) taglineInput.value = state.tagline;
  if (badgeInput) badgeInput.value = state.badge;

  qsa('.grade-btn').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.grade === state.grade);
  });
}

function updateStatus() {
  const status = qs('#status');
  if (!status) return;
  const photoCount = state.photos.length;
  const filled = state.panels.filter((panel) => panel.photoId).length;
  const preview = qs('#preview');
  status.textContent = `${photoCount} photo${photoCount === 1 ? '' : 's'} loaded · ${filled}/5 panels sourced · ${state.grade} ink · preview ${preview ? preview.width : 0}×${preview ? preview.height : 0}`;
}

function bindControls() {
  const dropZone = qs('#drop-zone');
  const fileInput = qs('#file-input');

  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    });
    ['dragenter', 'dragover'].forEach((type) => {
      dropZone.addEventListener(type, (event) => {
        event.preventDefault();
        dropZone.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach((type) => {
      dropZone.addEventListener(type, (event) => {
        event.preventDefault();
        dropZone.classList.remove('is-over');
      });
    });
    dropZone.addEventListener('drop', (event) => handleFiles(event.dataTransfer.files));
    fileInput.addEventListener('change', () => {
      handleFiles(fileInput.files);
      fileInput.value = '';
    });
  }

  SAMPLE_SOURCES.forEach((entry, index) => {
    const button = qs(`#sample-${index === 0 ? 'boulevard' : 'pier'}`);
    if (button) button.addEventListener('click', () => loadSample(entry).then(autoFill));
  });

  const autoFillButton = qs('#auto-fill');
  if (autoFillButton) autoFillButton.addEventListener('click', autoFill);

  qsa('.source-select, select[data-panel]').forEach((select) => {
    select.addEventListener('change', () => {
      const index = Number(select.dataset.panel);
      state.panels[index].photoId = select.value || null;
      render();
    });
  });

  const zoom = qs('#zoom');
  if (zoom) zoom.addEventListener('input', () => {
    state.panels[state.selectedPanel].zoom = Number(zoom.value);
    const out = qs('#zoom-val');
    if (out) out.textContent = `${Number(zoom.value).toFixed(2)}×`;
    render();
  });

  const posX = qs('#pos-x');
  if (posX) posX.addEventListener('input', () => {
    state.panels[state.selectedPanel].x = Number(posX.value);
    const out = qs('#pos-x-val');
    if (out) out.textContent = Number(posX.value).toFixed(2);
    render();
  });

  const posY = qs('#pos-y');
  if (posY) posY.addEventListener('input', () => {
    state.panels[state.selectedPanel].y = Number(posY.value);
    const out = qs('#pos-y-val');
    if (out) out.textContent = Number(posY.value).toFixed(2);
    render();
  });

  const cropToggle = qs('#auto-crop');
  if (cropToggle) cropToggle.addEventListener('change', () => {
    state.panels[state.selectedPanel].autoCrop = cropToggle.checked;
    render();
  });

  const reset = qs('#reset-panel');
  if (reset) reset.addEventListener('click', () => {
    state.panels[state.selectedPanel] = freshPanel();
    populateSourceSelects();
    syncControls();
    render();
  });

  [
    ['#title-input', 'title'],
    ['#tagline-input', 'tagline'],
    ['#badge-input', 'badge']
  ].forEach(([selector, key]) => {
    const input = qs(selector);
    if (input) input.addEventListener('input', () => {
      state[key] = input.value;
      render();
    });
  });

  qsa('.grade-btn').forEach((button) => {
    button.addEventListener('click', () => {
      state.grade = button.dataset.grade;
      syncControls();
      render();
    });
  });

  const exports = [
    ['#export-square', EXPORT_SIZES.square],
    ['#export-portrait', EXPORT_SIZES.portrait],
    ['#export-wide', EXPORT_SIZES.wide]
  ];
  exports.forEach(([selector, [width, height]]) => {
    const button = qs(selector);
    if (button) button.addEventListener('click', () => exportPNG(width, height));
  });
}

/* ------------------------------------------------------------------ *
 * query-parameter modes
 * ------------------------------------------------------------------ */

async function runCoverShot(params) {
  const requestedGrade = params.get('grade');
  if (requestedGrade && LOCAL_GRADES[requestedGrade]) state.grade = requestedGrade;

  const requestedSize = params.get('size');
  const [width, height] = EXPORT_SIZES[requestedSize] || EXPORT_SIZES.portrait;

  await ensureSamples();
  autoFill();

  document.body.classList.add('cover-mode');
  const app = qs('#app');
  const coverView = qs('#cover-view');
  const canvas = qs('#cover-canvas');
  if (app) app.hidden = true;
  if (coverView) coverView.hidden = false;
  if (canvas) {
    canvas.width = width;
    canvas.height = height;
    paint(canvas, buildConfig(width, height));
  }
}

async function boot() {
  buildPanelTabs();
  populateSourceSelects();
  bindControls();
  syncControls();

  const params = new URLSearchParams(window.location.search);
  const shot = params.get('shot');

  if (shot === 'cover') {
    await runCoverShot(params);
    return;
  }

  if (shot === 'editor') {
    await ensureSamples();
    autoFill();
  } else {
    render();
  }
}

boot();

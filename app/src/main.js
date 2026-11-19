// Leonida Key Art Lab — editor controller.
// Studio note: applyPrintFinish() in studio.js composes the finishing stages.
// Owns state, wires the DOM and hands the finished state to the canvas renderer.
// Everything is local: photos come from the user or app/samples, fonts from app/fonts.
// No runtime network request is ever made.

import { ASPECTS, SLOT_ORDER, SLOT_LABELS, DEFAULT_COPY } from './layouts.js';
import { GRADE_LIST, DEFAULT_GRADE } from './palette.js';
import { autoTransform } from './smartcrop.js';
import { renderPoster } from './render.js';
import { sizeLabel } from './archive.js';

const $ = (sel) => document.querySelector(sel);

const SAMPLES = [
  { name: 'Boulevard', url: './samples/boulevard.jpg' },
  { name: 'Pier', url: './samples/pier.jpg' },
  { name: 'Grid Sun', url: './samples/neon-coast.svg' },
];

const state = {
  sources: [],
  slots: {},
  title: DEFAULT_COPY.title,
  tagline: DEFAULT_COPY.tagline,
  badge: DEFAULT_COPY.badge,
  grade: DEFAULT_GRADE,
  finish: 0.88,
  aspect: 'portrait',
  activeSlot: 'DUOL',
};

for (const key of SLOT_ORDER) {
  state.slots[key] = { sourceId: null, zoom: 1.6, ox: 0, oy: 0 };
}

// Bundled samples occupy fixed source slots so the default collage is deterministic.
SAMPLES.forEach((s, i) => {
  state.sources.push({ id: `src-${i + 1}`, name: s.name, img: null, url: s.url });
});
let sourceSeq = SAMPLES.length;
let raf = 0;
let initialFillDone = false;
let samplesReady = false;
let fontsReady = false;
const preview = $('#preview');

// Offline capture modes. Everything still comes from app/ and every mode uses
// the very same renderPoster() call as a real PNG export:
//   ?shot=editor                         studio, three samples, caption filled
//   ?shot=cover&size=portrait&grade=sunset   1080x1350 art only
//   ?shot=cover&size=wide&grade=rain         1920x1080 art only
//   ?shot=cover&size=square&grade=ink        1080x1080 art only
// `aspect` is kept as an alias for older capture URLs; `size` is the new name.
const query = new URLSearchParams(location.search);
const shot = query.get('shot');
if (shot === 'cover' || shot === 'editor') document.body.classList.add(`shot-${shot}`);
const photoParam = query.get('photo');
const captionParam = query.get('caption');
if (captionParam) state.title = captionParam.toUpperCase().trim().slice(0, 18);
if (query.get('tagline')) state.tagline = query.get('tagline').trim().slice(0, 34);
if (query.get('badge')) state.badge = query.get('badge').trim().slice(0, 10);
const sizeParam = query.get('size') || query.get('aspect');
if (sizeParam && ASPECTS[sizeParam]) state.aspect = sizeParam;
if (GRADE_LIST.some((g) => g.id === query.get('grade'))) state.grade = query.get('grade');

function maybeShotReady() {
  if (!samplesReady || !fontsReady || !shot) return;
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__shotReady = true; }));
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}

function scheduleRender() {
  if (raf) cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    raf = 0;
    renderPreview();
  });
}

function renderPreview() {
  const cfg = ASPECTS[state.aspect];
  if (shot === 'cover') {
    // Byte-for-byte the same call exportPNG() makes: no preview highlight, no
    // reduced-size stand-in. CSS only scales this full-resolution canvas down
    // to fit the headless viewport.
    renderPoster(preview, state, { W: cfg.w, H: cfg.h });
    return;
  }
  // The studio keeps a lighter 900px canvas for lag-free editing.
  const W = 900;
  const H = Math.round((W * cfg.h) / cfg.w);
  renderPoster(preview, state, {
    W, H, preview: true, activeSlot: state.activeSlot,
  });
  $('#stage-meta').textContent = `${cfg.label} · live print preview`;
}

function addSource(img, name, url, assignTo) {
  const source = { id: `src-${++sourceSeq}`, name, img, url };
  state.sources.push(source);
  rebuildSelects();
  if (assignTo) setSlotSource(assignTo, source.id);
  else scheduleRender();
  return source;
}

function loadImage(src, onload, onerror) {
  const img = new Image();
  img.onload = () => onload(img);
  img.onerror = () => (onerror ? onerror() : toast('Could not load that image'));
  img.src = src;
}

function setSlotSource(key, sourceId) {
  const slot = state.slots[key];
  slot.sourceId = sourceId;
  if (sourceId) {
    const src = state.sources.find((s) => s.id === sourceId);
    if (src && src.img) Object.assign(slot, autoTransform(src.img));
  }
  syncPanelControls();
  scheduleRender();
}

function autoFill() {
  const ready = state.sources.filter((s) => s.img);
  if (!ready.length) {
    toast('Add a photo first');
    return;
  }
  // Photographs take the duo first; vector scenes fall into the outer panels.
  const ordered = ready.slice().sort((a, b) =>
    Number((a.url || '').toLowerCase().endsWith('.svg')) -
    Number((b.url || '').toLowerCase().endsWith('.svg')));
  const fillOrder = ['DUOL', 'DUOR', 'A', 'B', 'E', 'F'];
  fillOrder.forEach((key, i) => setSlotSource(key, ordered[i % ordered.length].id));
  toast('Panels filled face-first');
}

// A capture's `photo` param leads the centre duo while the other samples keep
// the flanks varied, so a single-parameter URL still produces a full collage.
function applyPhotoOverride() {
  if (!photoParam) return false;
  const needle = photoParam.toLowerCase();
  const lead = state.sources.find((s) => s.img &&
    (s.name.toLowerCase() === needle || (s.url || '').toLowerCase().includes(needle)));
  if (!lead) return false;
  const others = state.sources.filter((s) => s.img && s.id !== lead.id);
  setSlotSource('DUOL', lead.id);
  if (others.length) setSlotSource('DUOR', others[0].id);
  ['A', 'B', 'E', 'F'].forEach((key, i) =>
    setSlotSource(key, (others[i % others.length] || lead).id));
  return true;
}

function buildSamples() {
  const host = $('#samples');
  SAMPLES.forEach((s) => {
    const b = document.createElement('button');
    b.className = 'thumb';
    b.title = `Put ${s.name} in the selected panel`;
    const im = document.createElement('img');
    im.src = s.url;
    im.alt = s.name;
    const cap = document.createElement('span');
    cap.textContent = s.name;
    b.append(im, cap);
    b.addEventListener('click', () => {
      const existing = state.sources.find((x) => x.url === s.url);
      if (existing && existing.img) setSlotSource(state.activeSlot, existing.id);
    });
    host.appendChild(b);
  });
}

function buildPanelControls() {
  const host = $('#panel-controls');
  SLOT_ORDER.forEach((key) => {
    const row = document.createElement('div');
    row.className = 'panel-row';
    row.dataset.slot = key;

    const name = document.createElement('button');
    name.className = 'panel-name';
    name.textContent = SLOT_LABELS[key];
    name.addEventListener('click', () => {
      state.activeSlot = key;
      syncActive();
      scheduleRender();
    });

    const select = document.createElement('select');
    select.className = 'source-select';
    select.dataset.field = 'source';

    const mkRange = (field, label, min, max, step) => {
      const wrap = document.createElement('label');
      wrap.className = 'slider';
      const cap = document.createElement('span');
      cap.textContent = label;
      const input = document.createElement('input');
      input.type = 'range';
      input.dataset.field = field;
      input.min = min;
      input.max = max;
      input.step = step;
      wrap.append(cap, input);
      return wrap;
    };

    const auto = document.createElement('button');
    auto.className = 'auto-btn';
    auto.textContent = '⌖ auto';
    auto.title = 'Re-run face-aware crop (keeps faces clear of the header)';
    auto.addEventListener('click', () => {
      const src = state.sources.find((s) => s.id === state.slots[key].sourceId);
      if (!src) return toast('This panel has no photo');
      Object.assign(state.slots[key], autoTransform(src.img));
      syncPanelControls();
      scheduleRender();
    });

    row.append(name, select, mkRange('zoom', 'Zoom', 1, 3, 0.01),
      mkRange('ox', 'X', -1, 1, 0.01), mkRange('oy', 'Y', -1, 1, 0.01), auto);
    host.appendChild(row);
  });
}

function rebuildSelects() {
  document.querySelectorAll('.source-select').forEach((sel) => {
    const key = sel.closest('.panel-row').dataset.slot;
    const current = state.slots[key].sourceId;
    sel.innerHTML = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '— empty —';
    sel.appendChild(empty);
    state.sources.filter((s) => s.img).forEach((s) => {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name;
      sel.appendChild(o);
    });
    sel.value = current || '';
  });
}

function syncPanelControls() {
  document.querySelectorAll('.panel-row').forEach((row) => {
    const key = row.dataset.slot;
    const slot = state.slots[key];
    row.querySelector('[data-field="source"]').value = slot.sourceId || '';
    row.querySelector('[data-field="zoom"]').value = slot.zoom;
    row.querySelector('[data-field="ox"]').value = slot.ox;
    row.querySelector('[data-field="oy"]').value = slot.oy;
  });
}

function syncActive() {
  document.querySelectorAll('.panel-row').forEach((row) => {
    row.classList.toggle('active', row.dataset.slot === state.activeSlot);
  });
  document.querySelectorAll('#aspects button').forEach((b) => {
    b.classList.toggle('active', b.dataset.aspect === state.aspect);
  });
  document.querySelectorAll('.grade').forEach((b) => {
    b.classList.toggle('active', b.dataset.grade === state.grade);
  });
}

function buildGrades() {
  const host = $('#grades');
  GRADE_LIST.forEach((g) => {
    const b = document.createElement('button');
    b.className = 'grade';
    b.dataset.grade = g.id;
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = `linear-gradient(135deg, ${g.ramp.join(',')})`;
    const cap = document.createElement('span');
    cap.textContent = g.label;
    b.append(sw, cap);
    b.addEventListener('click', () => {
      state.grade = g.id;
      syncActive();
      scheduleRender();
    });
    host.appendChild(b);
  });
}

function handleFiles(files) {
  const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
  if (!images.length) return toast('Pick image files only');
  images.forEach((file, i) => {
    const url = URL.createObjectURL(file);
    loadImage(url, (img) => {
      const slot = SLOT_ORDER[(SLOT_ORDER.indexOf(state.activeSlot) + i) % SLOT_ORDER.length];
      addSource(img, file.name.replace(/\.[^.]+$/, '').slice(0, 22), url, slot);
    });
  });
  initialFillDone = true;
}

function exportPNG(aspect) {
  const cfg = ASPECTS[aspect];
  const canvas = document.createElement('canvas');
  // Each export uses its own exact pixel size; the layout is normalised, so the
  // composition and type scale correctly for square, poster and widescreen.
  renderPoster(canvas, state, { W: cfg.w, H: cfg.h });
  canvas.toBlob((blob) => {
    if (!blob) return toast('Export failed');
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `leonida-key-art-${cfg.w}x${cfg.h}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`Exported ${cfg.label} PNG`);
  }, 'image/png');
}

function wire() {
  buildSamples();
  buildPanelControls();
  buildGrades();

  $('#panel-controls').addEventListener('change', (e) => {
    const el = e.target;
    const row = el.closest('.panel-row');
    if (!row) return;
    const key = row.dataset.slot;
    if (el.dataset.field === 'source') setSlotSource(key, el.value || null);
  });
  $('#panel-controls').addEventListener('input', (e) => {
    const el = e.target;
    const row = el.closest('.panel-row');
    if (!row || !el.dataset.field || el.dataset.field === 'source') return;
    state.slots[row.dataset.slot][el.dataset.field] = parseFloat(el.value);
    scheduleRender();
  });

  const file = $('#file');
  const drop = $('#drop');
  drop.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    handleFiles(file.files);
    file.value = '';
  });
  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('over');
    }));
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove('over');
    }));
  drop.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));

  $('#btn-fill').addEventListener('click', autoFill);

  $('#title').value = state.title;
  $('#tagline').value = state.tagline;
  $('#badge').value = state.badge;
  // Caption edits repaint immediately (input fires on typing, paste and IME
  // commit) and the very same state is used by every PNG export.
  ['title', 'tagline', 'badge'].forEach((id) =>
    $('#' + id).addEventListener('input', (e) => {
      state[id] = e.target.value;
      renderPreview();
    }));

  $('#finish').value = Math.round(state.finish * 100);
  $('#finish').addEventListener('input', (e) => {
    state.finish = parseInt(e.target.value, 10) / 100;
    $('#finish-val').textContent = `${e.target.value}%`;
    scheduleRender();
  });

  $('#aspects').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.aspect = b.dataset.aspect;
    syncActive();
    scheduleRender();
  });

  document.querySelectorAll('[data-export]').forEach((b) =>
    b.addEventListener('click', () => exportPNG(b.dataset.export)));

  $('#btn-clear').addEventListener('click', () => {
    state.title = DEFAULT_COPY.title;
    state.tagline = DEFAULT_COPY.tagline;
    state.badge = DEFAULT_COPY.badge;
    state.grade = DEFAULT_GRADE;
    state.finish = 0.88;
    SLOT_ORDER.forEach((key) => Object.assign(state.slots[key], { zoom: 1.6, ox: 0, oy: 0 }));
    $('#title').value = state.title;
    $('#tagline').value = state.tagline;
    $('#badge').value = state.badge;
    $('#finish').value = 88;
    $('#finish-val').textContent = '88%';
    syncPanelControls();
    syncActive();
    scheduleRender();
    toast('Adjustments reset');
  });

  syncActive();
  syncPanelControls();
  renderPreview();
}

// Load the three bundled samples, then give every panel a face-first starting crop.
let pending = SAMPLES.length;
function finishLoad() {
  if (--pending > 0 || initialFillDone) return;
  rebuildSelects();
  if (shot === 'editor') {
    // Studio capture: always populate the panels from all three bundled samples
    // and commit the caption into the visible inputs before the first paint.
    autoFill();
    for (const id of ['title', 'tagline', 'badge']) $('#' + id).value = state[id];
  } else if (!applyPhotoOverride()) {
    autoFill();
  }
  samplesReady = true;
  renderPreview();
  maybeShotReady();
}
SAMPLES.forEach((s, i) => {
  loadImage(s.url, (img) => {
    state.sources[i].img = img;
    finishLoad();
  }, finishLoad);
});

wire();

// Canvas text must wait for the vendored Anton face to be ready.
if (document.fonts && document.fonts.ready) {
  Promise.all([
    document.fonts.load('400 100px "Anton"'),
    document.fonts.ready,
  ]).then(() => {
    fontsReady = true;
    renderPreview();
    maybeShotReady();
  }).catch(() => {
    fontsReady = true;
    renderPreview();
    maybeShotReady();
  });
} else {
  fontsReady = true;
  maybeShotReady();
}

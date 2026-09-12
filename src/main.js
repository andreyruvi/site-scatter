/**
 * Wiring.
 *
 * Reads the controls, owns the scheme, drives the renderer and handles the
 * exports. Everything it calls is tested on its own; this file is deliberately
 * the only part that is not, so it is kept to plumbing and contains no rules.
 */

import { createTerrain, slopeAt, heightAt, inside } from './engine/terrain.js';
import { pickGround } from './engine/raycast.js';
import { createRng } from './engine/rng.js';
import {
  SPECIES, grouped, speciesByKey, speciesLabel, withOverrides,
} from './engine/species.js';
import {
  createIndex, indexRebuild, stamp, erase, explainStroke,
} from './engine/scatter.js';
import { review } from './engine/schedule.js';
import {
  toOBJ, toMTL, toScheduleCSV, toInstancesCSV, toPreset, fromPreset, slug,
} from './engine/exporters.js';
import {
  createCamera, matrices, rayThrough, orbit, zoom, pan, frameSite, clampToSite, northOnScreen,
} from './ui/camera.js';
import { createRenderer } from './ui/renderer.js';
import { createReportView } from './ui/report.js';
import {
  downloadText, pickFile, readText, canvasToPng, saveSettings, loadSettings,
} from './ui/files.js';

// ---- The page ------------------------------------------------------------

const form = document.querySelector('[data-form]');
const canvas = document.querySelector('[data-canvas]');
const status = document.querySelector('[data-status]');
const unsupported = document.querySelector('[data-unsupported]');
const glError = document.querySelector('[data-gl-error]');
const compass = document.querySelector('[data-compass]');
const cursorReadout = document.querySelector('[data-cursor-readout]');
const pending = document.querySelector('[data-pending]');
const rebuildWarning = document.querySelector('[data-rebuild-warning]');
const speciesSelect = document.querySelector('[data-species-select]');
const view = createReportView(document.querySelector('[data-report]'));

const announce = (message) => { status.textContent = message; };

// ---- State ---------------------------------------------------------------

const state = {
  terrain: null,
  instances: [],
  index: createIndex(),
  overrides: {},
  undo: [],
  rng: createRng(1),
  strokeSeed: 1,
  painted: false,
};

const camera = createCamera({});
let renderer = null;
let frame = 0;
let brushAt = null;

const FIELDS = [
  'species', 'brush', 'density', 'mode',
  'renamed', 'minHeight', 'maxHeight', 'minSpread', 'maxSpread', 'spacing', 'maxSlope',
  'size', 'relief', 'fall', 'seed',
  'hasBuilding', 'buildingWidth', 'buildingDepth', 'buildingHeight', 'keepOut',
  'sunAzimuth', 'sunElevation', 'showSlope', 'project',
];

function field(name) {
  return form.elements.namedItem(name);
}

function value(name) {
  const node = field(name);
  if (!node) return '';
  if (node instanceof RadioNodeList || (node.length && !node.tagName)) return node.value;
  if (node.type === 'checkbox') return node.checked;
  return node.value;
}

function number(name, fallback) {
  const n = Number(value(name));
  return Number.isFinite(n) ? n : fallback;
}

function settings() {
  return {
    species: String(value('species') || 'canopy'),
    brush: number('brush', 7),
    density: number('density', 75) / 100,
    mode: String(value('mode') || 'paint'),
    size: number('size', 60),
    relief: number('relief', 4),
    fall: number('fall', 4),
    seed: number('seed', 7),
    hasBuilding: Boolean(value('hasBuilding')),
    buildingWidth: number('buildingWidth', 14),
    buildingDepth: number('buildingDepth', 10),
    buildingHeight: number('buildingHeight', 7),
    keepOut: number('keepOut', 3),
    sunAzimuth: number('sunAzimuth', 150),
    sunElevation: number('sunElevation', 45),
    showSlope: Boolean(value('showSlope')),
    project: String(value('project') || '').trim(),
  };
}

/** The live palette, with the user's edits applied. */
function palette() {
  return SPECIES.map((s) => withOverrides(s, state.overrides[s.key] || {}));
}

function speciesOf(key) {
  const base = speciesByKey(key);
  return base ? withOverrides(base, state.overrides[key] || {}) : null;
}

function selected() {
  return speciesOf(settings().species) || speciesOf('canopy');
}

// ---- The site ------------------------------------------------------------

function padFor(s) {
  if (!s.hasBuilding) return null;
  const width = Math.min(s.buildingWidth, s.size - 4);
  const depth = Math.min(s.buildingDepth, s.size - 4);
  return {
    x: (s.size - width) / 2,
    z: (s.size - depth) / 2,
    width,
    depth,
    margin: 3,
  };
}

function buildTerrain({ frame: reframe = false } = {}) {
  const s = settings();
  // Resolution follows the site so the grid stays about half a metre.
  const resolution = Math.max(32, Math.min(192, Math.round(s.size / 0.5)));
  state.terrain = createTerrain({
    size: s.size,
    resolution,
    relief: s.relief,
    gradient: s.fall,
    seed: s.seed,
    pad: padFor(s),
  });
  if (renderer) renderer.setTerrain(state.terrain, { buildingHeight: s.buildingHeight });
  // Every instance is re-seated on the new ground: it keeps its position in
  // plan and takes the new level, which is what the schedule then checks.
  for (const inst of state.instances) {
    inst.y = heightAt(state.terrain, inst.x, inst.z);
  }
  indexRebuild(state.index, state.instances);
  if (reframe) {
    frameSite(camera, state.terrain);
  } else {
    clampToSite(camera, state.terrain.size);
  }
  rebuildWarning.hidden = state.instances.length === 0;
  pushInstances();
}

function pushInstances() {
  if (renderer) renderer.setInstances(state.instances, speciesOf);
  schedule();
}

// ---- Painting ------------------------------------------------------------

function paintAt(worldX, worldZ) {
  const s = settings();
  if (s.mode === 'erase') {
    const { kept, removed } = erase(state.instances, [worldX, worldZ], s.brush);
    if (!removed.length) return false;
    state.undo.push({ kind: 'erase', removed });
    state.instances = kept;
    indexRebuild(state.index, state.instances);
    announce(`Removed ${removed.length} plant${removed.length === 1 ? '' : 's'}.`);
    return true;
  }

  const species = selected();
  const result = stamp({
    terrain: state.terrain,
    index: state.index,
    species,
    at: [worldX, worldZ],
    radius: s.brush,
    density: s.density,
    keepOut: s.hasBuilding ? s.keepOut : 0,
    rng: state.rng,
    speciesOf,
    palette: palette(),
  });

  if (result.added.length) {
    state.undo.push({ kind: 'paint', added: result.added });
    state.instances = state.instances.concat(result.added);
    pending.hidden = true;
    return true;
  }

  const why = explainStroke(result, speciesLabel(species));
  if (why) {
    pending.textContent = why;
    pending.hidden = false;
  }
  return false;
}

function undo() {
  const last = state.undo.pop();
  if (!last) {
    announce('Nothing left to undo.');
    return;
  }
  if (last.kind === 'paint') {
    const ids = new Set(last.added.map((i) => i.id));
    state.instances = state.instances.filter((i) => !ids.has(i.id));
    announce(`Undid ${last.added.length} plant${last.added.length === 1 ? '' : 's'}.`);
  } else {
    state.instances = state.instances.concat(last.removed);
    announce(`Restored ${last.removed.length} plant${last.removed.length === 1 ? '' : 's'}.`);
  }
  indexRebuild(state.index, state.instances);
  pushInstances();
  draw();
}

// ---- Pointer -------------------------------------------------------------

const pointer = {
  painting: false,
  orbiting: false,
  panning: false,
  last: [0, 0],
  lastPaint: null,
  spaceDown: false,
};

function canvasSize() {
  const rect = canvas.getBoundingClientRect();
  return { width: rect.width, height: rect.height, rect };
}

function groundUnder(event) {
  const { width, height, rect } = canvasSize();
  const ray = rayThrough(camera, event.clientX - rect.left, event.clientY - rect.top, width, height);
  if (!ray) return null;
  return pickGround(state.terrain, ray.origin, ray.dir);
}

function updateBrush(event) {
  const hit = event ? groundUnder(event) : null;
  if (hit && hit.onTerrain) {
    brushAt = [hit.point[0], hit.point[2]];
    const s = settings();
    const slope = slopeAt(state.terrain, brushAt[0], brushAt[1]);
    const onSite = inside(state.terrain, brushAt[0], brushAt[1]);
    cursorReadout.textContent = onSite
      ? `${brushAt[0].toFixed(1)}, ${brushAt[1].toFixed(1)} m · ${heightAt(state.terrain, brushAt[0], brushAt[1]).toFixed(2)} m level · ${slope.toFixed(0)}° slope`
      : 'outside the site';
    if (renderer) renderer.setBrush(brushAt, s.brush);
  } else {
    brushAt = null;
    cursorReadout.textContent = '';
    if (renderer) renderer.setBrush(null, 0);
  }
}

canvas.addEventListener('contextmenu', (event) => event.preventDefault());

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId);
  pointer.last = [event.clientX, event.clientY];
  const orbitButton = event.button === 2 || pointer.spaceDown || event.shiftKey;
  const panButton = event.button === 1 || (event.button === 0 && event.altKey);

  if (panButton) {
    pointer.panning = true;
  } else if (orbitButton) {
    pointer.orbiting = true;
  } else if (event.button === 0) {
    pointer.painting = true;
    pointer.lastPaint = null;
    const hit = groundUnder(event);
    if (hit && hit.onTerrain) {
      if (paintAt(hit.point[0], hit.point[2])) {
        pointer.lastPaint = [hit.point[0], hit.point[2]];
        state.painted = true;
        pushInstances();
      }
    }
  }
  draw();
});

canvas.addEventListener('pointermove', (event) => {
  const dx = event.clientX - pointer.last[0];
  const dy = event.clientY - pointer.last[1];
  pointer.last = [event.clientX, event.clientY];

  if (pointer.orbiting) {
    orbit(camera, dx, dy);
    updateBrush(event);
    draw();
    return;
  }
  if (pointer.panning) {
    const { width, height } = canvasSize();
    pan(camera, dx, dy, width, height);
    clampToSite(camera, state.terrain.size);
    updateBrush(event);
    draw();
    return;
  }

  updateBrush(event);

  if (pointer.painting && brushAt) {
    const s = settings();
    // Stamp along the drag rather than only where the pointer events land, so
    // a fast stroke does not come out as a dotted line.
    const step = Math.max(0.5, s.brush * 0.45);
    const from = pointer.lastPaint;
    let changed = false;
    if (!from) {
      changed = paintAt(brushAt[0], brushAt[1]);
      pointer.lastPaint = [...brushAt];
    } else {
      const distance = Math.hypot(brushAt[0] - from[0], brushAt[1] - from[1]);
      const steps = Math.min(24, Math.floor(distance / step));
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        if (paintAt(from[0] + (brushAt[0] - from[0]) * t, from[1] + (brushAt[1] - from[1]) * t)) {
          changed = true;
        }
      }
      if (steps > 0) pointer.lastPaint = [...brushAt];
    }
    if (changed) {
      state.painted = true;
      pushInstances();
    }
  }
  draw();
});

const endPointer = () => {
  pointer.painting = false;
  pointer.orbiting = false;
  pointer.panning = false;
  pointer.lastPaint = null;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => {
  endPointer();
  updateBrush(null);
  draw();
});

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  zoom(camera, event.deltaY > 0 ? 1.12 : 1 / 1.12);
  draw();
}, { passive: false });

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space') pointer.spaceDown = true;
  const typing = event.target instanceof HTMLInputElement
    || event.target instanceof HTMLSelectElement
    || event.target instanceof HTMLTextAreaElement;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !typing) {
    event.preventDefault();
    undo();
  }
});
window.addEventListener('keyup', (event) => {
  if (event.code === 'Space') pointer.spaceDown = false;
});

// ---- Drawing -------------------------------------------------------------

function draw() {
  if (!renderer || frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const { width, height } = canvasSize();
    renderer.resize(width, height, window.devicePixelRatio || 1);
    const s = settings();
    renderer.render(matrices(camera, width, height), {
      sunAzimuth: s.sunAzimuth,
      sunElevation: s.sunElevation,
      slopeLimit: selected().maxSlope,
      showSlope: s.showSlope,
    });
    compass.style.setProperty('--bearing', `${northOnScreen(camera)}deg`);
    const error = renderer.lastError();
    if (error) {
      glError.textContent = `The graphics driver reported ${error}. The view may be incomplete.`;
      glError.hidden = false;
    }
  });
}

// ---- The report ----------------------------------------------------------

function schedule() {
  const s = settings();
  const result = review({
    terrain: state.terrain,
    instances: state.instances,
    speciesOf,
    keepOut: s.hasBuilding ? s.keepOut : 0,
  });
  view.render(result);
  document.body.dataset.state = result.summary.worst;
  return result;
}

// ---- The palette editor -------------------------------------------------

function fillSpeciesSelect() {
  const groups = grouped(state.overrides);
  speciesSelect.replaceChildren(...groups
    .filter((g) => g.species.length)
    .map((g) => {
      const group = document.createElement('optgroup');
      group.label = g.label;
      for (const s of g.species) {
        const option = document.createElement('option');
        option.value = s.key;
        option.textContent = speciesLabel(s);
        group.append(option);
      }
      return group;
    }));
}

/** Load the selected type's numbers into the editor. */
function showTypeEditor() {
  const s = selected();
  const set = (name, v) => {
    const node = field(name);
    if (node) node.value = v;
  };
  set('renamed', s.renamed || '');
  set('minHeight', s.height[0]);
  set('maxHeight', s.height[1]);
  set('minSpread', s.spread[0]);
  set('maxSpread', s.spread[1]);
  set('spacing', s.spacing);
  set('maxSlope', s.maxSlope);
}

/** Take the editor's numbers into the overrides for the selected type. */
function readTypeEditor() {
  const key = settings().species;
  state.overrides[key] = {
    renamed: String(value('renamed') || ''),
    minHeight: number('minHeight', undefined),
    maxHeight: number('maxHeight', undefined),
    minSpread: number('minSpread', undefined),
    maxSpread: number('maxSpread', undefined),
    spacing: number('spacing', undefined),
    maxSlope: number('maxSlope', undefined),
  };
  const label = speciesLabel(speciesOf(key));
  const option = [...speciesSelect.options].find((o) => o.value === key);
  if (option) option.textContent = label;
}

// ---- Actions -------------------------------------------------------------

function meta() {
  return { project: settings().project, date: new Date().toISOString().slice(0, 10) };
}

function stem(suffix) {
  const project = slug(settings().project, '');
  return project ? `${project}-${suffix}` : `site-scatter-${suffix}`;
}

function siteModel() {
  const s = settings();
  return {
    terrain: state.terrain,
    instances: state.instances,
    speciesOf,
    keepOut: s.hasBuilding ? s.keepOut : 0,
    settings: s,
    overrides: state.overrides,
    date: meta().date,
  };
}

const actions = {
  frame() {
    frameSite(camera, state.terrain);
    draw();
    announce('Framed the whole site.');
  },

  reseed() {
    const node = field('seed');
    if (node) node.value = String(Math.floor(Math.random() * 999999));
    buildTerrain();
    draw();
    announce('New ground. The planting stayed where it is in plan.');
  },

  rebuild() {
    buildTerrain({ frame: true });
    draw();
    announce('Site rebuilt.');
  },

  'clear-planting'() {
    if (!state.instances.length) {
      announce('There is no planting to clear.');
      return;
    }
    state.undo.push({ kind: 'erase', removed: state.instances });
    state.instances = [];
    indexRebuild(state.index, state.instances);
    pending.hidden = true;
    pushInstances();
    draw();
    announce('Cleared the planting. Ctrl+Z puts it back.');
  },

  'reset-type'() {
    const key = settings().species;
    delete state.overrides[key];
    fillSpeciesSelect();
    const node = field('species');
    if (node) node.value = key;
    showTypeEditor();
    pushInstances();
    draw();
    announce(`${speciesLabel(selected())} reset to its defaults.`);
  },

  example() {
    loadExample();
  },

  'export-obj'() {
    const site = siteModel();
    const base = stem('site');
    downloadText(`${base}.mtl`, toMTL(site), 'text/plain;charset=utf-8');
    downloadText(`${base}.obj`, toOBJ(site, {
      mtllib: `${base}.mtl`,
      buildingHeight: settings().buildingHeight,
      project: settings().project,
    }), 'text/plain;charset=utf-8');
    announce(`Saved ${base}.obj and ${base}.mtl. Keep them in the same folder so the colours come through.`);
  },

  'export-schedule'() {
    const name = `${stem('planting-schedule')}.csv`;
    downloadText(name, toScheduleCSV(siteModel(), meta()), 'text/csv;charset=utf-8');
    announce(`Saved ${name}.`);
  },

  'export-instances'() {
    const name = `${stem('planting-positions')}.csv`;
    downloadText(name, toInstancesCSV(siteModel(), meta()), 'text/csv;charset=utf-8');
    announce(`Saved ${name}.`);
  },

  async 'export-png'() {
    // Drawn immediately before capture: the backing store is only guaranteed
    // to hold the last frame, and a stale one would save the wrong view.
    const { width, height } = canvasSize();
    renderer.resize(width, height, window.devicePixelRatio || 1);
    const s = settings();
    renderer.render(matrices(camera, width, height), {
      sunAzimuth: s.sunAzimuth,
      sunElevation: s.sunElevation,
      slopeLimit: selected().maxSlope,
      showSlope: s.showSlope,
    });
    const name = `${stem('view')}.png`;
    try {
      await canvasToPng(canvas, name);
      announce(`Saved ${name}.`);
    } catch (error) {
      announce(error.message);
    }
  },

  'save-preset'() {
    const name = `${stem('scheme')}.json`;
    downloadText(name, toPreset(siteModel(), meta()), 'application/json');
    announce(`Saved ${name}. Open it to get this scheme back exactly.`);
  },

  async 'load-preset'() {
    const files = await pickFile('.json,application/json');
    if (!files.length) return;
    let text;
    try {
      text = await readText(files[0]);
    } catch (error) {
      announce(error.message);
      return;
    }
    const parsed = fromPreset(text);
    if (!parsed.ok) {
      announce(parsed.error);
      return;
    }
    applyPreset(parsed.data);
    announce(`Opened ${files[0].name}: ${parsed.data.instances.length} plants.`);
  },
};

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = actions[button.dataset.action];
  if (!action) return;
  event.preventDefault();
  action();
});

// ---- Presets and the example --------------------------------------------

function applyPreset(data) {
  const set = (name, v) => {
    const node = field(name);
    if (!node) return;
    if (node.type === 'checkbox') node.checked = Boolean(v);
    else node.value = v;
  };
  const t = data.terrain;
  set('size', t.size ?? 60);
  set('relief', t.relief ?? 4);
  set('fall', t.gradient ?? 4);
  set('seed', t.seed ?? 7);
  set('hasBuilding', Boolean(t.pad));
  if (t.pad) {
    set('buildingWidth', t.pad.width);
    set('buildingDepth', t.pad.depth);
  }
  set('project', data.project || '');
  for (const [name, v] of Object.entries(data.settings || {})) {
    if (!FIELDS.includes(name)) continue;
    if (name === 'density') set('density', Math.round(v * 100));
    else set(name, v);
  }

  state.overrides = data.overrides || {};
  fillSpeciesSelect();
  set('species', data.settings?.species || 'canopy');
  showTypeEditor();

  buildTerrain({ frame: true });
  state.instances = data.instances.map((i) => ({
    ...i,
    y: heightAt(state.terrain, i.x, i.z),
  }));
  indexRebuild(state.index, state.instances);
  state.undo = [];
  pending.hidden = true;
  pushInstances();
  draw();
}

/**
 * A worked example: a plot with a building, a drive, a lawn edge and a mixed
 * planting — including a bank too steep for canopy trees, so the schedule has
 * something real to say.
 */
function loadExample() {
  const set = (name, v) => {
    const node = field(name);
    if (!node) return;
    if (node.type === 'checkbox') node.checked = Boolean(v);
    else node.value = v;
  };
  set('size', 60);
  set('relief', 5);
  set('fall', 7);
  set('seed', 20260912);
  set('hasBuilding', true);
  set('buildingWidth', 16);
  set('buildingDepth', 11);
  set('buildingHeight', 8);
  set('keepOut', 3);
  set('project', 'Example plot');
  state.overrides = {};
  fillSpeciesSelect();

  buildTerrain({ frame: true });
  state.instances = [];
  indexRebuild(state.index, state.instances);
  state.undo = [];
  pending.hidden = true;

  const rng = createRng(4242);
  const strokes = [
    ['canopy', [12, 12], 11, 0.8],
    ['canopy', [48, 14], 9, 0.7],
    ['conifer', [50, 46], 8, 0.8],
    ['ornamental', [14, 46], 7, 0.8],
    ['columnar', [30, 5], 4, 1.0],
    ['shrub', [10, 30], 7, 0.9],
    ['shrub', [50, 30], 6, 0.9],
    ['hedge', [30, 56], 3.5, 1.0],
    ['ground', [22, 40], 6, 0.9],
    ['ground', [40, 40], 6, 0.9],
    // Hard up against the building on the graded platform margin: paving needs
    // near-level ground, and the example's plot falls at 7%.
    ['paving', [30, 37], 3.5, 1.0],
    ['gravel', [21, 22], 3.5, 0.9],
  ];
  const live = palette();
  for (const [key, at, radius, density] of strokes) {
    const species = speciesOf(key);
    const result = stamp({
      terrain: state.terrain,
      index: state.index,
      species,
      at,
      radius,
      density,
      keepOut: 3,
      rng,
      speciesOf,
      palette: live,
    });
    state.instances = state.instances.concat(result.added);
  }
  indexRebuild(state.index, state.instances);
  showTypeEditor();
  pushInstances();
  draw();
  const paved = state.instances.filter((i) => speciesOf(i.key)?.category === 'hard').length;
  announce(`Loaded an example scheme: ${state.instances.length} plants on a plot falling at 7%. `
    + `Notice how little hard landscape went down (${paved} pieces) — paving will not go on ground `
    + 'steeper than 8°, so on this slope it only takes on the levelled platform around the building. '
    + 'That is the tool telling you where you would need to terrace.');
}

// ---- Form plumbing ------------------------------------------------------

const TYPE_FIELDS = ['renamed', 'minHeight', 'maxHeight', 'minSpread', 'maxSpread', 'spacing', 'maxSlope'];
const SITE_FIELDS = ['size', 'relief', 'fall', 'seed', 'hasBuilding', 'buildingWidth', 'buildingDepth', 'buildingHeight'];

function updateReadouts() {
  const s = settings();
  const readout = (name, text) => {
    const node = document.querySelector(`[data-readout="${name}"]`);
    if (node) node.textContent = text;
  };
  readout('brush', `${s.brush} m`);
  readout('density', `${Math.round(s.density * 100)}%`);
  readout('sunAzimuth', `${s.sunAzimuth}°`);
  readout('sunElevation', `${s.sunElevation}°`);
}

let siteTimer = 0;

form.addEventListener('input', (event) => {
  const name = event.target?.name;
  updateReadouts();

  if (name === 'species') {
    showTypeEditor();
    pending.hidden = true;
  } else if (TYPE_FIELDS.includes(name)) {
    readTypeEditor();
    pushInstances();
  } else if (SITE_FIELDS.includes(name)) {
    // Debounced: dragging a number field would otherwise rebuild the whole
    // heightfield on every keystroke.
    clearTimeout(siteTimer);
    siteTimer = setTimeout(() => {
      buildTerrain();
      draw();
    }, 250);
  } else if (name === 'keepOut') {
    schedule();
  }

  if (name === 'brush' && brushAt && renderer) renderer.setBrush(brushAt, settings().brush);
  saveSettings({ ...settings(), overrides: state.overrides });
  draw();
});

form.addEventListener('change', () => {
  updateReadouts();
  draw();
});
form.addEventListener('submit', (event) => event.preventDefault());

const matchTheme = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  if (renderer) renderer.setPalette(matchTheme.matches ? 'dark' : 'light');
  draw();
}
matchTheme.addEventListener('change', applyTheme);

window.addEventListener('resize', draw);

// ---- Start ---------------------------------------------------------------

function restore() {
  const saved = loadSettings();
  if (!saved) return;
  for (const [name, v] of Object.entries(saved)) {
    if (name === 'overrides') {
      state.overrides = v && typeof v === 'object' ? v : {};
      continue;
    }
    if (!FIELDS.includes(name)) continue;
    const node = field(name);
    if (!node || !node.type) continue;
    if (node.type === 'checkbox') node.checked = Boolean(v);
    else if (name === 'density') node.value = Math.round(v * 100);
    else node.value = v;
  }
}

restore();
fillSpeciesSelect();
const initial = field('species');
if (initial && state.overrides && settings().species) initial.value = settings().species;
showTypeEditor();
updateReadouts();

renderer = createRenderer(canvas);
if (!renderer) {
  unsupported.hidden = false;
  canvas.hidden = true;
  buildTerrain({ frame: true });
  announce('WebGL 2 is not available, so there is nothing to paint on.');
} else {
  applyTheme();
  buildTerrain({ frame: true });
  draw();
  announce('Pick a planting type and drag on the ground. Right-drag to orbit, scroll to zoom.');
}

/**
 * Getting the scheme out of the browser.
 *
 * Four formats, because the scheme has four destinations:
 *
 * - **OBJ + MTL** — the site model, into Lumion, 3ds Max, SketchUp or Blender.
 *   One group per planting type so each can be selected and swapped for real
 *   assets in one go, which is what actually happens in a render pipeline.
 * - **The planting schedule, as CSV** — the table that goes on the drawing.
 * - **The instance positions, as CSV** — every plant with its coordinates, for
 *   placing real assets by script, or for a Dynamo graph in Revit.
 * - **A preset, as JSON** — so the scheme can be reopened and rebuilt exactly.
 *
 * Coordinates are metres, +Y up, +Z south, origin at the site's south-west
 * corner. That is stated in the OBJ header rather than left to be discovered
 * by importing it upside down.
 */

import { terrainMesh, siteArea } from './terrain.js';
import { speciesLabel } from './species.js';
import { buildForm, buildingMesh, instanceMatrix } from './geometry.js';
import { summarise } from './schedule.js';

/** Three decimals is a tenth of a millimetre, and -0 is normalised away. */
export function round(value) {
  const r = Math.round(value * 1000) / 1000;
  return r === 0 ? 0 : r;
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const toRows = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

/** A name safe as an OBJ group and an MTL material. */
export function objName(text, fallback = 'group') {
  const cleaned = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return cleaned || fallback;
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return [0.5, 0.5, 0.5];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Apply a column-major 4x4 to a point. */
function apply(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** Apply the rotation/scale part to a normal, then renormalise. */
function applyDir(m, x, y, z) {
  const nx = m[0] * x + m[4] * y + m[8] * z;
  const ny = m[1] * x + m[5] * y + m[9] * z;
  const nz = m[2] * x + m[6] * y + m[10] * z;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/**
 * The site as a Wavefront OBJ.
 *
 * @param {object} site
 * @param {object} options
 * @param {string} options.mtllib      name of the companion .mtl
 * @param {number} options.buildingHeight
 * @param {boolean} options.includePlanting  false exports ground and building only
 */
export function toOBJ(site, {
  mtllib = 'site-scatter.mtl', buildingHeight = 7, includePlanting = true, project = '',
} = {}) {
  const { terrain, instances, speciesOf } = site;
  const out = [];
  const date = (site.date || new Date().toISOString().slice(0, 10));

  out.push('# site-scatter — https://github.com/andreyruvi/site-scatter');
  if (project) out.push(`# Project: ${project}`);
  out.push(`# Exported: ${date}`);
  out.push('# Units: metres. +Y is up, +Z is south. Origin at the south-west corner of the site.');
  out.push(`# Site: ${terrain.size} x ${terrain.size} m (${Math.round(siteArea(terrain))} m2)`);
  out.push(`# Planting: ${instances.length} instances`);
  out.push('# Planting geometry is an indicative silhouette, not a plant model. One group per');
  out.push('# type, so each can be selected and swapped for a real asset in one operation.');
  out.push(`mtllib ${mtllib}`);
  out.push('');

  // OBJ indices are 1-based and global across the file.
  let vOffset = 1;
  let nOffset = 1;

  const emit = (name, material, mesh, matrix = null) => {
    out.push(`g ${name}`);
    out.push(`usemtl ${material}`);
    const { positions, normals, indices } = mesh;
    const count = positions.length / 3;
    for (let i = 0; i < count; i += 1) {
      const [x, y, z] = matrix
        ? apply(matrix, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
        : [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
      out.push(`v ${round(x)} ${round(y)} ${round(z)}`);
    }
    for (let i = 0; i < count; i += 1) {
      const [x, y, z] = matrix
        ? applyDir(matrix, normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2])
        : [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]];
      out.push(`vn ${round(x)} ${round(y)} ${round(z)}`);
    }
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] + vOffset;
      const b = indices[i + 1] + vOffset;
      const c = indices[i + 2] + vOffset;
      const an = indices[i] + nOffset;
      const bn = indices[i + 1] + nOffset;
      const cn = indices[i + 2] + nOffset;
      out.push(`f ${a}//${an} ${b}//${bn} ${c}//${cn}`);
    }
    vOffset += count;
    nOffset += count;
    out.push('');
  };

  emit('ground', 'ground', terrainMesh(terrain));

  if (terrain.pad) {
    const building = buildingMesh(terrain.pad, buildingHeight);
    if (building) emit('building', 'building', building);
  }

  if (includePlanting && instances.length) {
    // Grouped by type, and each type's instances welded into one group so the
    // importer shows one selectable object per planting type.
    const byKey = new Map();
    for (const inst of instances) {
      const list = byKey.get(inst.key);
      if (list) list.push(inst);
      else byKey.set(inst.key, [inst]);
    }
    const forms = new Map();
    for (const [key, group] of byKey) {
      const species = speciesOf(key);
      if (!species) continue;
      if (!forms.has(species.form)) forms.set(species.form, buildForm(species.form));
      const form = forms.get(species.form);
      const name = objName(speciesLabel(species), key);
      out.push(`g ${name}`);
      out.push(`usemtl ${name}`);
      const count = form.positions.length / 3;
      // Positions for every instance, then normals, then faces — so the whole
      // type is one group rather than one group per plant.
      for (const inst of group) {
        const m = instanceMatrix(inst);
        for (let i = 0; i < count; i += 1) {
          const [x, y, z] = apply(m, form.positions[i * 3], form.positions[i * 3 + 1], form.positions[i * 3 + 2]);
          out.push(`v ${round(x)} ${round(y)} ${round(z)}`);
        }
      }
      for (const inst of group) {
        const m = instanceMatrix(inst);
        for (let i = 0; i < count; i += 1) {
          const [x, y, z] = applyDir(m, form.normals[i * 3], form.normals[i * 3 + 1], form.normals[i * 3 + 2]);
          out.push(`vn ${round(x)} ${round(y)} ${round(z)}`);
        }
      }
      for (let g = 0; g < group.length; g += 1) {
        const base = vOffset + g * count;
        const nbase = nOffset + g * count;
        for (let i = 0; i < form.indices.length; i += 3) {
          const a = form.indices[i];
          const b = form.indices[i + 1];
          const c = form.indices[i + 2];
          out.push(`f ${base + a}//${nbase + a} ${base + b}//${nbase + b} ${base + c}//${nbase + c}`);
        }
      }
      vOffset += count * group.length;
      nOffset += count * group.length;
      out.push('');
    }
  }

  return out.join('\n');
}

/** The companion material library, so the OBJ imports with its colours. */
export function toMTL(site) {
  const { instances, speciesOf } = site;
  const out = ['# site-scatter materials', ''];

  const material = (name, hex, shine = 8) => {
    const [r, g, b] = hexToRgb(hex);
    out.push(`newmtl ${name}`);
    out.push('Ka 0.100 0.100 0.100');
    out.push(`Kd ${round(r)} ${round(g)} ${round(b)}`);
    out.push('Ks 0.050 0.050 0.050');
    out.push(`Ns ${shine}`);
    out.push('d 1.000');
    out.push('illum 2');
    out.push('');
  };

  material('ground', '#6f7a52');
  material('building', '#b9b4aa', 16);

  const seen = new Set();
  for (const inst of instances) {
    const species = speciesOf(inst.key);
    if (!species) continue;
    const name = objName(speciesLabel(species), inst.key);
    if (seen.has(name)) continue;
    seen.add(name);
    material(name, species.canopy);
  }

  return out.join('\n');
}

/** The schedule, as the table that goes on the drawing. */
export function toScheduleCSV(site, meta = {}) {
  const { schedule } = reviewLite(site);
  const rows = [];
  const date = meta.date || new Date().toISOString().slice(0, 10);

  if (meta.project) rows.push(['Project', meta.project]);
  rows.push(['Exported', date]);
  rows.push(['Site area (m2)', Math.round(schedule.totals.siteArea)]);
  rows.push(['Total plants', schedule.totals.plants]);
  rows.push(['Trees', schedule.totals.trees]);
  rows.push(['Canopy cover (m2)', Math.round(schedule.totals.canopyArea)]);
  rows.push(['Canopy cover (% of site)', schedule.totals.canopyPercent.toFixed(1)]);
  rows.push(['Hard landscape (m2)', Math.round(schedule.totals.hardArea)]);
  rows.push([]);

  rows.push([
    'Type', 'Category', 'Count',
    'Height min (m)', 'Height mean (m)', 'Height max (m)',
    'Spread min (m)', 'Spread mean (m)', 'Spread max (m)',
    'Spacing specified (m)', 'Closest pair (m)', 'Area covered (m2)',
  ]);

  const CATEGORY = { tree: 'Tree', shrub: 'Shrub / hedge', ground: 'Groundcover', hard: 'Hard landscape' };
  if (schedule.rows.length) {
    for (const r of schedule.rows) {
      rows.push([
        r.label,
        CATEGORY[r.category] || r.category,
        r.count,
        r.height.min.toFixed(2), r.height.mean.toFixed(2), r.height.max.toFixed(2),
        r.spread.min.toFixed(2), r.spread.mean.toFixed(2), r.spread.max.toFixed(2),
        r.spacingNominal.toFixed(2),
        r.spacingAchieved === null ? '—' : r.spacingAchieved.toFixed(2),
        Math.round(r.area),
      ]);
    }
  } else {
    rows.push(['Nothing planted', '', 0]);
  }

  rows.push([]);
  rows.push(['Heights and spreads are the sizes used in this layout, not nursery stock sizes.']);
  rows.push(['Area covered is a union of footprints, so overlapping canopies are counted once.']);
  rows.push(['No planning standard is applied. This tool does not know your local requirements.']);

  return toRows(rows);
}

/** Summarise without running the full review, which the schedule export does not need. */
function reviewLite(site) {
  return { schedule: summarise(site) };
}

/** Every plant, with its position, for scripting real assets into place. */
export function toInstancesCSV(site, meta = {}) {
  const { instances, speciesOf } = site;
  const rows = [[
    'id', 'type', 'category', 'x (m)', 'y (m)', 'z (m)',
    'height (m)', 'spread (m)', 'rotation (deg)',
  ]];
  for (const inst of instances) {
    const species = speciesOf(inst.key);
    rows.push([
      inst.id,
      species ? speciesLabel(species) : inst.key,
      species ? species.category : '',
      round(inst.x), round(inst.y), round(inst.z),
      round(inst.height), round(inst.spread),
      Math.round((inst.rot * 180) / Math.PI),
    ]);
  }
  if (instances.length === 0) rows.push(['—', 'nothing planted', '', '', '', '', '', '', '']);
  if (meta.project) {
    rows.push([]);
    rows.push([`Project: ${meta.project}`]);
  }
  rows.push([]);
  rows.push(['Metres. +Y up, +Z south, origin at the south-west corner of the site.']);
  return toRows(rows);
}

export const PRESET_VERSION = 2;

/**
 * A preset: everything needed to rebuild the scheme exactly.
 *
 * The instances are stored, not just the strokes. Re-deriving a layout from a
 * stroke history would be smaller, but it would depend on the scatter algorithm
 * never changing — and a scheme that quietly rearranges itself after an update
 * is worse than a larger file.
 */
export function toPreset(site, meta = {}) {
  const { terrain, instances, settings = {}, overrides = {} } = site;
  return JSON.stringify({
    format: 'site-scatter',
    version: PRESET_VERSION,
    saved: meta.date || new Date().toISOString().slice(0, 10),
    project: meta.project || '',
    terrain: {
      size: terrain.size,
      resolution: terrain.res,
      relief: terrain.relief,
      gradient: terrain.gradient,
      seed: terrain.seed,
      pad: terrain.pad
        ? {
          x: round(terrain.pad.x), z: round(terrain.pad.z),
          width: round(terrain.pad.width), depth: round(terrain.pad.depth),
          margin: round(terrain.pad.margin), level: round(terrain.pad.level),
        }
        : null,
    },
    settings,
    overrides,
    instances: instances.map((i) => ({
      k: i.key,
      x: round(i.x), y: round(i.y), z: round(i.z),
      h: round(i.height), s: round(i.spread),
      r: round(i.rot), l: round(i.lean || 0),
    })),
  }, null, 1);
}

/**
 * Read a preset back.
 * @returns {{ok: true, data: object} | {ok: false, error: string}}
 */
export function fromPreset(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  if (!parsed || parsed.format !== 'site-scatter') {
    return { ok: false, error: 'That is not a site-scatter preset.' };
  }
  if (!Number.isFinite(parsed.version) || parsed.version > PRESET_VERSION) {
    return { ok: false, error: `That preset was saved by a newer version (${parsed.version}) than this one understands (${PRESET_VERSION}).` };
  }
  if (!parsed.terrain || !Number.isFinite(parsed.terrain.size)) {
    return { ok: false, error: 'That preset has no site in it.' };
  }
  const instances = Array.isArray(parsed.instances) ? parsed.instances : [];
  return {
    ok: true,
    data: {
      version: parsed.version,
      project: typeof parsed.project === 'string' ? parsed.project : '',
      terrain: parsed.terrain,
      settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
      overrides: parsed.overrides && typeof parsed.overrides === 'object' ? parsed.overrides : {},
      instances: instances
        .filter((i) => i && typeof i.k === 'string' && Number.isFinite(i.x) && Number.isFinite(i.z))
        .map((i, at) => ({
          id: at + 1,
          key: i.k,
          x: i.x,
          y: Number.isFinite(i.y) ? i.y : 0,
          z: i.z,
          height: Number.isFinite(i.h) ? i.h : 1,
          spread: Number.isFinite(i.s) ? i.s : 1,
          rot: Number.isFinite(i.r) ? i.r : 0,
          lean: Number.isFinite(i.l) ? i.l : 0,
          shade: 1,
        })),
    },
  };
}

/** A filename stem that is safe everywhere. */
export function slug(text, fallback = 'site-scatter') {
  const cleaned = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return cleaned || fallback;
}

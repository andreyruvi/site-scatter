import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrain, heightAt } from '../src/engine/terrain.js';
import { createRng } from '../src/engine/rng.js';
import { speciesByKey, withOverrides } from '../src/engine/species.js';
import { createIndex, stamp, resetIds } from '../src/engine/scatter.js';
import {
  toOBJ, toMTL, toScheduleCSV, toInstancesCSV, toPreset, fromPreset,
  round, objName, slug, PRESET_VERSION,
} from '../src/engine/exporters.js';

const speciesOf = (key) => speciesByKey(key);

function site({ keys = ['canopy', 'shrub'], pad = { x: 24, z: 24, width: 12, depth: 9 } } = {}) {
  const terrain = createTerrain({ size: 60, resolution: 40, relief: 3, gradient: 2, seed: 3, pad });
  resetIds(1);
  const index = createIndex();
  const rng = createRng(11);
  const instances = [];
  // Each type in its own patch, and trees get a wide enough brush to place
  // more than a couple at 8 m spacing.
  const spots = {
    canopy: { at: [15, 15], radius: 14 },
    shrub: { at: [45, 45], radius: 9 },
    ground: { at: [14, 46], radius: 7 },
    paving: { at: [46, 14], radius: 5 },
  };
  for (const key of keys) {
    const spot = spots[key] || { at: [30, 30], radius: 8 };
    instances.push(...stamp({
      terrain,
      index,
      species: withOverrides(speciesByKey(key), {}),
      at: spot.at,
      radius: spot.radius,
      density: 0.9,
      rng,
      speciesOf,
    }).added);
  }
  return {
    terrain, instances, speciesOf, keepOut: 3, settings: { brush: 6 }, overrides: {},
  };
}

// ---- Rounding ------------------------------------------------------------

test('round keeps three decimals', () => {
  assert.equal(round(1.23456), 1.235);
  assert.equal(round(-1.23456), -1.235);
  assert.equal(round(10), 10);
});

test('round never emits negative zero', () => {
  // -0 in an OBJ is legal but some importers and every diff hate it.
  assert.equal(round(-0.0001), 0);
  assert.equal(Object.is(round(-0.0001), -0), false);
  assert.equal(Object.is(round(-0), -0), false);
});

// ---- Names ---------------------------------------------------------------

test('objName makes a safe group name', () => {
  assert.equal(objName('Large canopy tree'), 'large_canopy_tree');
  assert.equal(objName('Quercus robur (semi-mature)'), 'quercus_robur_semi_mature');
  assert.equal(objName(''), 'group');
  assert.equal(objName('   ---  ', 'fallback'), 'fallback');
  assert.ok(objName('x'.repeat(120)).length <= 48);
});

test('slug makes a safe filename stem', () => {
  assert.equal(slug('Plot 12, Nguyen Trai'), 'plot-12-nguyen-trai');
  assert.equal(slug(''), 'site-scatter');
  assert.equal(slug('', ''), '', 'an empty fallback is honoured');
});

// ---- OBJ -----------------------------------------------------------------

test('the OBJ states its units and orientation in the header', () => {
  const obj = toOBJ(site());
  assert.match(obj, /^# Units: metres\. \+Y is up, \+Z is south\./m);
  assert.match(obj, /Origin at the south-west corner/);
  assert.match(obj, /^mtllib site-scatter\.mtl$/m);
});

test('the OBJ says the planting is indicative rather than real plant models', () => {
  assert.match(toOBJ(site()), /indicative silhouette, not a plant model/);
});

test('the OBJ contains the ground, the building and one group per type', () => {
  const obj = toOBJ(site({ keys: ['canopy', 'shrub', 'paving'] }));
  const groups = [...obj.matchAll(/^g (\S+)$/gm)].map((m) => m[1]);
  assert.ok(groups.includes('ground'));
  assert.ok(groups.includes('building'));
  assert.ok(groups.includes('large_canopy_tree'));
  assert.ok(groups.includes('shrub_mass'));
  assert.ok(groups.includes('paving'));
});

test('each type is one group, not one group per plant', () => {
  const s = site({ keys: ['canopy'] });
  assert.ok(s.instances.length > 2, `only ${s.instances.length} trees`);
  const obj = toOBJ(s);
  const treeGroups = [...obj.matchAll(/^g large_canopy_tree$/gm)];
  assert.equal(treeGroups.length, 1, 'one selectable object per planting type');
});

test('every group declares a material', () => {
  const obj = toOBJ(site({ keys: ['canopy', 'paving'] }));
  const lines = obj.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith('g ')) {
      assert.match(lines[i + 1], /^usemtl \S+$/, `group ${lines[i]} has no material`);
    }
  }
});

test('every face index points at a vertex that exists', () => {
  const obj = toOBJ(site({ keys: ['canopy', 'shrub'] }));
  const vertices = (obj.match(/^v /gm) || []).length;
  const normals = (obj.match(/^vn /gm) || []).length;
  assert.ok(vertices > 100);
  assert.equal(vertices, normals, 'one normal per vertex');
  for (const m of obj.matchAll(/^f (\d+)\/\/(\d+) (\d+)\/\/(\d+) (\d+)\/\/(\d+)$/gm)) {
    for (const n of [1, 3, 5]) {
      const v = Number(m[n]);
      assert.ok(v >= 1 && v <= vertices, `face references vertex ${v} of ${vertices}`);
    }
    for (const n of [2, 4, 6]) {
      const vn = Number(m[n]);
      assert.ok(vn >= 1 && vn <= normals, `face references normal ${vn} of ${normals}`);
    }
  }
});

test('every face line parses, so no face is silently malformed', () => {
  const obj = toOBJ(site({ keys: ['canopy', 'paving'] }));
  const faces = obj.split('\n').filter((l) => l.startsWith('f '));
  assert.ok(faces.length > 100);
  for (const f of faces) {
    assert.match(f, /^f \d+\/\/\d+ \d+\/\/\d+ \d+\/\/\d+$/, `bad face: ${f}`);
  }
});

test('every vertex line is three finite numbers', () => {
  const obj = toOBJ(site());
  for (const line of obj.split('\n')) {
    if (!line.startsWith('v ') && !line.startsWith('vn ')) continue;
    const parts = line.split(' ').slice(1);
    assert.equal(parts.length, 3, `bad line: ${line}`);
    for (const p of parts) assert.ok(Number.isFinite(Number(p)), `bad number in: ${line}`);
  }
});

test('the OBJ has no negative zero anywhere in it', () => {
  assert.equal(/(^| )-0( |$)/m.test(toOBJ(site())), false);
});

test('the planting in the OBJ stands on the ground where the model says it does', () => {
  const s = site({ keys: ['canopy'] });
  const obj = toOBJ(s);
  // The lowest vertex of the tree group should be at the terrain height of
  // one of the instances, give or take the rounding.
  const lines = obj.split('\n');
  const start = lines.findIndex((l) => l === 'g large_canopy_tree');
  assert.ok(start > 0);
  let lowest = Infinity;
  for (let i = start; i < lines.length && !lines[i].startsWith('f '); i += 1) {
    if (lines[i].startsWith('v ')) lowest = Math.min(lowest, Number(lines[i].split(' ')[2]));
  }
  const groundHeights = s.instances.map((inst) => heightAt(s.terrain, inst.x, inst.z));
  assert.ok(Math.abs(lowest - Math.min(...groundHeights)) < 0.02,
    `the lowest tree vertex is ${lowest}, the lowest ground under a tree is ${Math.min(...groundHeights)}`);
});

test('no building in the model means no building in the OBJ', () => {
  const obj = toOBJ(site({ pad: null }));
  assert.equal(/^g building$/m.test(obj), false);
});

test('planting can be left out, for a bare site model', () => {
  const obj = toOBJ(site({ keys: ['canopy'] }), { includePlanting: false });
  assert.match(obj, /^g ground$/m);
  assert.equal(/^g large_canopy_tree$/m.test(obj), false);
});

test('an empty site still exports a valid ground model', () => {
  const terrain = createTerrain({ size: 40, resolution: 16, relief: 2, seed: 1 });
  const obj = toOBJ({ terrain, instances: [], speciesOf });
  assert.match(obj, /^g ground$/m);
  assert.ok((obj.match(/^f /gm) || []).length > 100);
});

test('the project name reaches the OBJ header when there is one', () => {
  assert.match(toOBJ(site(), { project: 'Plot 12' }), /^# Project: Plot 12$/m);
  assert.equal(/^# Project:/m.test(toOBJ(site())), false);
});

test('the building height is what was asked for', () => {
  const s = site();
  const obj = toOBJ(s, { buildingHeight: 12 });
  const lines = obj.split('\n');
  const start = lines.findIndex((l) => l === 'g building');
  let highest = -Infinity;
  let lowest = Infinity;
  for (let i = start; i < lines.length && !lines[i].startsWith('f '); i += 1) {
    if (lines[i].startsWith('v ')) {
      const y = Number(lines[i].split(' ')[2]);
      highest = Math.max(highest, y);
      lowest = Math.min(lowest, y);
    }
  }
  assert.ok(Math.abs((highest - lowest) - 12) < 0.01, `the building is ${highest - lowest} m tall`);
});

// ---- MTL -----------------------------------------------------------------

test('the MTL defines a material for every group the OBJ uses', () => {
  const s = site({ keys: ['canopy', 'shrub', 'paving'] });
  const obj = toOBJ(s);
  const mtl = toMTL(s);
  const used = new Set([...obj.matchAll(/^usemtl (\S+)$/gm)].map((m) => m[1]));
  const defined = new Set([...mtl.matchAll(/^newmtl (\S+)$/gm)].map((m) => m[1]));
  for (const name of used) {
    assert.ok(defined.has(name), `the OBJ uses ${name} but the MTL does not define it`);
  }
});

test('each material carries a diffuse colour in range', () => {
  const mtl = toMTL(site({ keys: ['canopy', 'paving'] }));
  const colours = [...mtl.matchAll(/^Kd ([\d.]+) ([\d.]+) ([\d.]+)$/gm)];
  assert.ok(colours.length >= 4);
  for (const c of colours) {
    for (const n of [1, 2, 3]) {
      const v = Number(c[n]);
      assert.ok(v >= 0 && v <= 1, `Kd component ${v} out of range`);
    }
  }
});

test('a renamed type carries its new name into both files', () => {
  const s = site({ keys: ['canopy'] });
  s.speciesOf = (key) => withOverrides(speciesByKey(key), key === 'canopy' ? { renamed: 'Quercus robur' } : {});
  assert.match(toOBJ(s), /^g quercus_robur$/m);
  assert.match(toMTL(s), /^newmtl quercus_robur$/m);
});

// ---- The schedule CSV ----------------------------------------------------

test('the schedule CSV opens with the site totals', () => {
  const csv = toScheduleCSV(site(), { project: 'Plot 12, Nguyen Trai', date: '2026-09-12' });
  assert.match(csv, /^Project,"Plot 12, Nguyen Trai"$/m);
  assert.match(csv, /^Exported,2026-09-12$/m);
  assert.match(csv, /^Site area \(m2\),3600$/m);
  assert.match(csv, /^Trees,\d+$/m);
  assert.match(csv, /^Canopy cover \(% of site\),[\d.]+$/m);
});

test('the schedule CSV has a header row and one row per type', () => {
  const s = site({ keys: ['canopy', 'shrub', 'ground'] });
  const csv = toScheduleCSV(s);
  const lines = csv.split('\n');
  const header = lines.findIndex((l) => l.startsWith('Type,Category,Count,'));
  assert.ok(header > 0);
  const body = lines.slice(header + 1).filter((l) => /^[A-Z][^,]*,(Tree|Shrub|Groundcover|Hard)/.test(l));
  assert.equal(body.length, 3);
});

test('the schedule CSV states what its numbers do and do not mean', () => {
  const csv = toScheduleCSV(site());
  assert.match(csv, /not nursery stock sizes/);
  assert.match(csv, /overlapping canopies are counted once/);
  assert.match(csv, /No planning standard is applied/);
});

test('the schedule CSV quotes a cell containing a comma or a quote', () => {
  const csv = toScheduleCSV(site(), { project: 'A, B "C"' });
  assert.match(csv, /^Project,"A, B ""C"""$/m);
});

test('an empty site still produces a complete schedule CSV', () => {
  const terrain = createTerrain({ size: 40, resolution: 16, relief: 1, seed: 1 });
  const csv = toScheduleCSV({ terrain, instances: [], speciesOf });
  assert.match(csv, /^Total plants,0$/m);
  assert.match(csv, /Nothing planted/);
  assert.match(csv, /No planning standard is applied/);
});

test('the schedule CSV dates itself when no date is given', () => {
  assert.match(toScheduleCSV(site()), /^Exported,\d{4}-\d{2}-\d{2}$/m);
});

// ---- The instances CSV --------------------------------------------------

test('the instances CSV has one row per plant', () => {
  const s = site({ keys: ['canopy', 'shrub'] });
  const csv = toInstancesCSV(s);
  const lines = csv.trim().split('\n');
  assert.match(lines[0], /^id,type,category,x \(m\),y \(m\),z \(m\),height \(m\),spread \(m\),rotation \(deg\)$/);
  const rows = lines.filter((l) => /^\d+,/.test(l));
  assert.equal(rows.length, s.instances.length);
});

test('the instances CSV positions match the model', () => {
  const s = site({ keys: ['canopy'] });
  const csv = toInstancesCSV(s);
  for (const inst of s.instances) {
    const row = csv.split('\n').find((l) => l.startsWith(`${inst.id},`));
    assert.ok(row, `no row for instance ${inst.id}`);
    const cells = row.split(',');
    assert.equal(Number(cells[3]), round(inst.x));
    assert.equal(Number(cells[4]), round(inst.y));
    assert.equal(Number(cells[5]), round(inst.z));
  }
});

test('the instances CSV states the coordinate system', () => {
  assert.match(toInstancesCSV(site()), /\+Y up, \+Z south, origin at the south-west corner/);
});

test('rotation is written in degrees, not radians', () => {
  const s = site({ keys: ['canopy'] });
  const csv = toInstancesCSV(s);
  for (const line of csv.split('\n')) {
    if (!/^\d+,/.test(line)) continue;
    const deg = Number(line.split(',')[8]);
    assert.ok(Number.isInteger(deg) && deg >= 0 && deg <= 360, `rotation ${deg}`);
  }
});

test('an empty site produces a header and a note, not a bare header', () => {
  const terrain = createTerrain({ size: 40, resolution: 16, relief: 1, seed: 1 });
  const csv = toInstancesCSV({ terrain, instances: [], speciesOf });
  assert.match(csv, /nothing planted/);
});

// ---- The preset ---------------------------------------------------------

test('a preset round-trips the site and every plant', () => {
  const s = site({ keys: ['canopy', 'shrub'] });
  const back = fromPreset(toPreset(s, { project: 'Plot 12', date: '2026-09-12' }));
  assert.equal(back.ok, true, back.error);
  assert.equal(back.data.project, 'Plot 12');
  assert.equal(back.data.terrain.size, 60);
  assert.equal(back.data.terrain.seed, 3);
  assert.equal(back.data.instances.length, s.instances.length);

  for (let i = 0; i < s.instances.length; i += 1) {
    const a = s.instances[i];
    const b = back.data.instances[i];
    assert.equal(b.key, a.key);
    assert.ok(Math.abs(b.x - a.x) < 0.001, `x drifted by ${Math.abs(b.x - a.x)}`);
    assert.ok(Math.abs(b.z - a.z) < 0.001);
    assert.ok(Math.abs(b.height - a.height) < 0.001);
    assert.ok(Math.abs(b.spread - a.spread) < 0.001);
    assert.ok(Math.abs(b.rot - a.rot) < 0.001);
  }
});

test('a preset round-trips the building', () => {
  const back = fromPreset(toPreset(site()));
  assert.equal(back.data.terrain.pad.x, 24);
  assert.equal(back.data.terrain.pad.width, 12);
  assert.ok(Number.isFinite(back.data.terrain.pad.level));
});

test('no building round-trips as no building', () => {
  const back = fromPreset(toPreset(site({ pad: null })));
  assert.equal(back.data.terrain.pad, null);
});

test('a preset round-trips the settings and the palette overrides', () => {
  const s = site();
  s.settings = { brush: 9, density: 0.5 };
  s.overrides = { canopy: { spacing: 11, renamed: 'Lime' } };
  const back = fromPreset(toPreset(s));
  assert.deepEqual(back.data.settings, { brush: 9, density: 0.5 });
  assert.deepEqual(back.data.overrides, { canopy: { spacing: 11, renamed: 'Lime' } });
});

test('a preset declares its format and version', () => {
  const parsed = JSON.parse(toPreset(site()));
  assert.equal(parsed.format, 'site-scatter');
  assert.equal(parsed.version, PRESET_VERSION);
  assert.match(parsed.saved, /^\d{4}-\d{2}-\d{2}$/);
});

test('a preset stores the instances, not a stroke history', () => {
  // A layout re-derived from strokes would silently rearrange itself if the
  // scatter ever changed, so the plants themselves are what gets saved.
  const parsed = JSON.parse(toPreset(site({ keys: ['canopy'] })));
  assert.ok(Array.isArray(parsed.instances));
  assert.ok(parsed.instances.length > 2);
  assert.ok('k' in parsed.instances[0] && 'x' in parsed.instances[0]);
});

test('rubbish is refused with a reason rather than half-loaded', () => {
  assert.equal(fromPreset('not json at all').ok, false);
  assert.match(fromPreset('not json at all').error, /not valid JSON/);
  assert.match(fromPreset('{"format":"something-else"}').error, /not a site-scatter preset/);
  assert.match(fromPreset('{"format":"site-scatter","version":1}').error, /no site in it/);
});

test('a preset from a newer version is refused, and says so', () => {
  const text = JSON.stringify({
    format: 'site-scatter', version: PRESET_VERSION + 5, terrain: { size: 40 },
  });
  const back = fromPreset(text);
  assert.equal(back.ok, false);
  assert.match(back.error, new RegExp(`newer version \\(${PRESET_VERSION + 5}\\)`));
});

test('a preset with a broken instance drops that one and keeps the rest', () => {
  const text = JSON.stringify({
    format: 'site-scatter',
    version: PRESET_VERSION,
    terrain: { size: 40, resolution: 32, relief: 2, gradient: 0, seed: 1, pad: null },
    instances: [
      { k: 'canopy', x: 10, y: 0, z: 10, h: 9, s: 7, r: 0 },
      { k: 'canopy', x: 'oops', z: 10 },
      { x: 20, z: 20 },
      { k: 'shrub', x: 20, y: 0, z: 20, h: 1.5, s: 1.2, r: 1 },
    ],
  });
  const back = fromPreset(text);
  assert.equal(back.ok, true);
  assert.equal(back.data.instances.length, 2);
  assert.deepEqual(back.data.instances.map((i) => i.key), ['canopy', 'shrub']);
});

test('a preset with missing optional fields loads with sensible values', () => {
  const text = JSON.stringify({
    format: 'site-scatter',
    version: PRESET_VERSION,
    terrain: { size: 40 },
    instances: [{ k: 'canopy', x: 10, z: 10 }],
  });
  const back = fromPreset(text);
  assert.equal(back.ok, true);
  const inst = back.data.instances[0];
  assert.equal(inst.y, 0);
  assert.equal(inst.height, 1);
  assert.equal(inst.rot, 0);
  assert.equal(inst.lean, 0);
  assert.deepEqual(back.data.settings, {});
});

test('instance ids are re-issued on load, so they stay unique', () => {
  const back = fromPreset(toPreset(site({ keys: ['canopy', 'shrub'] })));
  const ids = back.data.instances.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[0], 1);
});

test('a preset is small enough to keep: well under a kilobyte per plant', () => {
  const s = site({ keys: ['canopy', 'shrub', 'ground'] });
  const bytes = toPreset(s).length;
  assert.ok(bytes / s.instances.length < 200,
    `${(bytes / s.instances.length).toFixed(0)} bytes per plant`);
});

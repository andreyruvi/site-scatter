import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrain, slopeAt, heightAt } from '../src/engine/terrain.js';
import { createRng } from '../src/engine/rng.js';
import { speciesByKey, withOverrides } from '../src/engine/species.js';
import {
  createIndex, indexAdd, indexRebuild, near, stamp, erase, testPosition, resetIds, explainStroke,
} from '../src/engine/scatter.js';

const speciesOf = (key) => speciesByKey(key);
const flat = () => createTerrain({ size: 60, resolution: 48, relief: 0, gradient: 0, seed: 1 });

function paint(terrain, key, at, radius, options = {}) {
  resetIds(1);
  const index = createIndex();
  const rng = createRng(options.seed ?? 7);
  const species = withOverrides(speciesByKey(key), options.overrides || {});
  const result = stamp({
    terrain, index, species, at, radius, density: options.density ?? 1,
    keepOut: options.keepOut ?? 0, rng, speciesOf,
  });
  return { ...result, index, species };
}

// ---- The index -----------------------------------------------------------

test('the index finds what is inside the radius and nothing outside it', () => {
  const index = createIndex();
  for (const [x, z] of [[10, 10], [10.5, 10], [14, 10], [30, 30]]) {
    indexAdd(index, { id: `${x},${z}`, key: 'canopy', x, z });
  }
  assert.equal(near(index, 10, 10, 1).length, 2);
  assert.equal(near(index, 10, 10, 5).length, 3);
  assert.equal(near(index, 10, 10, 100).length, 4);
  assert.equal(near(index, 0, 0, 1).length, 0);
});

test('the index searches by true distance, not by cell', () => {
  const index = createIndex();
  // 1.4 m away diagonally, which sits in a neighbouring cell.
  indexAdd(index, { id: 'a', key: 'shrub', x: 5.9, z: 5.9 });
  assert.equal(near(index, 5, 5, 1.0).length, 0, 'outside the radius, same neighbourhood');
  assert.equal(near(index, 5, 5, 1.3).length, 1);
});

test('rebuilding the index replaces its contents', () => {
  const index = createIndex();
  indexAdd(index, { id: 'a', key: 'shrub', x: 1, z: 1 });
  indexRebuild(index, [{ id: 'b', key: 'shrub', x: 40, z: 40 }]);
  assert.equal(near(index, 1, 1, 5).length, 0);
  assert.equal(near(index, 40, 40, 5).length, 1);
});

// ---- Spacing ------------------------------------------------------------

test('nothing is planted closer than the minimum spacing', () => {
  const r = paint(flat(), 'canopy', [30, 30], 14);
  assert.ok(r.added.length > 1, `only ${r.added.length} trees placed`);
  const required = r.species.spacing;
  for (let i = 0; i < r.added.length; i += 1) {
    for (let j = i + 1; j < r.added.length; j += 1) {
      const d = Math.hypot(r.added[i].x - r.added[j].x, r.added[i].z - r.added[j].z);
      assert.ok(d >= required - 1e-9,
        `two trees ended up ${d.toFixed(2)} m apart, spacing is ${required} m`);
    }
  }
});

test('the spacing rule holds for a tight groundcover too', () => {
  const r = paint(flat(), 'ground', [30, 30], 4);
  assert.ok(r.added.length > 20, `only ${r.added.length} placed`);
  const required = r.species.spacing;
  for (let i = 0; i < r.added.length; i += 1) {
    for (let j = i + 1; j < r.added.length; j += 1) {
      const d = Math.hypot(r.added[i].x - r.added[j].x, r.added[i].z - r.added[j].z);
      assert.ok(d >= required - 1e-9, `${d.toFixed(3)} m apart, needed ${required}`);
    }
  }
});

test('a tighter spacing fits more plants into the same brush', () => {
  const wide = paint(flat(), 'canopy', [30, 30], 12, { overrides: { spacing: 8 } });
  const tight = paint(flat(), 'canopy', [30, 30], 12, { overrides: { spacing: 4 } });
  assert.ok(tight.added.length > wide.added.length,
    `${tight.added.length} at 4 m vs ${wide.added.length} at 8 m`);
});

test('painting the same spot twice does not double up', () => {
  const terrain = flat();
  resetIds(1);
  const index = createIndex();
  const rng = createRng(3);
  const species = withOverrides(speciesByKey('canopy'), {});
  const first = stamp({ terrain, index, species, at: [30, 30], radius: 10, density: 1, rng, speciesOf });
  const second = stamp({ terrain, index, species, at: [30, 30], radius: 10, density: 1, rng, speciesOf });
  assert.ok(first.added.length > 0);
  assert.ok(second.added.length < first.added.length / 2,
    `the second pass still added ${second.added.length} of ${first.added.length}`);

  const all = [...first.added, ...second.added];
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const d = Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z);
      assert.ok(d >= species.spacing - 1e-9, `${d.toFixed(2)} m apart across two passes`);
    }
  }
});

// ---- Slope --------------------------------------------------------------

test('nothing is planted on ground steeper than the type allows', () => {
  const steep = createTerrain({ size: 40, resolution: 80, relief: 16, gradient: 18, seed: 5 });
  const r = paint(steep, 'canopy', [20, 20], 18);
  for (const inst of r.added) {
    const s = slopeAt(steep, inst.x, inst.z);
    assert.ok(s <= r.species.maxSlope + 1e-6,
      `a tree landed on ${s.toFixed(1)}°, limit is ${r.species.maxSlope}°`);
  }
});

test('a steep bank rejects planting and says the slope is why', () => {
  const steep = createTerrain({ size: 40, resolution: 80, relief: 0, gradient: 70, seed: 2 });
  const r = paint(steep, 'canopy', [20, 20], 8);
  assert.equal(r.added.length, 0, 'nothing should be planted on a 35° bank');
  assert.ok(r.rejected.slope > 0, 'the slope is the reported reason');
  const message = explainStroke(r, 'Large canopy tree');
  assert.match(message, /steeper than this type allows/);
});

test('a type with a higher slope limit plants where a tree cannot', () => {
  const bank = createTerrain({ size: 40, resolution: 80, relief: 0, gradient: 55, seed: 4 });
  const trees = paint(bank, 'canopy', [20, 20], 8);
  const cover = paint(bank, 'ground', [20, 20], 8);
  assert.equal(trees.added.length, 0, 'a canopy tree will not go on a 29° bank');
  assert.ok(cover.added.length > 0, 'groundcover will');
});

// ---- The building keep-out ----------------------------------------------

test('planting keeps clear of the building by the distance given', () => {
  const terrain = createTerrain({
    size: 60, resolution: 96, relief: 2, gradient: 0, seed: 8,
    pad: { x: 20, z: 20, width: 16, depth: 12 },
  });
  const r = paint(terrain, 'canopy', [28, 26], 22, { keepOut: 4 });
  assert.ok(r.added.length > 0, 'the stroke still planted something outside the keep-out');
  for (const inst of r.added) {
    const insidePad = inst.x >= 16 && inst.x <= 40 && inst.z >= 16 && inst.z <= 36;
    assert.ok(!insidePad,
      `a tree landed at ${inst.x.toFixed(1)},${inst.z.toFixed(1)}, inside the 4 m keep-out`);
  }
  assert.ok(r.rejected.keepout > 0, 'the rejections were counted');
});

test('hard landscape is allowed right up to the building', () => {
  const terrain = createTerrain({
    size: 60, resolution: 96, relief: 1, gradient: 0, seed: 8,
    pad: { x: 20, z: 20, width: 16, depth: 12 },
  });
  const r = paint(terrain, 'paving', [28, 26], 6, { keepOut: 4 });
  assert.ok(r.added.length > 0, 'paving goes up to the wall');
  assert.equal(r.rejected.keepout, 0);
});

test('a zero keep-out plants across the pad', () => {
  const terrain = createTerrain({
    size: 60, resolution: 96, relief: 1, gradient: 0, seed: 8,
    pad: { x: 20, z: 20, width: 16, depth: 12 },
  });
  const r = paint(terrain, 'shrub', [28, 26], 5, { keepOut: 0 });
  assert.ok(r.added.some((i) => i.x > 20 && i.x < 36 && i.z > 20 && i.z < 32));
});

// ---- The site boundary ---------------------------------------------------

test('nothing is planted outside the site', () => {
  const terrain = flat();
  const r = paint(terrain, 'shrub', [1, 1], 8);
  for (const inst of r.added) {
    assert.ok(inst.x >= 0 && inst.z >= 0 && inst.x <= 60 && inst.z <= 60,
      `${inst.x.toFixed(2)},${inst.z.toFixed(2)} is off the site`);
  }
  assert.ok(r.rejected.outside > 0, 'the off-site attempts were counted');
});

// ---- What an instance carries -------------------------------------------

test('every instance sits on the ground and inside its size range', () => {
  const terrain = createTerrain({ size: 60, resolution: 96, relief: 5, gradient: 3, seed: 12 });
  const r = paint(terrain, 'ornamental', [30, 30], 16);
  assert.ok(r.added.length > 3);
  for (const inst of r.added) {
    // Re-derived from the terrain, so a stale or copied y would fail here.
    assert.ok(Math.abs(inst.y - heightAt(terrain, inst.x, inst.z)) < 1e-9, 'y is the ground height');
    assert.ok(inst.height >= r.species.height[0] && inst.height <= r.species.height[1]);
    assert.ok(inst.spread >= r.species.spread[0] && inst.spread <= r.species.spread[1]);
    assert.ok(inst.rot >= 0 && inst.rot < Math.PI * 2);
    assert.equal(inst.key, 'ornamental');
    assert.ok(Number.isInteger(inst.id));
  }
});

test('instance ids are unique across a session', () => {
  const terrain = flat();
  resetIds(1);
  const index = createIndex();
  const rng = createRng(5);
  const ids = new Set();
  for (const key of ['canopy', 'shrub', 'ground']) {
    const species = withOverrides(speciesByKey(key), {});
    const r = stamp({ terrain, index, species, at: [30, 30], radius: 8, density: 0.6, rng, speciesOf });
    for (const i of r.added) {
      assert.ok(!ids.has(i.id), `id ${i.id} was reused`);
      ids.add(i.id);
    }
  }
  assert.ok(ids.size > 10);
});

test('trees lean slightly and ground types do not', () => {
  const trees = paint(flat(), 'canopy', [30, 30], 14);
  const paving = paint(flat(), 'paving', [30, 30], 3);
  assert.ok(trees.added.some((i) => i.lean !== 0), 'trees lean');
  assert.ok(paving.added.every((i) => i.lean === 0), 'paving does not');
});

// ---- Determinism --------------------------------------------------------

test('the same seed paints the same plants in the same places', () => {
  const a = paint(flat(), 'canopy', [30, 30], 12, { seed: 99 });
  const b = paint(flat(), 'canopy', [30, 30], 12, { seed: 99 });
  assert.equal(a.added.length, b.added.length);
  assert.deepEqual(
    a.added.map((i) => [i.x, i.z, i.height]),
    b.added.map((i) => [i.x, i.z, i.height]),
  );
});

test('a different seed paints a different arrangement', () => {
  const a = paint(flat(), 'canopy', [30, 30], 12, { seed: 1 });
  const b = paint(flat(), 'canopy', [30, 30], 12, { seed: 2 });
  assert.notDeepEqual(a.added.map((i) => [i.x, i.z]), b.added.map((i) => [i.x, i.z]));
});

// ---- Density ------------------------------------------------------------

test('density scales how full the brush comes out', () => {
  const sparse = paint(flat(), 'ground', [30, 30], 5, { density: 0.15 });
  const full = paint(flat(), 'ground', [30, 30], 5, { density: 1 });
  assert.ok(full.added.length > sparse.added.length * 2,
    `${full.added.length} at full density vs ${sparse.added.length} at 0.15`);
});

test('a density of zero still places at least one plant, so a click does something', () => {
  const r = paint(flat(), 'canopy', [30, 30], 6, { density: 0 });
  assert.equal(r.added.length, 1);
});

// ---- Placement quality --------------------------------------------------

test('plants stay inside the brush', () => {
  const r = paint(flat(), 'shrub', [30, 30], 6);
  for (const inst of r.added) {
    const d = Math.hypot(inst.x - 30, inst.z - 30);
    assert.ok(d <= 6 + 1e-9, `${d.toFixed(3)} m from the brush centre, radius 6`);
  }
});

test('the brush fills its area rather than clumping at the centre', () => {
  const r = paint(flat(), 'ground', [30, 30], 6);
  const outerHalf = r.added.filter((i) => Math.hypot(i.x - 30, i.z - 30) > 6 / Math.SQRT2);
  // Half the disc's area lies beyond r/root2, so roughly half should land there.
  const share = outerHalf.length / r.added.length;
  assert.ok(share > 0.3 && share < 0.7, `${(share * 100).toFixed(0)}% landed in the outer half`);
});

// ---- Erasing ------------------------------------------------------------

test('erase removes what is under the brush and keeps the rest', () => {
  const r = paint(flat(), 'shrub', [30, 30], 10);
  const { kept, removed } = erase(r.added, [30, 30], 3);
  assert.ok(removed.length > 0);
  assert.equal(kept.length + removed.length, r.added.length);
  for (const inst of removed) assert.ok(Math.hypot(inst.x - 30, inst.z - 30) <= 3);
  for (const inst of kept) assert.ok(Math.hypot(inst.x - 30, inst.z - 30) > 3);
});

test('erase can be limited to one category', () => {
  const terrain = flat();
  resetIds(1);
  const index = createIndex();
  const rng = createRng(4);
  const all = [];
  for (const key of ['canopy', 'ground']) {
    const species = withOverrides(speciesByKey(key), {});
    all.push(...stamp({ terrain, index, species, at: [30, 30], radius: 8, density: 0.7, rng, speciesOf }).added);
  }
  const trees = all.filter((i) => i.key === 'canopy').length;
  const { kept, removed } = erase(all, [30, 30], 20, { categories: ['ground'], speciesOf });
  assert.ok(removed.length > 0);
  assert.ok(removed.every((i) => i.key === 'ground'), 'only groundcover was removed');
  assert.equal(kept.filter((i) => i.key === 'canopy').length, trees, 'every tree survived');
});

test('erase on empty ground changes nothing', () => {
  const r = paint(flat(), 'shrub', [10, 10], 4);
  const { kept, removed } = erase(r.added, [50, 50], 4);
  assert.equal(removed.length, 0);
  assert.equal(kept.length, r.added.length);
});

// ---- testPosition directly ----------------------------------------------

test('testPosition explains each refusal in a sentence a user can act on', () => {
  const terrain = createTerrain({
    size: 60, resolution: 96, relief: 0, gradient: 60, seed: 1,
    pad: { x: 20, z: 20, width: 10, depth: 10, level: 0 },
  });
  const index = createIndex();
  const canopy = withOverrides(speciesByKey('canopy'), {});

  const off = testPosition({ terrain, index, species: canopy, x: -5, z: 30, speciesOf });
  assert.equal(off.reason, 'outside');
  assert.match(off.detail, /site boundary/);

  const steep = testPosition({ terrain, index, species: canopy, x: 50, z: 50, speciesOf });
  assert.equal(steep.reason, 'slope');
  assert.match(steep.detail, /limit for this type is 25°/);

  const building = testPosition({ terrain, index, species: canopy, x: 25, z: 25, keepOut: 5, speciesOf });
  assert.equal(building.reason, 'keepout');
  assert.match(building.detail, /within 5 m of the building/);

  indexAdd(index, { id: 1, key: 'canopy', x: 25.5, z: 25 });
  const crowded = testPosition({ terrain, index, species: canopy, x: 25, z: 25, speciesOf });
  assert.equal(crowded.reason, 'spacing');
  assert.match(crowded.detail, /8\.00 m required/);
});

test('groundcover and shrubs layer under a tree, but a tree does not', () => {
  const terrain = flat();
  const index = createIndex();
  indexAdd(index, { id: 1, key: 'canopy', x: 30, z: 30 });
  const at = (key) => testPosition({
    terrain, index, species: withOverrides(speciesByKey(key), {}), x: 30.2, z: 30, speciesOf,
  }).ok;
  assert.equal(at('ground'), true, 'groundcover grows under the canopy');
  assert.equal(at('shrub'), true, 'so does an understorey shrub');
  assert.equal(at('canopy'), false, 'a second tree does not share the position');
  assert.equal(at('conifer'), false, 'nor does a tree of another type');
});

test('groundcover still respects its own spacing under a tree', () => {
  // The layering exemption must not switch off spacing within the category.
  const terrain = flat();
  const index = createIndex();
  indexAdd(index, { id: 1, key: 'canopy', x: 30, z: 30 });
  indexAdd(index, { id: 2, key: 'ground', x: 30.2, z: 30 });
  const cover = withOverrides(speciesByKey('ground'), {});
  const blocked = testPosition({ terrain, index, species: cover, x: 30.3, z: 30, speciesOf });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'spacing');
});

test('a tight type is held off a wider-spaced type it conflicts with', () => {
  // Groundcover spaces at 0.35 m and paving at 0.9 m. Searching only 0.35 m
  // would place the groundcover 0.6 m into the paving and never see it.
  const terrain = flat();
  const index = createIndex();
  indexAdd(index, { id: 1, key: 'paving', x: 30, z: 30 });
  const cover = withOverrides(speciesByKey('ground'), {});
  const blocked = testPosition({ terrain, index, species: cover, x: 30.6, z: 30, speciesOf });
  assert.equal(blocked.ok, false, 'groundcover 0.6 m from paving must be refused');
  assert.equal(blocked.reason, 'spacing');
  assert.match(blocked.detail, /0\.90 m required/);

  const clear = testPosition({ terrain, index, species: cover, x: 31.0, z: 30, speciesOf });
  assert.equal(clear.ok, true, '1.0 m clear of the paving is fine');
});

test('a stroke of groundcover keeps out of existing paving', () => {
  const terrain = flat();
  resetIds(1);
  const index = createIndex();
  const rng = createRng(6);
  const paving = withOverrides(speciesByKey('paving'), {});
  const laid = stamp({
    terrain, index, species: paving, at: [30, 30], radius: 5, density: 1, rng, speciesOf,
  }).added;
  assert.ok(laid.length > 20, `only ${laid.length} pavers laid`);

  const cover = withOverrides(speciesByKey('ground'), {});
  const planted = stamp({
    terrain, index, species: cover, at: [30, 30], radius: 5, density: 1, rng, speciesOf,
  }).added;
  for (const g of planted) {
    for (const p of laid) {
      const d = Math.hypot(g.x - p.x, g.z - p.z);
      assert.ok(d >= 0.9 - 1e-9, `groundcover landed ${d.toFixed(2)} m from a paver`);
    }
  }
});

test('planting will not go on top of paving, and paving will not go on planting', () => {
  const terrain = flat();
  const index = createIndex();
  indexAdd(index, { id: 1, key: 'paving', x: 30, z: 30 });
  const shrub = withOverrides(speciesByKey('shrub'), {});
  assert.equal(testPosition({ terrain, index, species: shrub, x: 30.2, z: 30, speciesOf }).ok, false);

  const index2 = createIndex();
  indexAdd(index2, { id: 2, key: 'shrub', x: 30, z: 30 });
  const paving = withOverrides(speciesByKey('paving'), {});
  assert.equal(testPosition({ terrain, index: index2, species: paving, x: 30.2, z: 30, speciesOf }).ok, false);
});

// ---- explainStroke ------------------------------------------------------

test('explainStroke says nothing when the stroke worked', () => {
  const r = paint(flat(), 'shrub', [30, 30], 6);
  assert.equal(explainStroke(r, 'Shrub mass'), null);
});

test('explainStroke reports the commonest reason, not the first', () => {
  const result = { added: [], rejected: { slope: 2, spacing: 40, keepout: 1, outside: 0 } };
  assert.match(explainStroke(result, 'Shrub mass'), /already planted at the minimum spacing/);
});

test('explainStroke stays quiet when there is nothing to explain', () => {
  assert.equal(explainStroke({ added: [], rejected: {} }, 'Shrub mass'), null);
});

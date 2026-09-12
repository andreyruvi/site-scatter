import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTerrain, levelPad, heightAt, normalAt, slopeAt, slopePercentAt,
  onPad, inside, terrainMesh, siteArea, MAX_RESOLUTION,
} from '../src/engine/terrain.js';

const flat = () => createTerrain({ size: 40, resolution: 32, relief: 0, gradient: 0, seed: 1 });

test('a site with no relief and no gradient is dead level', () => {
  const t = flat();
  for (const [x, z] of [[0, 0], [20, 20], [40, 40], [7.3, 31.9]]) {
    assert.ok(Math.abs(heightAt(t, x, z)) < 1e-9, `height at ${x},${z} was ${heightAt(t, x, z)}`);
  }
  assert.ok(Math.abs(slopeAt(t, 20, 20)) < 1e-6);
});

test('level ground has an upward normal', () => {
  const n = normalAt(flat(), 20, 20);
  assert.ok(Math.abs(n[0]) < 1e-9);
  assert.ok(Math.abs(n[2]) < 1e-9);
  assert.ok(Math.abs(n[1] - 1) < 1e-9);
  assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-9, 'the normal is a unit vector');
});

test('a gradient produces the slope it says it does', () => {
  // 10% fall across the site, no noise: the slope should read 10%.
  const t = createTerrain({ size: 50, resolution: 50, relief: 0, gradient: 10, seed: 1 });
  assert.ok(Math.abs(slopePercentAt(t, 25, 25) - 10) < 0.2, `${slopePercentAt(t, 25, 25)}%`);
  assert.ok(Math.abs(slopeAt(t, 25, 25) - 5.71) < 0.2, `${slopeAt(t, 25, 25)}°`);
});

test('the gradient falls in +Z, so the far edge is higher', () => {
  const t = createTerrain({ size: 50, resolution: 50, relief: 0, gradient: 10, seed: 1 });
  assert.ok(heightAt(t, 25, 50) > heightAt(t, 25, 0));
});

test('relief produces height variation, and roughly the amount asked for', () => {
  const t = createTerrain({ size: 60, resolution: 96, relief: 6, gradient: 0, seed: 5 });
  const range = t.highest - t.lowest;
  assert.ok(range > 1.5, `range was only ${range.toFixed(2)} m`);
  assert.ok(range <= 6.5, `range was ${range.toFixed(2)} m, more than the 6 m asked for`);
});

test('relief of zero means a perfectly repeatable flat site', () => {
  const a = flat();
  const b = flat();
  assert.deepEqual([...a.heights], [...b.heights]);
});

test('the same seed rebuilds the same ground', () => {
  const a = createTerrain({ size: 60, resolution: 48, relief: 5, gradient: 3, seed: 1234 });
  const b = createTerrain({ size: 60, resolution: 48, relief: 5, gradient: 3, seed: 1234 });
  assert.deepEqual([...a.heights], [...b.heights]);
});

test('a different seed gives different ground', () => {
  const a = createTerrain({ size: 60, resolution: 48, relief: 5, gradient: 3, seed: 1 });
  const b = createTerrain({ size: 60, resolution: 48, relief: 5, gradient: 3, seed: 2 });
  assert.notDeepEqual([...a.heights], [...b.heights]);
});

test('resolution is clamped to something a browser can draw', () => {
  assert.equal(createTerrain({ resolution: 4 }).res, 8);
  assert.equal(createTerrain({ resolution: 10000 }).res, MAX_RESOLUTION);
  assert.equal(createTerrain({ resolution: 48.6 }).res, 49, 'a fractional resolution rounds');
});

test('heightAt clamps outside the site instead of reading past the array', () => {
  const t = createTerrain({ size: 40, resolution: 32, relief: 4, seed: 3 });
  for (const [x, z] of [[-50, -50], [999, 999], [-1, 20], [20, 999]]) {
    const h = heightAt(t, x, z);
    assert.ok(Number.isFinite(h), `height at ${x},${z} was ${h}`);
  }
});

test('heightAt agrees with the stored grid at the grid points', () => {
  const t = createTerrain({ size: 40, resolution: 20, relief: 5, gradient: 2, seed: 8 });
  const step = t.size / t.res;
  for (const [i, j] of [[0, 0], [5, 13], [20, 20], [7, 0]]) {
    const stored = t.heights[j * (t.res + 1) + i];
    const read = heightAt(t, i * step, j * step);
    assert.ok(Math.abs(stored - read) < 1e-5, `grid ${i},${j}: ${stored} vs ${read}`);
  }
});

test('inside knows where the site ends', () => {
  const t = flat();
  assert.equal(inside(t, 0, 0), true);
  assert.equal(inside(t, 40, 40), true);
  assert.equal(inside(t, 20, 20), true);
  assert.equal(inside(t, -0.1, 20), false);
  assert.equal(inside(t, 20, 40.1), false);
});

test('siteArea is the square of the size', () => {
  assert.equal(siteArea(flat()), 1600);
});

// ---- The building pad ----------------------------------------------------

test('a pad levels the ground under the building', () => {
  const t = createTerrain({
    size: 60, resolution: 96, relief: 6, gradient: 5, seed: 21,
    pad: { x: 20, z: 20, width: 14, depth: 10 },
  });
  const level = t.pad.level;
  for (const [x, z] of [[21, 21], [27, 25], [33, 29], [26, 22]]) {
    assert.ok(Math.abs(heightAt(t, x, z) - level) < 0.02,
      `${x},${z} is ${(heightAt(t, x, z) - level).toFixed(3)} m off the pad level`);
  }
});

test('the pad is level enough to build on', () => {
  const t = createTerrain({
    size: 60, resolution: 96, relief: 8, gradient: 6, seed: 4,
    pad: { x: 15, z: 15, width: 18, depth: 12 },
  });
  for (const [x, z] of [[18, 18], [24, 21], [30, 25]]) {
    assert.ok(slopeAt(t, x, z) < 1.5, `slope on the pad at ${x},${z} was ${slopeAt(t, x, z).toFixed(1)}°`);
  }
});

test('the ground outside the margin is untouched by the pad', () => {
  const base = createTerrain({ size: 60, resolution: 96, relief: 6, gradient: 4, seed: 9 });
  const before = heightAt(base, 55, 55);
  levelPad(base, { x: 10, z: 10, width: 10, depth: 10, margin: 3 });
  assert.equal(heightAt(base, 55, 55), before);
});

test('the pad blends into the natural ground rather than leaving a cliff', () => {
  const t = createTerrain({
    size: 60, resolution: 120, relief: 7, gradient: 5, seed: 13,
    pad: { x: 20, z: 20, width: 12, depth: 12, margin: 4 },
  });
  // Walk out from the pad edge and check the step between samples stays small.
  let previous = heightAt(t, 32, 26);
  for (let d = 0.25; d <= 6; d += 0.25) {
    const h = heightAt(t, 32 + d, 26);
    assert.ok(Math.abs(h - previous) < 0.6, `a ${Math.abs(h - previous).toFixed(2)} m step at ${d} m out`);
    previous = h;
  }
});

test('a pad level can be given explicitly', () => {
  const t = createTerrain({
    size: 40, resolution: 64, relief: 5, seed: 2,
    pad: { x: 10, z: 10, width: 8, depth: 8, level: 12.5 },
  });
  assert.equal(t.pad.level, 12.5);
  assert.ok(Math.abs(heightAt(t, 14, 14) - 12.5) < 0.02);
  assert.ok(t.highest >= 12.5, 'the height range was recomputed after levelling');
});

test('onPad reports the footprint, and honours an inset', () => {
  const t = createTerrain({
    size: 60, resolution: 64, relief: 3, seed: 1,
    pad: { x: 20, z: 20, width: 10, depth: 10 },
  });
  assert.equal(onPad(t, 25, 25), true);
  assert.equal(onPad(t, 19, 25), false);
  assert.equal(onPad(t, 19, 25, 2), true, 'a 2 m keep-out reaches 19');
  assert.equal(onPad(t, 17, 25, 2), false);
});

test('onPad is false when there is no building', () => {
  assert.equal(onPad(flat(), 20, 20, 5), false);
});

// ---- The mesh ------------------------------------------------------------

test('the mesh has one vertex per grid point and two triangles per cell', () => {
  const t = createTerrain({ size: 40, resolution: 16, relief: 3, seed: 6 });
  const mesh = terrainMesh(t);
  assert.equal(mesh.vertexCount, 17 * 17);
  assert.equal(mesh.positions.length, 17 * 17 * 3);
  assert.equal(mesh.normals.length, 17 * 17 * 3);
  assert.equal(mesh.slopes.length, 17 * 17);
  assert.equal(mesh.indices.length, 16 * 16 * 6);
});

test('every mesh index points at a real vertex', () => {
  const mesh = terrainMesh(createTerrain({ size: 40, resolution: 12, relief: 4, seed: 7 }));
  for (const i of mesh.indices) {
    assert.ok(i >= 0 && i < mesh.vertexCount, `index ${i} is out of range`);
  }
});

test('mesh vertices carry the heights the terrain reports', () => {
  const t = createTerrain({ size: 40, resolution: 10, relief: 4, gradient: 3, seed: 15 });
  const mesh = terrainMesh(t);
  for (let k = 0; k < mesh.vertexCount; k += 7) {
    const x = mesh.positions[k * 3];
    const y = mesh.positions[k * 3 + 1];
    const z = mesh.positions[k * 3 + 2];
    assert.ok(Math.abs(heightAt(t, x, z) - y) < 1e-5, `vertex ${k} disagrees with heightAt`);
  }
});

test('mesh normals are unit length and mesh slopes match slopeAt', () => {
  const t = createTerrain({ size: 40, resolution: 12, relief: 6, gradient: 4, seed: 19 });
  const mesh = terrainMesh(t);
  for (let k = 0; k < mesh.vertexCount; k += 5) {
    const n = [mesh.normals[k * 3], mesh.normals[k * 3 + 1], mesh.normals[k * 3 + 2]];
    assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-6, `normal ${k} is not unit length`);
    const x = mesh.positions[k * 3];
    const z = mesh.positions[k * 3 + 2];
    assert.ok(Math.abs(mesh.slopes[k] - slopeAt(t, x, z)) < 1e-4, `slope ${k} disagrees`);
  }
});

test('the mesh spans exactly the site', () => {
  const mesh = terrainMesh(createTerrain({ size: 45, resolution: 15, relief: 2, seed: 2 }));
  let minX = Infinity;
  let maxX = -Infinity;
  for (let k = 0; k < mesh.vertexCount; k += 1) {
    minX = Math.min(minX, mesh.positions[k * 3]);
    maxX = Math.max(maxX, mesh.positions[k * 3]);
  }
  assert.equal(minX, 0);
  assert.equal(maxX, 45);
});

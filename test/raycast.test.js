import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrain, heightAt } from '../src/engine/terrain.js';
import { rayPlane, rayBounds, rayTerrain, pickGround } from '../src/engine/raycast.js';

const norm = (v) => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

const flat = createTerrain({ size: 40, resolution: 32, relief: 0, gradient: 0, seed: 1 });
const hilly = createTerrain({ size: 60, resolution: 96, relief: 8, gradient: 5, seed: 11 });

test('a ray straight down hits the plane below it', () => {
  const hit = rayPlane([5, 10, 7], [0, -1, 0], 0);
  assert.ok(hit);
  assert.equal(hit.t, 10);
  assert.deepEqual(hit.point, [5, 0, 7]);
});

test('a ray pointing away from the plane misses it', () => {
  assert.equal(rayPlane([5, 10, 7], [0, 1, 0], 0), null);
});

test('a ray parallel to the plane misses it', () => {
  assert.equal(rayPlane([5, 10, 7], [1, 0, 0], 0), null);
});

test('rayBounds finds the span over the site', () => {
  const span = rayBounds(flat, [20, 50, 20], [0, -1, 0]);
  assert.ok(span);
  assert.ok(span.near < span.far);
});

test('rayBounds returns null for a ray that misses the site', () => {
  assert.equal(rayBounds(flat, [-100, 50, -100], [0, -1, 0]), null);
  assert.equal(rayBounds(flat, [20, 50, 20], [0, 1, 0]), null, 'pointing up, away from the site');
});

test('a ray down onto level ground lands at height zero', () => {
  const hit = rayTerrain(flat, [17, 30, 23], [0, -1, 0]);
  assert.ok(hit, 'there is a hit');
  assert.ok(Math.abs(hit.point[0] - 17) < 1e-3);
  assert.ok(Math.abs(hit.point[2] - 23) < 1e-3);
  assert.ok(Math.abs(hit.point[1]) < 1e-3, `landed at y=${hit.point[1]}`);
});

test('a hit always lands on the surface, from any angle', () => {
  const origins = [[30, 40, -20], [-15, 30, 30], [70, 25, 70], [30, 60, 30]];
  for (const origin of origins) {
    const target = [30, heightAt(hilly, 30, 30), 30];
    const dir = norm([target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]]);
    const hit = rayTerrain(hilly, origin, dir);
    assert.ok(hit, `no hit from ${origin}`);
    const ground = heightAt(hilly, hit.point[0], hit.point[2]);
    assert.ok(Math.abs(hit.point[1] - ground) < 0.01,
      `from ${origin} the hit was ${(hit.point[1] - ground).toFixed(3)} m off the surface`);
  }
});

test('the hit is the FIRST crossing, not one behind a hill', () => {
  // A shallow ray across broken ground must stop at the near face.
  const origin = [2, hilly.highest + 2, 2];
  const dir = norm([1, -0.22, 1]);
  const hit = rayTerrain(hilly, origin, dir);
  assert.ok(hit, 'there is a hit');
  // Sample along the ray before the hit: nothing should be underground.
  for (let t = 0.5; t < hit.t - 0.1; t += 0.25) {
    const x = origin[0] + dir[0] * t;
    const y = origin[1] + dir[1] * t;
    const z = origin[2] + dir[2] * t;
    assert.ok(y >= heightAt(hilly, x, z) - 1e-6,
      `the ray was already ${(heightAt(hilly, x, z) - y).toFixed(3)} m underground at t=${t}`);
  }
});

test('a ray aimed above the site finds nothing', () => {
  assert.equal(rayTerrain(hilly, [30, 30, -40], norm([0, 0.6, 1])), null);
});

test('a ray starting underground returns nothing rather than a wrong hit', () => {
  const deep = [30, hilly.lowest - 5, 30];
  assert.equal(rayTerrain(hilly, deep, [0, -1, 0]), null);
  assert.equal(rayTerrain(hilly, deep, [0, 1, 0]), null);
});

test('maxDistance stops the march', () => {
  const origin = [30, 500, 30];
  assert.ok(rayTerrain(hilly, origin, [0, -1, 0]), 'reachable by default');
  assert.equal(rayTerrain(hilly, origin, [0, -1, 0], { maxDistance: 10 }), null);
});

test('a near-vertical ray on a steep bank still lands on the surface', () => {
  const steep = createTerrain({ size: 40, resolution: 80, relief: 14, gradient: 20, seed: 3 });
  for (let x = 2; x < 38; x += 3.5) {
    for (let z = 2; z < 38; z += 3.5) {
      const hit = rayTerrain(steep, [x, 100, z], [0, -1, 0]);
      assert.ok(hit, `no hit at ${x},${z}`);
      assert.ok(Math.abs(hit.point[1] - heightAt(steep, x, z)) < 0.01, `off surface at ${x},${z}`);
    }
  }
});

test('pickGround reports a real surface hit as one', () => {
  const p = pickGround(hilly, [30, 60, 30], [0, -1, 0]);
  assert.ok(p);
  assert.equal(p.onTerrain, true);
  assert.equal(p.inSite, true);
});

test('pickGround falls back to the mean level rather than returning nothing', () => {
  // Aimed at the horizon: no surface hit, but the brush still needs a position.
  const p = pickGround(hilly, [30, 20, -40], norm([0, -0.02, 1]));
  assert.ok(p, 'a position is still returned');
  assert.equal(p.onTerrain, false);
  const mid = (hilly.lowest + hilly.highest) / 2;
  assert.ok(Math.abs(p.point[1] - mid) < 1e-6);
});

test('pickGround says when the pointer is off the site', () => {
  const p = pickGround(flat, [-60, 10, -60], norm([0, -1, 0]));
  assert.ok(p);
  assert.equal(p.inSite, false);
});

test('pickGround returns null only when there is genuinely nothing to aim at', () => {
  assert.equal(pickGround(flat, [20, 10, 20], [1, 0, 0]), null, 'a level ray parallel to the fallback plane');
});

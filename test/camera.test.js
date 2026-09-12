import test from 'node:test';
import assert from 'node:assert/strict';
import {
  identity, multiply, perspective, lookAt, invert, transformPoint,
  transformDirection, normalMatrix, normalize, cross, dot,
} from '../src/ui/mat4.js';
import {
  createCamera, eyeOf, matrices, rayThrough, orbit, zoom, pan,
  frameSite, clampToSite, northOnScreen, LIMITS,
} from '../src/ui/camera.js';
import { createTerrain, heightAt } from '../src/engine/terrain.js';
import { rayTerrain } from '../src/engine/raycast.js';

const close = (a, b, tol = 1e-4) => Math.abs(a - b) < tol;
const closeVec = (a, b, tol = 1e-4) => a.every((v, i) => close(v, b[i], tol));

// ---- mat4 ----------------------------------------------------------------

test('identity leaves a point alone', () => {
  const { point } = transformPoint(identity(), [3, -4, 5]);
  assert.ok(closeVec(point, [3, -4, 5]));
});

test('identity is the multiplicative identity', () => {
  const m = perspective(1, 1.5, 0.1, 100);
  assert.ok([...multiply(m, identity())].every((v, i) => close(v, m[i])));
  assert.ok([...multiply(identity(), m)].every((v, i) => close(v, m[i])));
});

test('translation lives in the last column, as column-major requires', () => {
  const m = lookAt([0, 0, 0], [0, 0, -1], [0, 1, 0]);
  // An identity-orientation view from the origin should have no translation.
  assert.ok(close(m[12], 0) && close(m[13], 0) && close(m[14], 0));

  const shifted = lookAt([5, 2, 7], [5, 2, 6], [0, 1, 0]);
  // Looking down -Z from (5,2,7): the eye maps to the origin in view space.
  const { point } = transformPoint(shifted, [5, 2, 7]);
  assert.ok(closeVec(point, [0, 0, 0]), `eye mapped to ${point}`);
});

test('multiply applies the right-hand matrix first', () => {
  const view = lookAt([0, 0, 10], [0, 0, 0], [0, 1, 0]);
  const proj = perspective(Math.PI / 4, 1, 0.1, 100);
  const combined = multiply(proj, view);
  const direct = transformPoint(proj, transformPoint(view, [1, 2, 0]).point);
  const once = transformPoint(combined, [1, 2, 0]);
  assert.ok(closeVec(once.point, direct.point, 1e-3), `${once.point} vs ${direct.point}`);
});

test('lookAt puts the target at the centre of the view', () => {
  const view = lookAt([20, 30, 40], [0, 0, 0], [0, 1, 0]);
  const { point } = transformPoint(view, [0, 0, 0]);
  assert.ok(close(point[0], 0) && close(point[1], 0), `target at ${point}`);
  assert.ok(point[2] < 0, 'and in front of the camera, which is -Z in view space');
});

test('lookAt does not collapse when looking straight down', () => {
  const view = lookAt([10, 50, 10], [10, 0, 10], [0, 1, 0]);
  assert.ok([...view].every(Number.isFinite), 'no NaNs from the degenerate up vector');
  const inv = invert(view);
  assert.ok(inv, 'and the matrix is still invertible');
});

test('perspective puts the near plane at -1 and the far plane at +1', () => {
  const p = perspective(Math.PI / 3, 1.6, 0.5, 200);
  assert.ok(close(transformPoint(p, [0, 0, -0.5]).point[2], -1), 'near');
  assert.ok(close(transformPoint(p, [0, 0, -200]).point[2], 1), 'far');
});

test('perspective makes distant things smaller', () => {
  const p = perspective(Math.PI / 3, 1, 0.1, 100);
  const nearX = transformPoint(p, [1, 0, -5]).point[0];
  const farX = transformPoint(p, [1, 0, -50]).point[0];
  assert.ok(Math.abs(farX) < Math.abs(nearX), `${farX} should be nearer the centre than ${nearX}`);
});

test('invert really inverts', () => {
  const m = multiply(perspective(Math.PI / 3, 1.4, 0.2, 300), lookAt([12, 30, -8], [4, 1, 6]));
  const inv = invert(m);
  assert.ok(inv);
  const round = multiply(inv, m);
  const id = identity();
  for (let i = 0; i < 16; i += 1) {
    assert.ok(close(round[i], id[i], 1e-3), `element ${i} came back as ${round[i]}`);
  }
});

test('invert returns null for a singular matrix instead of NaNs', () => {
  assert.equal(invert(new Float32Array(16)), null);
  const flat = identity();
  flat[10] = 0;
  flat[15] = 0;
  assert.equal(invert(flat), null);
});

test('transformDirection ignores translation', () => {
  const m = lookAt([100, 200, 300], [100, 200, 299], [0, 1, 0]);
  const d = transformDirection(m, [0, 0, -1]);
  assert.ok(closeVec(d, [0, 0, -1]), `got ${d}`);
});

test('normalize, cross and dot behave', () => {
  assert.ok(closeVec(normalize([3, 0, 4]), [0.6, 0, 0.8]));
  assert.deepEqual(normalize([0, 0, 0]), [0, 0, 0], 'a zero vector does not become NaN');
  assert.ok(closeVec(cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]));
  assert.equal(dot([1, 2, 3], [4, 5, 6]), 32);
});

test('the normal matrix keeps normals perpendicular under a non-uniform scale', () => {
  // A plant is scaled by spread in x and z and by height in y, so this is the
  // case that goes wrong if the model matrix is used for normals directly.
  const model = identity();
  model[0] = 4;
  model[5] = 12;
  model[10] = 4;
  const nm = normalMatrix(model);

  // A 45° surface: the normal must stay perpendicular to the surface after
  // both are transformed.
  const tangent = normalize([1, 1, 0]);
  const normal = normalize([1, -1, 0]);
  const tWorld = [
    model[0] * tangent[0], model[5] * tangent[1], model[10] * tangent[2],
  ];
  const nWorld = [
    nm[0] * normal[0] + nm[3] * normal[1] + nm[6] * normal[2],
    nm[1] * normal[0] + nm[4] * normal[1] + nm[7] * normal[2],
    nm[2] * normal[0] + nm[5] * normal[1] + nm[8] * normal[2],
  ];
  assert.ok(Math.abs(dot(normalize(tWorld), normalize(nWorld))) < 1e-4,
    `the normal is no longer perpendicular (dot ${dot(normalize(tWorld), normalize(nWorld))})`);
});

test('the normal matrix of a rotation is that rotation', () => {
  // For a pure rotation the inverse is the transpose, so the inverse
  // transpose is the rotation itself, element for element.
  const a = 0.7;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const m = identity();
  m[0] = cos; m[2] = -sin;
  m[8] = sin; m[10] = cos;
  const nm = normalMatrix(m);
  // Column-major 3x3: index [column * 3 + row].
  const expected = [cos, 0, -sin, 0, 1, 0, sin, 0, cos];
  for (let i = 0; i < 9; i += 1) {
    assert.ok(close(nm[i], expected[i], 1e-3),
      `element ${i} is ${nm[i].toFixed(4)}, expected ${expected[i].toFixed(4)}`);
  }
});

test('the normal matrix of a degenerate scale falls back to identity', () => {
  const m = new Float32Array(16);
  const nm = normalMatrix(m);
  assert.ok(close(nm[0], 1) && close(nm[4], 1) && close(nm[8], 1));
});

// ---- The camera ----------------------------------------------------------

test('the camera clamps its inputs on creation', () => {
  const c = createCamera({ elevation: 400, distance: 1e6, fov: 1 });
  assert.equal(c.elevation, LIMITS.elevation[1]);
  assert.equal(c.distance, LIMITS.distance[1]);
  assert.equal(c.fov, LIMITS.fov[0]);
});

test('the eye is at the requested distance from the target', () => {
  const c = createCamera({ target: [30, 2, 30], distance: 80, elevation: 35, bearing: 140 });
  const eye = eyeOf(c);
  assert.ok(close(Math.hypot(eye[0] - 30, eye[1] - 2, eye[2] - 30), 80, 1e-3));
});

test('the eye is above the target at any positive elevation', () => {
  for (const elevation of [5, 30, 60, 88]) {
    const eye = eyeOf(createCamera({ target: [0, 0, 0], elevation, distance: 50 }));
    assert.ok(eye[1] > 0, `elevation ${elevation} put the eye at y=${eye[1]}`);
  }
});

test('bearing zero looks from the south, so the eye sits at +Z', () => {
  // North is -Z, and the camera looks toward its target from behind.
  const eye = eyeOf(createCamera({ target: [0, 0, 0], bearing: 0, elevation: 10, distance: 50 }));
  assert.ok(eye[2] > 0, `bearing 0 put the eye at z=${eye[2]}`);
  assert.ok(close(eye[0], 0, 1e-3));
});

test('bearing 90 puts the eye to the east', () => {
  const eye = eyeOf(createCamera({ target: [0, 0, 0], bearing: 90, elevation: 10, distance: 50 }));
  assert.ok(eye[0] > 0, `got x=${eye[0]}`);
  assert.ok(close(eye[2], 0, 1e-3));
});

test('orbiting changes bearing and elevation and stays in range', () => {
  const c = createCamera({ bearing: 10, elevation: 30 });
  orbit(c, 100, 50);
  assert.notEqual(c.bearing, 10);
  assert.ok(c.elevation >= LIMITS.elevation[0] && c.elevation <= LIMITS.elevation[1]);

  for (let i = 0; i < 200; i += 1) orbit(c, 50, 50);
  assert.ok(c.bearing >= 0 && c.bearing < 360, `bearing escaped to ${c.bearing}`);
  assert.equal(c.elevation, LIMITS.elevation[1], 'elevation pins at the top');

  for (let i = 0; i < 400; i += 1) orbit(c, -50, -50);
  assert.ok(c.bearing >= 0 && c.bearing < 360, `bearing escaped to ${c.bearing}`);
  assert.equal(c.elevation, LIMITS.elevation[0], 'and at the bottom');
});

test('zoom multiplies the distance and clamps it', () => {
  const c = createCamera({ distance: 100 });
  zoom(c, 0.5);
  assert.equal(c.distance, 50);
  for (let i = 0; i < 50; i += 1) zoom(c, 0.5);
  assert.equal(c.distance, LIMITS.distance[0]);
  for (let i = 0; i < 100; i += 1) zoom(c, 2);
  assert.equal(c.distance, LIMITS.distance[1]);
});

test('panning moves the target and never its height', () => {
  const c = createCamera({ target: [30, 5, 30] });
  pan(c, 40, 25, 800, 600);
  assert.notEqual(c.target[0], 30);
  assert.notEqual(c.target[2], 30);
  assert.equal(c.target[1], 5, 'the target stays at the same level');
});

test('panning right moves the view consistently, whichever way the camera faces', () => {
  // Dragging right should move the target in the direction that appears left
  // on screen, at every bearing. Checked by projecting the movement onto the
  // camera's own screen-right axis.
  for (const bearing of [0, 45, 90, 180, 270, 330]) {
    const c = createCamera({ target: [0, 0, 0], bearing, distance: 60, elevation: 30 });
    const before = [...c.target];
    pan(c, 50, 0, 800, 600);
    const moved = [c.target[0] - before[0], 0, c.target[2] - before[2]];
    const b = (bearing * Math.PI) / 180;
    const screenRight = [Math.cos(b), 0, -Math.sin(b)];
    assert.ok(dot(moved, screenRight) < -1e-6,
      `at bearing ${bearing} a rightward drag moved the target the wrong way`);
  }
});

test('panning scales with distance, so it feels the same zoomed in or out', () => {
  const near = createCamera({ target: [0, 0, 0], distance: 20 });
  const far = createCamera({ target: [0, 0, 0], distance: 200 });
  pan(near, 50, 0, 800, 600);
  pan(far, 50, 0, 800, 600);
  assert.ok(Math.hypot(...far.target) > Math.hypot(...near.target) * 5);
});

test('clampToSite keeps the target near the plot', () => {
  const c = createCamera({ target: [10000, 0, -10000] });
  clampToSite(c, 60);
  assert.ok(c.target[0] <= 90 && c.target[0] >= -30, `x ended at ${c.target[0]}`);
  assert.ok(c.target[2] <= 90 && c.target[2] >= -30, `z ended at ${c.target[2]}`);
});

test('frameSite centres on the site and pulls back far enough to see it all', () => {
  const terrain = createTerrain({ size: 80, resolution: 32, relief: 4, seed: 1 });
  const c = frameSite(createCamera({}), terrain);
  assert.ok(close(c.target[0], 40) && close(c.target[2], 40));

  // Every corner of the site should land inside the clip volume.
  const { viewProjection } = matrices(c, 900, 600);
  for (const [x, z] of [[0, 0], [80, 0], [0, 80], [80, 80]]) {
    const { point, w } = transformPoint(viewProjection, [x, heightAt(terrain, x, z), z]);
    assert.ok(w > 0, `corner ${x},${z} is behind the camera`);
    assert.ok(Math.abs(point[1]) <= 1.02, `corner ${x},${z} is off the top or bottom (y=${point[1]})`);
  }
});

test('the north indicator turns with the camera', () => {
  assert.equal(northOnScreen(createCamera({ bearing: 0 })), 180);
  assert.equal(northOnScreen(createCamera({ bearing: 180 })), 0);
  assert.equal(northOnScreen(createCamera({ bearing: 270 })), 90);
});

// ---- Picking -------------------------------------------------------------

test('a ray through the centre of the screen points at the target', () => {
  const c = createCamera({ target: [30, 1, 30], bearing: 200, elevation: 35, distance: 70 });
  const ray = rayThrough(c, 450, 300, 900, 600);
  assert.ok(ray);
  const toTarget = normalize([30 - ray.origin[0], 1 - ray.origin[1], 30 - ray.origin[2]]);
  assert.ok(dot(ray.dir, toTarget) > 0.999, `the centre ray is off by ${Math.acos(dot(ray.dir, toTarget))} rad`);
});

test('the ray direction is a unit vector', () => {
  const c = createCamera({});
  for (const [px, py] of [[0, 0], [899, 0], [450, 300], [899, 599], [12, 588]]) {
    const ray = rayThrough(c, px, py, 900, 600);
    assert.ok(close(Math.hypot(...ray.dir), 1, 1e-5), `|dir| = ${Math.hypot(...ray.dir)}`);
  }
});

test('the ray starts in front of the eye, not behind it', () => {
  const c = createCamera({ target: [30, 0, 30], distance: 60, elevation: 30 });
  const eye = eyeOf(c);
  const ray = rayThrough(c, 450, 300, 900, 600);
  // The near plane is close to the eye, and pointing the same way.
  const toOrigin = normalize([ray.origin[0] - eye[0], ray.origin[1] - eye[1], ray.origin[2] - eye[2]]);
  assert.ok(dot(ray.dir, toOrigin) > 0.99, 'the ray origin is along the view direction');
});

test('moving the pointer right swings the ray right', () => {
  const c = createCamera({ target: [0, 0, 0], bearing: 0, elevation: 20, distance: 60 });
  const left = rayThrough(c, 200, 300, 900, 600);
  const right = rayThrough(c, 700, 300, 900, 600);
  // Screen right at bearing 0 is +X.
  assert.ok(right.dir[0] > left.dir[0], `${right.dir[0]} should be greater than ${left.dir[0]}`);
});

test('moving the pointer down swings the ray down', () => {
  const c = createCamera({ target: [0, 0, 0], elevation: 35, distance: 60 });
  const up = rayThrough(c, 450, 100, 900, 600);
  const down = rayThrough(c, 450, 500, 900, 600);
  assert.ok(down.dir[1] < up.dir[1], 'a lower pointer should aim lower, not higher');
});

test('a ray at a zero-sized viewport is refused rather than returning NaNs', () => {
  assert.equal(rayThrough(createCamera({}), 0, 0, 0, 0), null);
  assert.equal(rayThrough(createCamera({}), 0, 0, 900, 0), null);
});

test('picking round-trips: a point on the ground projects to the pixel that picks it', () => {
  // This is the property the whole painting interaction rests on.
  const terrain = createTerrain({ size: 60, resolution: 64, relief: 5, gradient: 3, seed: 17 });
  const c = frameSite(createCamera({ bearing: 215, elevation: 34 }), terrain);
  const width = 960;
  const height = 640;
  const { viewProjection } = matrices(c, width, height);

  for (const [x, z] of [[10, 10], [30, 30], [50, 20], [20, 48], [45, 45]]) {
    const y = heightAt(terrain, x, z);
    const { point, w } = transformPoint(viewProjection, [x, y, z]);
    assert.ok(w > 0, `${x},${z} is behind the camera`);
    const px = ((point[0] + 1) / 2) * width;
    const py = ((1 - point[1]) / 2) * height;

    const ray = rayThrough(c, px, py, width, height);
    assert.ok(ray, `no ray for ${x},${z}`);
    const hit = rayTerrain(terrain, ray.origin, ray.dir);
    assert.ok(hit, `the ray through ${px.toFixed(1)},${py.toFixed(1)} missed the ground`);
    assert.ok(Math.hypot(hit.point[0] - x, hit.point[2] - z) < 0.2,
      `picked ${hit.point[0].toFixed(2)},${hit.point[2].toFixed(2)} for ${x},${z}`);
  }
});

test('picking round-trips at several bearings and elevations', () => {
  const terrain = createTerrain({ size: 60, resolution: 48, relief: 4, gradient: 2, seed: 23 });
  const width = 800;
  const height = 600;
  for (const bearing of [0, 70, 145, 260, 340]) {
    for (const elevation of [12, 40, 75]) {
      const c = frameSite(createCamera({ bearing, elevation }), terrain);
      const { viewProjection } = matrices(c, width, height);
      const [x, z] = [24, 36];
      const { point, w } = transformPoint(viewProjection, [x, heightAt(terrain, x, z), z]);
      assert.ok(w > 0);
      const ray = rayThrough(c, ((point[0] + 1) / 2) * width, ((1 - point[1]) / 2) * height, width, height);
      const hit = rayTerrain(terrain, ray.origin, ray.dir);
      assert.ok(hit, `missed at bearing ${bearing}, elevation ${elevation}`);
      assert.ok(Math.hypot(hit.point[0] - x, hit.point[2] - z) < 0.3,
        `off by ${Math.hypot(hit.point[0] - x, hit.point[2] - z).toFixed(2)} m at bearing ${bearing}, elevation ${elevation}`);
    }
  }
});

test('the near and far planes track the distance without clipping the site', () => {
  const terrain = createTerrain({ size: 100, resolution: 32, relief: 6, seed: 4 });
  for (const distance of [10, 60, 200, 500]) {
    const c = createCamera({ target: [50, 0, 50], distance, elevation: 30 });
    const { near, far } = matrices(c, 800, 600);
    assert.ok(near > 0 && near < distance, `near ${near} against distance ${distance}`);
    assert.ok(far > distance + terrain.size, `far ${far} is too close for a ${terrain.size} m site`);
  }
});

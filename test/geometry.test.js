import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForm, buildingMesh, instanceMatrix, FORM_NAMES } from '../src/engine/geometry.js';

const bounds = (mesh) => {
  const b = {
    minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity,
  };
  for (let i = 0; i < mesh.positions.length; i += 3) {
    b.minX = Math.min(b.minX, mesh.positions[i]);
    b.maxX = Math.max(b.maxX, mesh.positions[i]);
    b.minY = Math.min(b.minY, mesh.positions[i + 1]);
    b.maxY = Math.max(b.maxY, mesh.positions[i + 1]);
    b.minZ = Math.min(b.minZ, mesh.positions[i + 2]);
    b.maxZ = Math.max(b.maxZ, mesh.positions[i + 2]);
  }
  return b;
};

test('every form builds', () => {
  for (const form of FORM_NAMES) {
    const mesh = buildForm(form);
    assert.ok(mesh.vertexCount > 3, `${form} has ${mesh.vertexCount} vertices`);
    assert.ok(mesh.triangleCount > 1, `${form} has ${mesh.triangleCount} triangles`);
  }
});

test('an unknown form is refused loudly rather than drawn as nothing', () => {
  assert.throws(() => buildForm('banana'), /Unknown form: banana/);
});

test('every form sits on the ground, one unit tall, one unit across', () => {
  for (const form of FORM_NAMES) {
    const b = bounds(buildForm(form));
    assert.ok(Math.abs(b.minY) < 1e-6, `${form} starts at y=${b.minY}, not 0`);
    assert.ok(Math.abs(b.maxY - 1) < 0.02, `${form} is ${b.maxY} tall, not 1`);
    assert.ok(b.maxX <= 0.5 + 1e-6 && b.minX >= -0.5 - 1e-6, `${form} is ${b.maxX - b.minX} wide`);
    assert.ok(b.maxZ <= 0.5 + 1e-6 && b.minZ >= -0.5 - 1e-6, `${form} is ${b.maxZ - b.minZ} deep`);
  }
});

test('every form is at least roughly centred on its stem', () => {
  for (const form of FORM_NAMES) {
    const b = bounds(buildForm(form));
    assert.ok(Math.abs(b.minX + b.maxX) < 0.25, `${form} is off-centre in x`);
    assert.ok(Math.abs(b.minZ + b.maxZ) < 0.25, `${form} is off-centre in z`);
  }
});

test('every index points at a real vertex', () => {
  for (const form of FORM_NAMES) {
    const mesh = buildForm(form);
    for (const i of mesh.indices) {
      assert.ok(i >= 0 && i < mesh.vertexCount, `${form}: index ${i} of ${mesh.vertexCount}`);
    }
  }
});

test('every form fits in a 16-bit index buffer', () => {
  for (const form of FORM_NAMES) {
    const mesh = buildForm(form);
    assert.ok(mesh.vertexCount <= 65535, `${form} has ${mesh.vertexCount} vertices`);
    assert.equal(mesh.indices.constructor, Uint16Array);
  }
});

test('every normal is unit length', () => {
  for (const form of FORM_NAMES) {
    const mesh = buildForm(form);
    for (let i = 0; i < mesh.normals.length; i += 3) {
      const len = Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
      assert.ok(Math.abs(len - 1) < 1e-5, `${form}: normal ${i / 3} has length ${len}`);
    }
  }
});

test('the part attribute is one per vertex and only ever foliage or stem', () => {
  for (const form of FORM_NAMES) {
    const mesh = buildForm(form);
    assert.equal(mesh.parts.length, mesh.vertexCount);
    for (const p of mesh.parts) assert.ok(p === 0 || p === 1, `${form}: part ${p}`);
  }
});

test('the tree forms have a woody stem and the ground forms do not', () => {
  const hasStem = (form) => [...buildForm(form).parts].some((p) => p === 1);
  for (const form of ['round', 'spreading', 'conical', 'columnar']) {
    assert.equal(hasStem(form), true, `${form} should have a stem`);
  }
  for (const form of ['mound', 'tuft', 'slab']) {
    assert.equal(hasStem(form), false, `${form} should not have a stem`);
  }
});

test('a canopy form is mostly foliage, not mostly trunk', () => {
  for (const form of ['round', 'spreading', 'conical', 'columnar']) {
    const parts = [...buildForm(form).parts];
    const foliage = parts.filter((p) => p === 0).length / parts.length;
    assert.ok(foliage > 0.6, `${form} is only ${(foliage * 100).toFixed(0)}% foliage`);
  }
});

test('every form fills its unit box, so spread and height set the proportions', () => {
  // Width is deliberately NOT a property of the form: a columnar tree is
  // narrow because its species spreads 1.5 m, not because its mesh is thin.
  // Each form therefore has to fill the unit box, or scaling by spread would
  // silently produce something narrower than asked for.
  for (const form of FORM_NAMES) {
    const b = bounds(buildForm(form));
    assert.ok(b.maxY > 0.95, `${form} only reaches ${b.maxY.toFixed(3)} of its unit height`);
    if (form !== 'tuft') {
      assert.ok(b.maxX - b.minX > 0.9, `${form} is only ${(b.maxX - b.minX).toFixed(3)} wide`);
    }
  }
});

test('a conifer tapers: broad at the base, a point at the top', () => {
  const mesh = buildForm('conical');
  // The cone has rings only at its base and its apex, so the test looks at
  // bands rather than at one height.
  const widestBelow = (limit) => {
    let w = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      if (mesh.positions[i + 1] < limit) {
        w = Math.max(w, Math.hypot(mesh.positions[i], mesh.positions[i + 2]));
      }
    }
    return w;
  };
  const widestAbove = (limit) => {
    let w = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      if (mesh.positions[i + 1] > limit) {
        w = Math.max(w, Math.hypot(mesh.positions[i], mesh.positions[i + 2]));
      }
    }
    return w;
  };
  assert.ok(widestBelow(0.3) > 0.4, `the base is only ${widestBelow(0.3).toFixed(2)} across`);
  assert.ok(widestAbove(0.6) < 0.1, `it is still ${widestAbove(0.6).toFixed(2)} wide near the tip`);
});

test('a mound is a dome and does not sink below the ground', () => {
  const b = bounds(buildForm('mound'));
  assert.ok(Math.abs(b.minY) < 1e-6, `the underside is at y=${b.minY}`);
  assert.ok(Math.abs(b.maxY - 1) < 1e-6);
  // A full ellipsoid would put half its vertices below zero.
  const below = [...buildForm('mound').positions].filter((_, i) => i % 3 === 1).filter((y) => y < -1e-6);
  assert.equal(below.length, 0);
});

test('a slab is a box: eight corners and twelve triangles', () => {
  const mesh = buildForm('slab');
  assert.equal(mesh.triangleCount, 12);
  // Hard edges mean the corners are not welded, so there are 24 vertices.
  assert.equal(mesh.vertexCount, 24);
});

test('a tuft is visible from both sides', () => {
  const mesh = buildForm('tuft');
  // Every blade is drawn twice with opposite winding.
  assert.equal(mesh.triangleCount % 2, 0);
  assert.ok(mesh.triangleCount >= 14, `only ${mesh.triangleCount} triangles`);
});

test('forms are cheap enough to instance by the thousand', () => {
  // A dense scheme is a few thousand instances, so 250 triangles each keeps
  // the whole site under a million and comfortable on integrated graphics.
  for (const form of FORM_NAMES) {
    const mesh = buildForm(form);
    assert.ok(mesh.triangleCount <= 250, `${form} costs ${mesh.triangleCount} triangles`);
  }
});

// ---- The building --------------------------------------------------------

test('the building is a box on the pad, at the pad level', () => {
  const pad = { x: 10, z: 20, width: 14, depth: 8, level: 3.5 };
  const b = bounds(buildingMesh(pad, 7));
  assert.equal(b.minX, 10);
  assert.equal(b.maxX, 24);
  assert.equal(b.minZ, 20);
  assert.equal(b.maxZ, 28);
  assert.equal(b.minY, 3.5);
  assert.equal(b.maxY, 10.5);
});

test('no pad means no building rather than a box at the origin', () => {
  assert.equal(buildingMesh(null), null);
});

// ---- The instance transform ---------------------------------------------

const apply = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

// The matrix is a Float32Array because it goes straight into a WebGL uniform,
// so equality here is to single precision (about 1e-7 relative). Tightening
// these tolerances does not find bugs, it just fails.
const FLOAT32 = 1e-5;

test('the transform puts the base of the plant at its position', () => {
  const m = instanceMatrix({ x: 12, y: 3.5, z: -4, height: 9, spread: 6, rot: 1.1, lean: 0.03 });
  const base = apply(m, 0, 0, 0);
  assert.ok(Math.abs(base[0] - 12) < FLOAT32);
  assert.ok(Math.abs(base[1] - 3.5) < FLOAT32);
  assert.ok(Math.abs(base[2] + 4) < FLOAT32);
});

test('the transform scales height and spread independently', () => {
  const m = instanceMatrix({ x: 0, y: 0, z: 0, height: 10, spread: 4, rot: 0, lean: 0 });
  const top = apply(m, 0, 1, 0);
  assert.ok(Math.abs(top[1] - 10) < FLOAT32, `top of a 10 m plant was at ${top[1]}`);
  const side = apply(m, 0.5, 0, 0);
  assert.ok(Math.abs(side[0] - 2) < FLOAT32, `a 4 m spread should reach 2 m, reached ${side[0]}`);
});

test('the transform spins about the vertical without changing height', () => {
  const plant = { x: 0, y: 0, z: 0, height: 8, spread: 4, lean: 0 };
  for (const rot of [0, 0.7, Math.PI / 2, Math.PI, 5.5]) {
    const m = instanceMatrix({ ...plant, rot });
    const top = apply(m, 0, 1, 0);
    assert.ok(Math.abs(top[1] - 8) < FLOAT32, `rot ${rot} changed the height to ${top[1]}`);
    const side = apply(m, 0.5, 0, 0);
    const radius = Math.hypot(side[0], side[2]);
    assert.ok(Math.abs(radius - 2) < FLOAT32, `rot ${rot} changed the radius to ${radius}`);
  }
});

test('a rotation actually moves the geometry round', () => {
  const a = apply(instanceMatrix({ x: 0, y: 0, z: 0, height: 1, spread: 2, rot: 0, lean: 0 }), 0.5, 0, 0);
  const b = apply(instanceMatrix({ x: 0, y: 0, z: 0, height: 1, spread: 2, rot: Math.PI / 2, lean: 0 }), 0.5, 0, 0);
  assert.ok(Math.hypot(a[0] - b[0], a[2] - b[2]) > 1, 'a quarter turn should move a point');
});

test('lean tips the plant without lifting it off the ground', () => {
  const straight = instanceMatrix({ x: 0, y: 0, z: 0, height: 10, spread: 4, rot: 0, lean: 0 });
  const leaning = instanceMatrix({ x: 0, y: 0, z: 0, height: 10, spread: 4, rot: 0, lean: 0.1 });
  const base = apply(leaning, 0, 0, 0);
  assert.ok(Math.hypot(base[0], base[1], base[2]) < FLOAT32, 'the base stays put');
  const t1 = apply(straight, 0, 1, 0);
  const t2 = apply(leaning, 0, 1, 0);
  assert.ok(Math.hypot(t1[0] - t2[0], t1[2] - t2[2]) > 0.5, 'the top moves sideways');
  assert.ok(t2[1] > 9.8, `a small lean should barely lower the top, it went to ${t2[1]}`);
});

test('a missing lean is treated as upright', () => {
  const a = instanceMatrix({ x: 1, y: 2, z: 3, height: 5, spread: 2, rot: 0.4 });
  const b = instanceMatrix({ x: 1, y: 2, z: 3, height: 5, spread: 2, rot: 0.4, lean: 0 });
  assert.deepEqual([...a], [...b]);
});

test('the transform is a well-formed affine matrix', () => {
  const m = instanceMatrix({ x: 5, y: 1, z: 2, height: 3, spread: 2, rot: 0.9, lean: 0.04 });
  assert.equal(m.length, 16);
  assert.equal(m[3], 0);
  assert.equal(m[7], 0);
  assert.equal(m[11], 0);
  assert.equal(m[15], 1);
  for (const v of m) assert.ok(Number.isFinite(v));
});

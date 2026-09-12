/**
 * Just enough linear algebra.
 *
 * Column-major 4x4 matrices and 3-vectors, matching what WebGL expects, so a
 * matrix built here goes straight into a uniform with no transpose. Written
 * out rather than pulled from a library because this is about eighty lines and
 * a dependency would be the largest thing in the project.
 *
 * Column-major means element [column * 4 + row]: m[12], m[13], m[14] are the
 * translation. Getting that backwards is the classic way to spend an afternoon
 * looking at a black screen, which is why there are tests for it.
 */

export function identity() {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

/** a then b, i.e. the matrix that applies a first. */
export function multiply(b, a) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      out[c * 4 + r] = b[r] * a[c * 4]
        + b[4 + r] * a[c * 4 + 1]
        + b[8 + r] * a[c * 4 + 2]
        + b[12 + r] * a[c * 4 + 3];
    }
  }
  return out;
}

/** A right-handed perspective projection mapping depth into [-1, 1]. */
export function perspective(fovYRadians, aspect, near, far) {
  const f = 1 / Math.tan(fovYRadians / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-12) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** A view matrix putting the eye at `eye` looking at `target`. */
export function lookAt(eye, target, up = [0, 1, 0]) {
  const f = normalize(subtract(target, eye));
  let s = cross(f, up);
  if (Math.hypot(...s) < 1e-8) {
    // Looking straight down the up axis: pick any perpendicular rather than
    // returning a degenerate matrix that collapses the whole scene.
    s = cross(f, [1, 0, 0]);
    if (Math.hypot(...s) < 1e-8) s = cross(f, [0, 0, 1]);
  }
  s = normalize(s);
  const u = cross(s, f);

  const m = new Float32Array(16);
  m[0] = s[0]; m[4] = s[1]; m[8] = s[2];
  m[1] = u[0]; m[5] = u[1]; m[9] = u[2];
  m[2] = -f[0]; m[6] = -f[1]; m[10] = -f[2];
  m[12] = -dot(s, eye);
  m[13] = -dot(u, eye);
  m[14] = dot(f, eye);
  m[15] = 1;
  return m;
}

/** Transform a point (w = 1), returning the divided result and its w. */
export function transformPoint(m, p) {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  if (Math.abs(w) < 1e-12) return { point: [x, y, z], w };
  return { point: [x / w, y / w, z / w], w };
}

/** Transform a direction, ignoring translation. */
export function transformDirection(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
  ];
}

/** General 4x4 inverse. Returns null for a singular matrix rather than NaNs. */
export function invert(m) {
  const a00 = m[0]; const a01 = m[1]; const a02 = m[2]; const a03 = m[3];
  const a10 = m[4]; const a11 = m[5]; const a12 = m[6]; const a13 = m[7];
  const a20 = m[8]; const a21 = m[9]; const a22 = m[10]; const a23 = m[11];
  const a30 = m[12]; const a31 = m[13]; const a32 = m[14]; const a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-14) return null;
  const d = 1 / det;

  const out = new Float32Array(16);
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
  return out;
}

/**
 * The normal matrix: the inverse transpose of the upper 3x3, as a 3x3.
 *
 * Needed because a non-uniform scale — which every plant has, being scaled by
 * spread in x and z and by height in y — skews normals if they are transformed
 * by the model matrix directly, and the shading goes wrong in a way that is
 * subtle enough to ship by accident.
 */
export function normalMatrix(m) {
  const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const det = a[0] * (a[4] * a[8] - a[5] * a[7])
    - a[1] * (a[3] * a[8] - a[5] * a[6])
    + a[2] * (a[3] * a[7] - a[4] * a[6]);
  const out = new Float32Array(9);
  if (Math.abs(det) < 1e-14) {
    out[0] = 1;
    out[4] = 1;
    out[8] = 1;
    return out;
  }
  const d = 1 / det;
  // Inverse of the 3x3, then transposed — written as one step.
  out[0] = (a[4] * a[8] - a[5] * a[7]) * d;
  out[1] = (a[5] * a[6] - a[3] * a[8]) * d;
  out[2] = (a[3] * a[7] - a[4] * a[6]) * d;
  out[3] = (a[2] * a[7] - a[1] * a[8]) * d;
  out[4] = (a[0] * a[8] - a[2] * a[6]) * d;
  out[5] = (a[1] * a[6] - a[0] * a[7]) * d;
  out[6] = (a[1] * a[5] - a[2] * a[4]) * d;
  out[7] = (a[2] * a[3] - a[0] * a[5]) * d;
  out[8] = (a[0] * a[4] - a[1] * a[3]) * d;
  return out;
}

/**
 * The shapes.
 *
 * Each planting form is built once as a small indexed mesh in unit space —
 * base sitting on y = 0, one unit tall, one unit across — and then drawn once
 * per instance with a scale, a spin and a lean. So a 3 m shrub and a 14 m tree
 * of the same form are the same forty triangles, and the whole scheme is a
 * handful of instanced draw calls rather than thousands of separate ones.
 *
 * These are silhouettes, not botany. The point is that a scheme reads correctly
 * at a glance — which masses are tall, which are wide, where the canopy closes
 * over — and that the OBJ you take into Lumion has the right volumes in the
 * right places to swap for real assets.
 *
 * Every vertex carries a `part`: 0 for foliage, 1 for woody stem. The renderer
 * colours from that, so one mesh serves a green canopy on a brown trunk.
 */

const FOLIAGE = 0;
const STEM = 1;

/** A builder that accumulates smooth vertex normals as faces are added. */
function mesh() {
  const positions = [];
  const parts = [];
  const indices = [];
  const normals = [];
  const lookup = new Map();

  const vertex = (x, y, z, part, weld = true) => {
    // Welding shares a vertex between faces so its normal averages into a
    // smooth surface. Slabs pass weld = false to keep their edges crisp.
    const key = weld ? `${part}|${x.toFixed(5)}|${y.toFixed(5)}|${z.toFixed(5)}` : null;
    if (key !== null && lookup.has(key)) return lookup.get(key);
    const at = positions.length / 3;
    positions.push(x, y, z);
    normals.push(0, 0, 0);
    parts.push(part);
    if (key !== null) lookup.set(key, at);
    return at;
  };

  const triangle = (a, b, c) => {
    indices.push(a, b, c);
    // Face normal, area-weighted by using the raw cross product.
    const ax = positions[a * 3]; const ay = positions[a * 3 + 1]; const az = positions[a * 3 + 2];
    const bx = positions[b * 3]; const by = positions[b * 3 + 1]; const bz = positions[b * 3 + 2];
    const cx = positions[c * 3]; const cy = positions[c * 3 + 1]; const cz = positions[c * 3 + 2];
    const ux = bx - ax; const uy = by - ay; const uz = bz - az;
    const vx = cx - ax; const vy = cy - ay; const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      normals[i * 3] += nx;
      normals[i * 3 + 1] += ny;
      normals[i * 3 + 2] += nz;
    }
  };

  const quad = (a, b, c, d) => { triangle(a, b, c); triangle(a, c, d); };

  const done = () => {
    for (let i = 0; i < normals.length; i += 3) {
      const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
      if (len > 1e-9) {
        normals[i] /= len;
        normals[i + 1] /= len;
        normals[i + 2] /= len;
      } else {
        normals[i] = 0;
        normals[i + 1] = 1;
        normals[i + 2] = 0;
      }
    }
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      parts: new Float32Array(parts),
      indices: new Uint16Array(indices),
      vertexCount: positions.length / 3,
      triangleCount: indices.length / 3,
    };
  };

  return { vertex, triangle, quad, done };
}

/** A tapered vertical prism: the stem. */
function stem(m, { sides = 6, bottom, top, height, from = 0 }) {
  const ring = (y, r) => Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return m.vertex(Math.cos(a) * r, y, Math.sin(a) * r, STEM);
  });
  const lower = ring(from, bottom);
  const upper = ring(from + height, top);
  for (let i = 0; i < sides; i += 1) {
    const j = (i + 1) % sides;
    m.quad(lower[i], upper[i], upper[j], lower[j]);
  }
  // A cap on top so the stem is a closed solid and exports as watertight.
  const centre = m.vertex(0, from + height, 0, STEM);
  for (let i = 0; i < sides; i += 1) {
    m.triangle(upper[i], centre, upper[(i + 1) % sides]);
  }
  return upper;
}

/**
 * An ellipsoid blob.
 *
 * `half` builds only the upper hemisphere and closes the underside, which is
 * what a shrub mound or a gravel heap is. Without it the lower half sinks
 * below y = 0 and the form no longer sits on the ground.
 */
function blob(m, {
  cx = 0, cy, cz = 0, rx, ry, segments = 10, rings = 6, part = FOLIAGE, half = false,
}) {
  const sweep = half ? Math.PI / 2 : Math.PI;
  const grid = [];
  for (let j = 0; j <= rings; j += 1) {
    const phi = (j / rings) * sweep;
    const row = [];
    const y = cy + Math.cos(phi) * ry;
    const r = Math.sin(phi) * rx;
    for (let i = 0; i < segments; i += 1) {
      const theta = (i / segments) * Math.PI * 2;
      row.push(m.vertex(cx + Math.cos(theta) * r, y, cz + Math.sin(theta) * r, part));
    }
    grid.push(row);
  }
  for (let j = 0; j < rings; j += 1) {
    for (let i = 0; i < segments; i += 1) {
      const k = (i + 1) % segments;
      m.quad(grid[j][i], grid[j + 1][i], grid[j + 1][k], grid[j][k]);
    }
  }
  if (half) {
    // Close the underside so the dome is a solid and exports watertight.
    const centre = m.vertex(cx, cy, cz, part);
    const rim = grid[rings];
    for (let i = 0; i < segments; i += 1) {
      m.triangle(rim[i], centre, rim[(i + 1) % segments]);
    }
  }
}

/** A cone, for conifers. */
function cone(m, { base, apex, radius, segments = 10 }) {
  const ring = Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    return m.vertex(Math.cos(a) * radius, base, Math.sin(a) * radius, FOLIAGE);
  });
  const tip = m.vertex(0, apex, 0, FOLIAGE);
  const centre = m.vertex(0, base, 0, FOLIAGE);
  for (let i = 0; i < segments; i += 1) {
    const j = (i + 1) % segments;
    m.triangle(ring[i], tip, ring[j]);
    m.triangle(ring[j], centre, ring[i]);
  }
}

/** A box with hard edges. */
function box(m, { x0, x1, y0, y1, z0, z1, part = FOLIAGE }) {
  const v = (x, y, z) => m.vertex(x, y, z, part, false);
  const faces = [
    [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
    [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
    [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
  ];
  for (const f of faces) m.quad(...f.map((p) => v(...p)));
}

/** A fan of tapered blades, for groundcover. */
function tuft(m, { blades = 7, height = 1, radius = 0.5 }) {
  for (let b = 0; b < blades; b += 1) {
    const a = (b / blades) * Math.PI * 2 + (b % 2) * 0.4;
    const lean = 0.55 + (b % 3) * 0.12;
    const tipX = Math.cos(a) * radius * lean;
    const tipZ = Math.sin(a) * radius * lean;
    const w = radius * 0.16;
    // A blade is one triangle, base across the wind direction.
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    const v0 = m.vertex(px, 0, pz, FOLIAGE, false);
    const v1 = m.vertex(-px, 0, -pz, FOLIAGE, false);
    const v2 = m.vertex(tipX, height * (0.7 + (b % 4) * 0.1), tipZ, FOLIAGE, false);
    m.triangle(v0, v1, v2);
    // Backed by the reverse winding, so a blade is visible from both sides.
    m.triangle(v1, v0, v2);
  }
}

/**
 * Build one form in unit space.
 *
 * Unit space: the base sits on y = 0, the whole thing is 1.0 tall and 1.0
 * across at its widest. The renderer scales x and z by the instance's spread
 * and y by its height.
 */
export function buildForm(form) {
  const m = mesh();

  switch (form) {
    case 'round': {
      // A broadleaf: clear stem, then a canopy of three overlapping blobs so
      // the silhouette is not a billiard ball. The main blob's top defines the
      // unit height, and the side blobs are kept inside it.
      stem(m, { bottom: 0.055, top: 0.035, height: 0.42 });
      blob(m, { cy: 0.66, rx: 0.5, ry: 0.34, segments: 10, rings: 5 });
      blob(m, { cx: 0.14, cy: 0.74, cz: 0.08, rx: 0.30, ry: 0.20, segments: 6, rings: 3 });
      blob(m, { cx: -0.15, cy: 0.70, cz: -0.10, rx: 0.27, ry: 0.18, segments: 6, rings: 3 });
      break;
    }
    case 'spreading': {
      // A big canopy tree: short stem, deep crown carried low.
      stem(m, { bottom: 0.07, top: 0.045, height: 0.34, sides: 7 });
      blob(m, { cy: 0.60, rx: 0.5, ry: 0.40, segments: 10, rings: 5 });
      blob(m, { cx: 0.20, cy: 0.70, cz: 0.14, rx: 0.26, ry: 0.20, segments: 6, rings: 3 });
      blob(m, { cx: -0.22, cy: 0.66, cz: -0.13, rx: 0.24, ry: 0.18, segments: 6, rings: 3 });
      break;
    }
    case 'conical': {
      stem(m, { bottom: 0.05, top: 0.04, height: 0.14, sides: 6 });
      cone(m, { base: 0.10, apex: 1.0, radius: 0.5, segments: 12 });
      // A second, smaller skirt so the silhouette steps like a conifer.
      cone(m, { base: 0.08, apex: 0.58, radius: 0.40, segments: 12 });
      break;
    }
    case 'columnar': {
      stem(m, { bottom: 0.05, top: 0.04, height: 0.18 });
      blob(m, { cy: 0.58, rx: 0.5, ry: 0.42, segments: 8, rings: 6 });
      break;
    }
    case 'mound': {
      // A dome, not a sphere: only the upper half, closed underneath.
      blob(m, { cy: 0.0, rx: 0.5, ry: 1.0, segments: 10, rings: 5, half: true });
      break;
    }
    case 'tuft': {
      tuft(m, { blades: 7, height: 1, radius: 0.5 });
      break;
    }
    case 'slab': {
      box(m, { x0: -0.5, x1: 0.5, y0: 0, y1: 1, z0: -0.5, z1: 0.5 });
      break;
    }
    default:
      throw new Error(`Unknown form: ${form}`);
  }

  return m.done();
}

/** The building, as a simple extruded footprint. */
export function buildingMesh(pad, height = 7) {
  if (!pad) return null;
  const m = mesh();
  box(m, {
    x0: pad.x, x1: pad.x + pad.width,
    y0: pad.level, y1: pad.level + height,
    z0: pad.z, z1: pad.z + pad.depth,
    part: STEM,
  });
  return m.done();
}

/**
 * The per-instance transform, as a column-major 4x4.
 *
 * Scale by spread and height, lean a little, spin about the vertical, then
 * drop onto the ground. Written out rather than composed from matrix helpers
 * because it runs once per plant per rebuild.
 */
export function instanceMatrix(instance) {
  const { x, y, z, height, spread, rot, lean = 0 } = instance;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const cl = Math.cos(lean);
  const sl = Math.sin(lean);

  // Lean about X, then spin about Y, applied to a (spread, height, spread) scale.
  const m = new Float32Array(16);
  m[0] = spread * cr;
  m[1] = 0;
  m[2] = spread * -sr;
  m[3] = 0;

  m[4] = height * (sr * sl);
  m[5] = height * cl;
  m[6] = height * (cr * sl);
  m[7] = 0;

  m[8] = spread * (sr * cl);
  m[9] = spread * -sl;
  m[10] = spread * (cr * cl);
  m[11] = 0;

  m[12] = x;
  m[13] = y;
  m[14] = z;
  m[15] = 1;
  return m;
}

/** Every form the palette can ask for. */
export const FORM_NAMES = Object.freeze(['round', 'spreading', 'conical', 'columnar', 'mound', 'tuft', 'slab']);

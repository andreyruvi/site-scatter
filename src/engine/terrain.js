/**
 * The ground.
 *
 * A heightfield on a regular grid, in metres, with the site's south-west corner
 * at the origin and +Y up. Everything else in the engine asks this module three
 * questions — how high is the ground here, which way does it face, and how
 * steep is it — so those three are the only ones that need to be exactly right.
 *
 * The relief is generated rather than surveyed. That is stated plainly in the
 * interface: this is a tool for laying out planting on a plausible slope, not a
 * substitute for a topographic survey. When a real survey exists, the levels it
 * gives are the ones to use, and the tool takes a flat pad and a mean gradient
 * instead of inventing a landform.
 */

import { createRng } from './rng.js';

export const MAX_RESOLUTION = 192;

/** Value noise on a lattice, smoothed with a quintic fade. */
function lattice(rng, size) {
  const values = new Float32Array(size * size);
  for (let i = 0; i < values.length; i += 1) values[i] = rng.next() * 2 - 1;
  return { size, values };
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

function sampleLattice(grid, x, y) {
  const { size, values } = grid;
  // Wrapping keeps the noise defined for any coordinate without a branch.
  const wrap = (n) => ((n % size) + size) % size;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const at = (ix, iy) => values[wrap(iy) * size + wrap(ix)];
  const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
  const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
  return a + (b - a) * ty;
}

/**
 * Create a site.
 *
 * @param {object} options
 * @param {number} options.size        site width and depth in metres (square)
 * @param {number} options.resolution  grid divisions per side
 * @param {number} options.relief      peak-to-trough height range in metres
 * @param {number} options.gradient    mean fall across the site in per cent
 * @param {number} options.seed        reproducibility
 * @param {object|null} options.pad    {x, z, width, depth} a levelled building pad, metres
 */
export function createTerrain({
  size = 60,
  resolution = 96,
  relief = 4,
  gradient = 4,
  seed = 1,
  pad = null,
} = {}) {
  const res = Math.max(8, Math.min(MAX_RESOLUTION, Math.round(resolution)));
  const rng = createRng(seed);
  const grids = [lattice(rng, 4), lattice(rng, 8), lattice(rng, 16)];
  const heights = new Float32Array((res + 1) * (res + 1));

  let lowest = Infinity;
  let highest = -Infinity;

  for (let j = 0; j <= res; j += 1) {
    for (let i = 0; i <= res; i += 1) {
      const u = i / res;
      const v = j / res;
      // Three octaves, each half the amplitude of the one before it.
      let h = 0;
      h += sampleLattice(grids[0], u * 3, v * 3) * 1.0;
      h += sampleLattice(grids[1], u * 6, v * 6) * 0.5;
      h += sampleLattice(grids[2], u * 12, v * 12) * 0.25;
      h /= 1.75;
      // A steady fall across the site, which is what most plots actually do.
      h = h * (relief / 2) + (v - 0.5) * size * (gradient / 100);
      heights[j * (res + 1) + i] = h;
      if (h < lowest) lowest = h;
      if (h > highest) highest = h;
    }
  }

  const terrain = { size, res, heights, lowest, highest, seed, relief, gradient, pad: null };
  if (pad) levelPad(terrain, pad);
  return terrain;
}

/**
 * Level a rectangle to one height, with a graded margin around it.
 *
 * A building sits on a platform, and the ground is cut and filled to meet it.
 * Skipping this leaves trees growing out of the walls, and leaves the keep-out
 * rule checking a slope that would not exist once the site was formed.
 */
export function levelPad(terrain, pad) {
  const { x, z, width, depth, margin = 3 } = pad;
  const level = pad.level ?? heightAt(terrain, x + width / 2, z + depth / 2);
  const { res, size, heights } = terrain;
  const step = size / res;

  for (let j = 0; j <= res; j += 1) {
    for (let i = 0; i <= res; i += 1) {
      const px = i * step;
      const pz = j * step;
      // Distance outside the rectangle, 0 when inside it.
      const dx = Math.max(x - px, 0, px - (x + width));
      const dz = Math.max(z - pz, 0, pz - (z + depth));
      const outside = Math.hypot(dx, dz);
      if (outside >= margin) continue;
      const k = j * (res + 1) + i;
      // Smooth blend from the pad level to the natural ground over the margin.
      const t = fade(outside / margin);
      heights[k] = level * (1 - t) + heights[k] * t;
    }
  }

  let lowest = Infinity;
  let highest = -Infinity;
  for (const h of heights) {
    if (h < lowest) lowest = h;
    if (h > highest) highest = h;
  }
  terrain.lowest = lowest;
  terrain.highest = highest;
  terrain.pad = { x, z, width, depth, margin, level };
  return terrain;
}

/** Is this point inside the site? */
export function inside(terrain, x, z) {
  return x >= 0 && z >= 0 && x <= terrain.size && z <= terrain.size;
}

/** Ground height at a point, bilinearly interpolated. Clamped at the edges. */
export function heightAt(terrain, x, z) {
  const { res, size, heights } = terrain;
  const step = size / res;
  const fx = Math.max(0, Math.min(res, x / step));
  const fz = Math.max(0, Math.min(res, z / step));
  const i = Math.min(res - 1, Math.floor(fx));
  const j = Math.min(res - 1, Math.floor(fz));
  const tx = fx - i;
  const tz = fz - j;
  const row = res + 1;
  const h00 = heights[j * row + i];
  const h10 = heights[j * row + i + 1];
  const h01 = heights[(j + 1) * row + i];
  const h11 = heights[(j + 1) * row + i + 1];
  const a = h00 + (h10 - h00) * tx;
  const b = h01 + (h11 - h01) * tx;
  return a + (b - a) * tz;
}

/** Unit surface normal at a point, from central differences. */
export function normalAt(terrain, x, z) {
  const step = terrain.size / terrain.res;
  const hL = heightAt(terrain, x - step, z);
  const hR = heightAt(terrain, x + step, z);
  const hD = heightAt(terrain, x, z - step);
  const hU = heightAt(terrain, x, z + step);
  const nx = (hL - hR) / (2 * step);
  const nz = (hD - hU) / (2 * step);
  const len = Math.hypot(nx, 1, nz);
  return [nx / len, 1 / len, nz / len];
}

/** Ground slope at a point, in degrees from horizontal. */
export function slopeAt(terrain, x, z) {
  const n = normalAt(terrain, x, z);
  return (Math.acos(Math.max(-1, Math.min(1, n[1]))) * 180) / Math.PI;
}

/** Slope as a percentage, which is how drainage falls are usually written. */
export function slopePercentAt(terrain, x, z) {
  return Math.tan((slopeAt(terrain, x, z) * Math.PI) / 180) * 100;
}

/** Is this point on the levelled building platform? */
export function onPad(terrain, x, z, inset = 0) {
  const p = terrain.pad;
  if (!p) return false;
  return x >= p.x - inset && x <= p.x + p.width + inset
    && z >= p.z - inset && z <= p.z + p.depth + inset;
}

/**
 * The terrain as a renderable mesh.
 *
 * Returns flat typed arrays ready for a vertex buffer: position, normal, and
 * the slope in degrees per vertex so the shader can tint steep ground without
 * recomputing anything.
 */
export function terrainMesh(terrain) {
  const { res, size } = terrain;
  const row = res + 1;
  const count = row * row;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const slopes = new Float32Array(count);
  const step = size / res;

  for (let j = 0; j <= res; j += 1) {
    for (let i = 0; i <= res; i += 1) {
      const k = j * row + i;
      const x = i * step;
      const z = j * step;
      positions[k * 3] = x;
      positions[k * 3 + 1] = terrain.heights[k];
      positions[k * 3 + 2] = z;
      const n = normalAt(terrain, x, z);
      normals[k * 3] = n[0];
      normals[k * 3 + 1] = n[1];
      normals[k * 3 + 2] = n[2];
      slopes[k] = (Math.acos(Math.max(-1, Math.min(1, n[1]))) * 180) / Math.PI;
    }
  }

  const indices = new Uint32Array(res * res * 6);
  let at = 0;
  for (let j = 0; j < res; j += 1) {
    for (let i = 0; i < res; i += 1) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices[at] = a; indices[at + 1] = c; indices[at + 2] = b;
      indices[at + 3] = b; indices[at + 4] = c; indices[at + 5] = d;
      at += 6;
    }
  }

  return { positions, normals, slopes, indices, vertexCount: count };
}

/** Site area in square metres. Square sites only, which is stated in the interface. */
export function siteArea(terrain) {
  return terrain.size * terrain.size;
}

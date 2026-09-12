/**
 * Where on the ground did the pointer land?
 *
 * A heightfield has a cheap exact answer, so no acceleration structure is
 * needed: march along the ray one grid cell at a time and, in the first cell
 * where the ray passes below the surface, solve for the crossing. That is
 * accurate to within the interpolation the heightfield already uses, and it
 * cannot miss a hill the way a fixed-step march can, because the step is the
 * cell size.
 */

import { heightAt, inside } from './terrain.js';

const EPS = 1e-6;

/** Where a ray crosses a horizontal plane at height y, or null. */
export function rayPlane(origin, dir, y = 0) {
  if (Math.abs(dir[1]) < EPS) return null;
  const t = (y - origin[1]) / dir[1];
  if (t < 0) return null;
  return {
    t,
    point: [origin[0] + dir[0] * t, y, origin[2] + dir[2] * t],
  };
}

/**
 * The entry and exit distances where a ray overlaps the site's bounding box.
 * Returns null when the ray misses it entirely.
 */
export function rayBounds(terrain, origin, dir) {
  const min = [0, terrain.lowest - 1, 0];
  const max = [terrain.size, terrain.highest + 1, terrain.size];
  let near = 0;
  let far = Infinity;

  for (let a = 0; a < 3; a += 1) {
    if (Math.abs(dir[a]) < EPS) {
      if (origin[a] < min[a] || origin[a] > max[a]) return null;
      continue;
    }
    let t0 = (min[a] - origin[a]) / dir[a];
    let t1 = (max[a] - origin[a]) / dir[a];
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) return null;
  }
  return { near, far };
}

/**
 * Intersect a ray with the ground.
 *
 * @returns {{t: number, point: number[]} | null}
 */
export function rayTerrain(terrain, origin, dir, { maxDistance = 5000 } = {}) {
  const box = rayBounds(terrain, origin, dir);
  if (!box) return null;

  const step = terrain.size / terrain.res;
  // Sub-cell stepping along the ray, so a cell entered at a shallow angle is
  // still sampled more than once.
  const horizontal = Math.hypot(dir[0], dir[2]);
  const march = horizontal > EPS ? (step * 0.5) / horizontal : step * 0.5;

  const at = (t) => {
    const x = origin[0] + dir[0] * t;
    const z = origin[2] + dir[2] * t;
    return {
      x,
      z,
      y: origin[1] + dir[1] * t,
      ground: heightAt(terrain, x, z),
    };
  };

  let t0 = Math.max(box.near, 0);
  let a = at(t0);
  // Starting underground: the caller is inside the hill, so there is no
  // meaningful surface hit in front of them.
  if (a.y < a.ground) return null;

  const limit = Math.min(box.far, maxDistance);
  let t1 = t0;
  while (t1 < limit) {
    t1 = Math.min(t1 + march, limit);
    const b = at(t1);
    if (b.y <= b.ground) {
      // Bisect the crossing. Twenty halvings takes the error well below a
      // millimetre for any site this tool handles.
      let lo = t0;
      let hi = t1;
      for (let k = 0; k < 20; k += 1) {
        const mid = (lo + hi) / 2;
        const m = at(mid);
        if (m.y <= m.ground) hi = mid;
        else lo = mid;
      }
      const hit = at(hi);
      return { t: hi, point: [hit.x, hit.ground, hit.z] };
    }
    t0 = t1;
    a = b;
  }
  return null;
}

/**
 * Where the pointer is aiming, whether or not it is over the ground.
 *
 * Painting near the horizon would otherwise do nothing at all, with no
 * explanation. Falling back to the site's mean level keeps the brush visible
 * and tells the caller the point was not a real surface hit.
 */
export function pickGround(terrain, origin, dir) {
  const hit = rayTerrain(terrain, origin, dir);
  if (hit) return { ...hit, onTerrain: true, inSite: inside(terrain, hit.point[0], hit.point[2]) };
  const mid = (terrain.lowest + terrain.highest) / 2;
  const flat = rayPlane(origin, dir, mid);
  if (!flat) return null;
  return {
    ...flat,
    onTerrain: false,
    inSite: inside(terrain, flat.point[0], flat.point[2]),
  };
}

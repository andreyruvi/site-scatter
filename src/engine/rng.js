/**
 * A seeded random number generator.
 *
 * Planting has to be reproducible. If a site looks right and you come back to
 * it tomorrow, the same seed has to lay the same trees in the same places —
 * otherwise the OBJ you exported and the schedule you printed describe a scheme
 * you can no longer reconstruct. `Math.random()` cannot do that, so it is not
 * used anywhere in the engine.
 *
 * mulberry32: small, fast, and good enough for scattering. Not for anything
 * that needs cryptographic randomness, which nothing here does.
 */

/** @returns {{next: () => number, float: (a: number, b: number) => number, int: (a: number, b: number) => number, pick: <T>(items: T[]) => T, gaussian: () => number, fork: (salt: number) => object, seed: number}} */
export function createRng(seed = 1) {
  // A zero seed makes mulberry32 degenerate, and users type 0.
  let state = (Math.floor(Math.abs(seed)) || 1) >>> 0;

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng = {
    seed: (Math.floor(Math.abs(seed)) || 1) >>> 0,
    next,
    float: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    /**
     * Roughly normal, mean 0, sd 1, clamped to ±3.
     * Tree heights in a real planting mix cluster around a mean rather than
     * spreading evenly across the range, so sizes are drawn from this.
     */
    gaussian: () => {
      let u = 0;
      let v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      return Math.max(-3, Math.min(3, g));
    },
    /** An independent stream derived from this one, so one subsystem consuming
     *  extra numbers cannot shift what another subsystem produces. */
    fork: (salt) => createRng((rng.seed ^ Math.imul(salt | 0, 0x9e3779b1)) >>> 0),
  };

  return rng;
}

/**
 * A value drawn from a range, biased toward the middle.
 *
 * `spread` of 0 gives the exact middle, 1 uses most of the range. Nursery stock
 * arrives graded, so a planting of 40 trees is not 40 evenly spaced heights.
 */
export function sizeIn(rng, min, max, spread = 0.7) {
  const mid = (min + max) / 2;
  const half = ((max - min) / 2) * spread;
  return Math.max(min, Math.min(max, mid + (rng.gaussian() / 3) * half));
}

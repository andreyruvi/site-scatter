/**
 * Putting plants on the ground.
 *
 * The whole tool turns on this file. A brush stroke proposes candidate
 * positions; each one is then tested against the rules, and the ones that fail
 * are counted by reason rather than dropped silently. That last part matters
 * more than it sounds: a stroke on a 31° bank with a 25° limit places nothing,
 * and without a reason the tool looks broken instead of looking correct.
 *
 * Spacing is enforced by rejection against a uniform grid index, which is a
 * dart-throwing approximation of a Poisson-disc distribution. It is not a
 * maximal packing and does not try to be — planting laid out by hand is not
 * maximally packed either.
 */

import { heightAt, inside, onPad, slopeAt } from './terrain.js';
import { conflicts, conflictReach } from './species.js';
import { sizeIn } from './rng.js';

const CELL = 1.0;

/** A uniform grid over the site for "is anything near this point" queries. */
export function createIndex(cell = CELL) {
  return { cell, buckets: new Map() };
}

const keyOf = (index, x, z) => `${Math.floor(x / index.cell)},${Math.floor(z / index.cell)}`;

export function indexAdd(index, instance) {
  const k = keyOf(index, instance.x, instance.z);
  const bucket = index.buckets.get(k);
  if (bucket) bucket.push(instance);
  else index.buckets.set(k, [instance]);
}

export function indexRebuild(index, instances) {
  index.buckets.clear();
  for (const i of instances) indexAdd(index, i);
  return index;
}

/** Every instance within `radius` of a point. */
export function near(index, x, z, radius) {
  const reach = Math.ceil(radius / index.cell);
  const cx = Math.floor(x / index.cell);
  const cz = Math.floor(z / index.cell);
  const found = [];
  const r2 = radius * radius;
  for (let j = cz - reach; j <= cz + reach; j += 1) {
    for (let i = cx - reach; i <= cx + reach; i += 1) {
      const bucket = index.buckets.get(`${i},${j}`);
      if (!bucket) continue;
      for (const inst of bucket) {
        const dx = inst.x - x;
        const dz = inst.z - z;
        if (dx * dx + dz * dz <= r2) found.push(inst);
      }
    }
  }
  return found;
}

let nextId = 1;
/** Only for tests: makes instance ids predictable. */
export function resetIds(to = 1) {
  nextId = to;
}

/**
 * Would an instance of `species` be allowed at (x, z)?
 *
 * @returns {{ok: true} | {ok: false, reason: string, detail: string}}
 */
export function testPosition({
  terrain, index, species, x, z, keepOut = 0, speciesOf, reach = null,
}) {
  if (!inside(terrain, x, z)) {
    return { ok: false, reason: 'outside', detail: 'beyond the site boundary' };
  }

  const slope = slopeAt(terrain, x, z);
  if (slope > species.maxSlope) {
    return {
      ok: false,
      reason: 'slope',
      detail: `ground is ${slope.toFixed(0)}°, limit for this type is ${species.maxSlope.toFixed(0)}°`,
    };
  }

  if (keepOut > 0 && onPad(terrain, x, z, keepOut) && species.category !== 'hard') {
    return {
      ok: false,
      reason: 'keepout',
      detail: `within ${keepOut} m of the building`,
    };
  }

  // Spacing only applies between types that actually compete for the position,
  // and the search has to reach as far as the widest-spaced of those — see
  // conflictReach.
  const search = Math.max(reach ?? conflictReach(species), 0.1);
  const neighbours = near(index, x, z, search);
  for (const other of neighbours) {
    const otherSpecies = speciesOf(other.key);
    if (!conflicts(species, otherSpecies)) continue;
    const required = Math.max(species.spacing, otherSpecies ? otherSpecies.spacing : 0);
    const d = Math.hypot(other.x - x, other.z - z);
    if (d < required) {
      return {
        ok: false,
        reason: 'spacing',
        detail: `${d.toFixed(2)} m from an existing plant, ${required.toFixed(2)} m required`,
      };
    }
  }

  return { ok: true };
}

/**
 * Stamp one brush position.
 *
 * @param {object} options
 * @param {object} options.terrain
 * @param {object} options.index      the live spatial index (mutated)
 * @param {object} options.species    already carrying the user's overrides
 * @param {number[]} options.at       [x, z] brush centre in metres
 * @param {number} options.radius     brush radius in metres
 * @param {number} options.density    0..1, how full to fill the disc
 * @param {number} options.keepOut    metres around the building pad
 * @param {object} options.rng
 * @param {Function} options.speciesOf
 * @returns {{added: object[], rejected: Record<string, number>, attempts: number}}
 */
export function stamp({
  terrain, index, species, at, radius, density = 0.8, keepOut = 0, rng, speciesOf, palette = null,
}) {
  const [cx, cz] = at;
  // Computed once per stroke rather than per candidate.
  const reach = conflictReach(species, palette || undefined);
  const area = Math.PI * radius * radius;
  const perPlant = Math.max(species.spacing * species.spacing, 0.01);
  // Oversample: rejection sampling needs more darts than slots to fill a disc.
  const target = Math.max(1, Math.round((area / perPlant) * Math.min(1, Math.max(0, density))));
  const attempts = Math.min(4000, Math.max(8, target * 6));

  const added = [];
  const rejected = { slope: 0, spacing: 0, keepout: 0, outside: 0 };

  for (let k = 0; k < attempts && added.length < target; k += 1) {
    // Uniform over the disc: sqrt keeps the centre from being over-weighted.
    const a = rng.next() * Math.PI * 2;
    const r = Math.sqrt(rng.next()) * radius;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;

    const test = testPosition({ terrain, index, species, x, z, keepOut, speciesOf, reach });
    if (!test.ok) {
      rejected[test.reason] = (rejected[test.reason] || 0) + 1;
      continue;
    }

    const height = sizeIn(rng, species.height[0], species.height[1]);
    // Spread tracks height within the type rather than varying independently,
    // because a tall specimen of one species is not also a narrow one.
    const t = species.height[1] > species.height[0]
      ? (height - species.height[0]) / (species.height[1] - species.height[0])
      : 0.5;
    const spread = species.spread[0] + (species.spread[1] - species.spread[0]) * t;

    const instance = {
      id: nextId,
      key: species.key,
      x,
      z,
      y: heightAt(terrain, x, z),
      height,
      spread,
      rot: rng.next() * Math.PI * 2,
      // A little lean, because nothing on a site is perfectly upright.
      lean: species.category === 'tree' ? rng.float(-0.05, 0.05) : 0,
      shade: rng.float(0.85, 1.0),
    };
    nextId += 1;
    added.push(instance);
    indexAdd(index, instance);
  }

  return { added, rejected, attempts, target };
}

/**
 * Remove everything within the brush.
 * @returns {{kept: object[], removed: object[]}}
 */
export function erase(instances, at, radius, { categories = null, speciesOf = null } = {}) {
  const [cx, cz] = at;
  const r2 = radius * radius;
  const kept = [];
  const removed = [];
  for (const inst of instances) {
    const dx = inst.x - cx;
    const dz = inst.z - cz;
    const hit = dx * dx + dz * dz <= r2;
    const inScope = !categories || (speciesOf && categories.includes(speciesOf(inst.key)?.category));
    if (hit && inScope) removed.push(inst);
    else kept.push(inst);
  }
  return { kept, removed };
}

/**
 * A single sentence explaining a stroke that placed little or nothing.
 * Returns null when the stroke went fine and needs no explanation.
 */
export function explainStroke(result, speciesLabelText) {
  const { added, rejected } = result;
  const total = Object.values(rejected).reduce((a, b) => a + b, 0);
  if (added.length > 0 || total === 0) return null;

  const worst = Object.entries(rejected).sort((a, b) => b[1] - a[1])[0];
  if (!worst || worst[1] === 0) return null;
  const reason = {
    slope: 'the ground there is steeper than this type allows',
    spacing: 'that area is already planted at the minimum spacing',
    keepout: 'that area is inside the keep-out around the building',
    outside: 'that is outside the site boundary',
  }[worst[0]];
  return `No ${speciesLabelText.toLowerCase()} placed — ${reason}.`;
}

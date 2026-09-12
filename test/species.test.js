import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPECIES, CATEGORIES, FORMS, speciesByKey, speciesKeys, speciesLabel,
  withOverrides, grouped, conflicts, conflictReach,
} from '../src/engine/species.js';
import { FORM_NAMES } from '../src/engine/geometry.js';

test('every type is internally coherent', () => {
  assert.ok(SPECIES.length >= 8, `only ${SPECIES.length} types`);
  for (const s of SPECIES) {
    assert.ok(s.key && s.label, `${s.key} needs a key and a label`);
    assert.ok(Object.keys(CATEGORIES).includes(s.category), `${s.key} has category ${s.category}`);
    assert.ok(FORMS.includes(s.form), `${s.key} has form ${s.form}`);
    assert.ok(s.height[0] > 0 && s.height[1] >= s.height[0], `${s.key} height range`);
    assert.ok(s.spread[0] > 0 && s.spread[1] >= s.spread[0], `${s.key} spread range`);
    assert.ok(s.spacing > 0, `${s.key} spacing`);
    assert.ok(s.maxSlope > 0 && s.maxSlope < 90, `${s.key} slope limit`);
    assert.match(s.canopy, /^#[0-9a-f]{6}$/i, `${s.key} colour`);
  }
});

test('every key is unique', () => {
  assert.equal(new Set(speciesKeys()).size, SPECIES.length);
});

test('every form a type asks for can actually be built', () => {
  for (const s of SPECIES) {
    assert.ok(FORM_NAMES.includes(s.form), `no geometry for form ${s.form} (${s.key})`);
  }
});

test('spacing is never wider than the type it spaces', () => {
  // A spacing much smaller than the spread means canopies overlap heavily,
  // which is fine; a spacing far larger than the spread is a typo.
  for (const s of SPECIES) {
    assert.ok(s.spacing <= s.spread[1] * 2.5,
      `${s.key} spaces at ${s.spacing} m but only spreads to ${s.spread[1]} m`);
  }
});

test('hard landscape sits nearly flat and trees do not have to', () => {
  const paving = speciesByKey('paving');
  const cover = speciesByKey('ground');
  assert.ok(paving.maxSlope < 15, 'paving needs near-level ground');
  assert.ok(cover.maxSlope > paving.maxSlope, 'groundcover copes with more than paving');
});

test('every tree type counts toward canopy and nothing else does', () => {
  for (const s of SPECIES) {
    assert.equal(s.counted === true, s.category === 'tree', `${s.key}`);
  }
});

test('speciesByKey finds a type and returns null for one that does not exist', () => {
  assert.equal(speciesByKey('canopy').key, 'canopy');
  assert.equal(speciesByKey('unicorn'), null);
});

test('speciesLabel uses the base name until it is renamed', () => {
  const base = speciesByKey('canopy');
  assert.equal(speciesLabel(base), 'Large canopy tree');
  assert.equal(speciesLabel(withOverrides(base, { renamed: 'Quercus robur' })), 'Quercus robur');
  assert.equal(speciesLabel(withOverrides(base, { renamed: '   ' })), 'Large canopy tree',
    'blank whitespace is not a rename');
});

test('overrides change the four things a user should be able to change', () => {
  const s = withOverrides(speciesByKey('canopy'), {
    renamed: 'Plane', minHeight: 10, maxHeight: 20, minSpread: 8, maxSpread: 12,
    spacing: 12, maxSlope: 18,
  });
  assert.equal(speciesLabel(s), 'Plane');
  assert.deepEqual(s.height, [10, 20]);
  assert.deepEqual(s.spread, [8, 12]);
  assert.equal(s.spacing, 12);
  assert.equal(s.maxSlope, 18);
});

test('overrides cannot change the form, category or colour', () => {
  const base = speciesByKey('canopy');
  const s = withOverrides(base, { form: 'tuft', category: 'hard', canopy: '#ff0000', counted: false });
  assert.equal(s.form, base.form);
  assert.equal(s.category, base.category);
  assert.equal(s.canopy, base.canopy);
  assert.equal(s.counted, base.counted);
});

test('overrides fall back to the base value when the input is nonsense', () => {
  const base = speciesByKey('shrub');
  const s = withOverrides(base, { spacing: 'abc', maxSlope: NaN, minHeight: undefined });
  assert.equal(s.spacing, base.spacing);
  assert.equal(s.maxSlope, base.maxSlope);
  assert.equal(s.height[0], base.height[0]);
});

test('an inverted range is repaired rather than accepted', () => {
  const s = withOverrides(speciesByKey('canopy'), { minHeight: 15, maxHeight: 5 });
  assert.ok(s.height[1] >= s.height[0], `got ${s.height}`);
  assert.deepEqual(s.height, [15, 15]);
});

test('overrides clamp to values the engine can work with', () => {
  const s = withOverrides(speciesByKey('canopy'), { spacing: -4, maxSlope: 400, minHeight: 0 });
  assert.ok(s.spacing > 0);
  assert.ok(s.maxSlope <= 89);
  assert.ok(s.height[0] > 0);
});

test('withOverrides on nothing returns nothing rather than throwing', () => {
  assert.equal(withOverrides(null, {}), null);
});

test('grouped returns every type exactly once, in category order', () => {
  const groups = grouped();
  assert.deepEqual(groups.map((g) => g.category), Object.keys(CATEGORIES));
  const flat = groups.flatMap((g) => g.species);
  assert.equal(flat.length, SPECIES.length);
  assert.equal(new Set(flat.map((s) => s.key)).size, SPECIES.length);
});

test('grouped carries the user overrides through', () => {
  const groups = grouped({ canopy: { spacing: 11, renamed: 'Lime' } });
  const canopy = groups.flatMap((g) => g.species).find((s) => s.key === 'canopy');
  assert.equal(canopy.spacing, 11);
  assert.equal(speciesLabel(canopy), 'Lime');
});

// ---- What layers over what ----------------------------------------------

test('two of the same type always conflict', () => {
  for (const s of SPECIES) {
    assert.equal(conflicts(s, s), true, `${s.key} should conflict with itself`);
  }
});

test('hard landscape conflicts with everything, including other hard landscape', () => {
  const paving = speciesByKey('paving');
  for (const s of SPECIES) {
    assert.equal(conflicts(paving, s), true, `paving vs ${s.key}`);
    assert.equal(conflicts(s, paving), true, `${s.key} vs paving`);
  }
});

test('planting layers across categories', () => {
  const tree = speciesByKey('canopy');
  const shrub = speciesByKey('shrub');
  const cover = speciesByKey('ground');
  assert.equal(conflicts(tree, shrub), false, 'a shrub grows under a tree');
  assert.equal(conflicts(tree, cover), false, 'so does groundcover');
  assert.equal(conflicts(shrub, cover), false, 'and under a shrub');
});

test('two different trees still conflict, because they share the canopy layer', () => {
  assert.equal(conflicts(speciesByKey('canopy'), speciesByKey('conifer')), true);
  assert.equal(conflicts(speciesByKey('shrub'), speciesByKey('hedge')), true);
});

test('conflicts is symmetric for every pair', () => {
  for (const a of SPECIES) {
    for (const b of SPECIES) {
      assert.equal(conflicts(a, b), conflicts(b, a), `${a.key} / ${b.key}`);
    }
  }
});

test('conflicts with nothing is not a conflict', () => {
  assert.equal(conflicts(null, speciesByKey('canopy')), false);
  assert.equal(conflicts(speciesByKey('canopy'), undefined), false);
});

// ---- The search radius ---------------------------------------------------

test('the search reach covers the widest type it conflicts with', () => {
  const cover = speciesByKey('ground');
  const paving = speciesByKey('paving');
  // Groundcover spaces tightly but conflicts with paving, which does not.
  assert.ok(conflictReach(cover) >= paving.spacing,
    `reach ${conflictReach(cover)} must cover paving at ${paving.spacing}`);
  assert.ok(conflictReach(cover) > cover.spacing, 'and be wider than its own spacing');
});

test('a tree reaches as far as the widest-spaced tree', () => {
  const widest = Math.max(...SPECIES.filter((s) => s.category === 'tree').map((s) => s.spacing));
  assert.equal(conflictReach(speciesByKey('ornamental')), widest);
});

test('the reach never ignores a type it conflicts with', () => {
  for (const s of SPECIES) {
    const reach = conflictReach(s);
    for (const other of SPECIES) {
      if (!conflicts(s, other)) continue;
      const required = Math.max(s.spacing, other.spacing);
      assert.ok(reach >= required,
        `${s.key} reaches ${reach} m but needs ${required} m to see ${other.key}`);
    }
  }
});

test('the reach honours an edited spacing', () => {
  const palette = SPECIES.map((s) => withOverrides(s, s.key === 'paving' ? { spacing: 25 } : {}));
  const cover = palette.find((s) => s.key === 'ground');
  assert.equal(conflictReach(cover, palette), 25);
});

test('the reach of nothing is zero', () => {
  assert.equal(conflictReach(null), 0);
});

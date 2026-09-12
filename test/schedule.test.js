import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrain } from '../src/engine/terrain.js';
import { createRng } from '../src/engine/rng.js';
import { speciesByKey, withOverrides } from '../src/engine/species.js';
import { createIndex, stamp, resetIds } from '../src/engine/scatter.js';
import { summarise, review, coverageArea, SEVERITY } from '../src/engine/schedule.js';

const speciesOf = (key) => speciesByKey(key);

/**
 * A site with some planting on it, built the way the tool builds one.
 *
 * Each type gets its own patch. Painting them all in one disc would be a worse
 * fixture than it looks: hard landscape and planting conflict, so whichever
 * went down first would simply block the other and the schedule would be
 * missing a row for reasons that have nothing to do with what is being tested.
 */
const SPOTS = {
  canopy: { at: [18, 18], radius: 14 },
  conifer: { at: [18, 42], radius: 10 },
  ornamental: { at: [30, 12], radius: 8 },
  columnar: { at: [12, 30], radius: 6 },
  shrub: { at: [42, 20], radius: 10 },
  hedge: { at: [50, 40], radius: 5 },
  ground: { at: [22, 46], radius: 8 },
  paving: { at: [44, 46], radius: 5 },
  gravel: { at: [52, 12], radius: 4 },
};

function scheme({ keys = ['canopy', 'shrub'], seed = 5, pad = null, keepOut = 0 } = {}) {
  const terrain = createTerrain({
    size: 60, resolution: 64, relief: 3, gradient: 2, seed: 2, pad,
  });
  resetIds(1);
  const index = createIndex();
  const rng = createRng(seed);
  const instances = [];
  for (const key of keys) {
    const species = withOverrides(speciesByKey(key), {});
    const spot = SPOTS[key];
    instances.push(...stamp({
      terrain, index, species, at: spot.at, radius: spot.radius, density: 0.8, keepOut, rng, speciesOf,
    }).added);
  }
  return { terrain, instances, speciesOf, keepOut };
}

const find = (r, category) => r.findings.find((f) => f.category === category);

// ---- Coverage -----------------------------------------------------------

test('coverage of nothing is nothing', () => {
  const terrain = createTerrain({ size: 40, resolution: 32, relief: 0 });
  assert.equal(coverageArea(terrain, [], () => 1), 0);
});

test('one canopy covers about the area of its circle', () => {
  const terrain = createTerrain({ size: 40, resolution: 32, relief: 0 });
  const area = coverageArea(terrain, [{ x: 20, z: 20, spread: 8 }], (i) => i.spread / 2);
  const circle = Math.PI * 16;
  assert.ok(Math.abs(area - circle) / circle < 0.06,
    `${area.toFixed(1)} m² against a true ${circle.toFixed(1)} m²`);
});

test('overlapping canopies are counted once, not twice', () => {
  const terrain = createTerrain({ size: 40, resolution: 32, relief: 0 });
  const one = coverageArea(terrain, [{ x: 20, z: 20, spread: 8 }], (i) => i.spread / 2);
  const stacked = coverageArea(terrain, [
    { x: 20, z: 20, spread: 8 },
    { x: 20, z: 20, spread: 8 },
  ], (i) => i.spread / 2);
  assert.ok(Math.abs(stacked - one) < 1e-9, 'two trees in the same spot cover one canopy');
});

test('coverage is clipped to the site', () => {
  const terrain = createTerrain({ size: 40, resolution: 32, relief: 0 });
  // A big canopy centred on a corner: only a quarter of it is on the site.
  const area = coverageArea(terrain, [{ x: 0, z: 0, spread: 20 }], (i) => i.spread / 2);
  const quarter = (Math.PI * 100) / 4;
  assert.ok(Math.abs(area - quarter) / quarter < 0.1, `${area.toFixed(1)} vs ${quarter.toFixed(1)}`);
});

test('coverage can never exceed the site', () => {
  const terrain = createTerrain({ size: 40, resolution: 32, relief: 0 });
  const many = [];
  for (let x = 0; x <= 40; x += 2) for (let z = 0; z <= 40; z += 2) many.push({ x, z, spread: 6 });
  const area = coverageArea(terrain, many, (i) => i.spread / 2);
  assert.ok(area <= 40 * 40 + 1e-6, `${area} m² on a 1600 m² site`);
});

// ---- The schedule --------------------------------------------------------

test('the schedule has one row per type, with the right count', () => {
  const site = scheme({ keys: ['canopy', 'shrub', 'ground'] });
  const s = summarise(site);
  assert.equal(s.rows.length, 3);
  for (const row of s.rows) {
    const actual = site.instances.filter((i) => i.key === row.key).length;
    assert.equal(row.count, actual, `${row.key}`);
  }
  assert.equal(s.rows.reduce((n, r) => n + r.count, 0), site.instances.length);
});

test('the schedule is ordered trees, shrubs, groundcover, hard landscape', () => {
  const site = scheme({ keys: ['ground', 'paving', 'canopy', 'shrub'] });
  const order = summarise(site).rows.map((r) => r.category);
  assert.deepEqual(order, ['tree', 'shrub', 'ground', 'hard']);
});

test('the height and spread statistics bracket the instances', () => {
  const site = scheme({ keys: ['canopy'] });
  const row = summarise(site).rows[0];
  const heights = site.instances.map((i) => i.height);
  assert.ok(Math.abs(row.height.min - Math.min(...heights)) < 1e-9);
  assert.ok(Math.abs(row.height.max - Math.max(...heights)) < 1e-9);
  assert.ok(row.height.mean >= row.height.min && row.height.mean <= row.height.max);
});

test('the achieved spacing is the real closest pair', () => {
  const site = scheme({ keys: ['canopy'] });
  const row = summarise(site).rows[0];
  let brute = Infinity;
  const list = site.instances;
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      brute = Math.min(brute, Math.hypot(list[i].x - list[j].x, list[i].z - list[j].z));
    }
  }
  assert.ok(Math.abs(row.spacingAchieved - brute) < 1e-9,
    `reported ${row.spacingAchieved}, brute force says ${brute}`);
});

test('the achieved spacing is at least the specified spacing', () => {
  const s = summarise(scheme({ keys: ['canopy', 'shrub', 'ground'] }));
  for (const row of s.rows) {
    if (row.spacingAchieved === null) continue;
    assert.ok(row.spacingAchieved >= row.spacingNominal - 1e-9,
      `${row.label}: ${row.spacingAchieved} against ${row.spacingNominal}`);
  }
});

test('a single plant has no closest pair rather than a spacing of zero', () => {
  const terrain = createTerrain({ size: 40, resolution: 32, relief: 0 });
  const site = {
    terrain,
    instances: [{ id: 1, key: 'canopy', x: 20, y: 0, z: 20, height: 10, spread: 8, rot: 0 }],
    speciesOf,
  };
  assert.equal(summarise(site).rows[0].spacingAchieved, null);
});

test('only trees count toward canopy cover', () => {
  const trees = summarise(scheme({ keys: ['canopy'] })).totals;
  const cover = summarise(scheme({ keys: ['ground'] })).totals;
  assert.ok(trees.canopyArea > 0);
  assert.equal(cover.canopyArea, 0, 'groundcover is not canopy');
  assert.equal(cover.trees, 0);
});

test('hard landscape is measured separately from planting', () => {
  const t = summarise(scheme({ keys: ['paving'] })).totals;
  assert.ok(t.hardArea > 0);
  assert.equal(t.canopyArea, 0);
  assert.ok(t.hardPercent > 0 && t.hardPercent <= 100);
});

test('the percentages are of the real site area', () => {
  const t = summarise(scheme({ keys: ['canopy'] })).totals;
  assert.equal(t.siteArea, 3600);
  assert.ok(Math.abs(t.canopyPercent - (t.canopyArea / 3600) * 100) < 1e-9);
  assert.ok(t.canopyPercent > 0 && t.canopyPercent <= 100);
});

test('an empty site summarises to zeroes rather than throwing', () => {
  const terrain = createTerrain({ size: 40, resolution: 32, relief: 0 });
  const s = summarise({ terrain, instances: [], speciesOf });
  assert.deepEqual(s.rows, []);
  assert.equal(s.totals.plants, 0);
  assert.equal(s.totals.canopyPercent, 0);
});

test('an instance of a type that no longer exists is ignored, not counted', () => {
  const terrain = createTerrain({ size: 40, resolution: 32, relief: 0 });
  const s = summarise({
    terrain,
    instances: [{ id: 1, key: 'unicorn', x: 20, y: 0, z: 20, height: 2, spread: 2, rot: 0 }],
    speciesOf,
  });
  assert.equal(s.rows.length, 0);
  assert.equal(s.totals.trees, 0);
});

// ---- The review ----------------------------------------------------------

test('an empty site reports that every check was skipped', () => {
  const terrain = createTerrain({ size: 40, resolution: 32, relief: 0 });
  const r = review({ terrain, instances: [], speciesOf });
  assert.deepEqual(r.findings, []);
  assert.equal(r.checked.length, 0);
  assert.match(r.skipped[0], /nothing has been planted yet/);
  assert.match(r.summary.verdict, /Nothing planted yet/);
  assert.equal(r.summary.worst, 'clear');
});

test('a clean scheme lists what ran and reports the coverage note', () => {
  const r = review(scheme({ keys: ['canopy', 'shrub'] }));
  assert.ok(r.checked.some((c) => /site boundary/.test(c)));
  assert.ok(r.checked.some((c) => /slope limit/.test(c)));
  assert.ok(r.checked.some((c) => /minimum spacing/.test(c)));
  assert.equal(r.summary.error, 0);
  assert.ok(find(r, 'coverage'), 'coverage is always reported');
});

test('the review always says it does not know your planning standard', () => {
  const r = review(scheme());
  assert.ok(r.skipped.some((s) => /no standard is built in/.test(s)));
  assert.match(find(r, 'coverage').detail, /does not know it and does not check it/);
});

test('the review always says what it cannot see', () => {
  const r = review(scheme());
  assert.ok(r.skipped.some((s) => /soil, drainage and microclimate/.test(s)));
});

test('a plant off the site is an error', () => {
  const site = scheme({ keys: ['shrub'] });
  site.instances.push({ id: 9999, key: 'shrub', x: -5, y: 0, z: 30, height: 1.5, spread: 1.2, rot: 0 });
  const r = review(site);
  const f = find(r, 'outside-site');
  assert.ok(f, 'the off-site plant is reported');
  assert.equal(f.severity, SEVERITY.ERROR);
  assert.equal(r.summary.worst, 'error');
  assert.match(r.summary.verdict, /to fix/);
});

test('a plant left on ground steeper than its limit is a warning that explains why', () => {
  // Plant on the flat, then regenerate the ground steeply underneath it.
  const site = scheme({ keys: ['canopy'] });
  site.terrain = createTerrain({ size: 60, resolution: 64, relief: 0, gradient: 80, seed: 1 });
  const r = review(site);
  const f = find(r, 'over-slope');
  assert.ok(f, 'the over-slope planting is reported');
  assert.equal(f.severity, SEVERITY.WARNING);
  assert.match(f.detail, /regenerated, or the slope limit lowered/);
  assert.match(f.subjects[0], /limit 25°/);
});

test('a spacing lowered after painting is reported against the type', () => {
  const site = scheme({ keys: ['canopy'] });
  // The layout was painted at 8 m; the palette now says 20 m.
  site.speciesOf = (key) => withOverrides(speciesByKey(key), key === 'canopy' ? { spacing: 20 } : {});
  const r = review(site);
  const f = find(r, 'under-spaced');
  assert.ok(f, 'the tightened spacing is reported');
  assert.equal(f.severity, SEVERITY.WARNING);
  assert.match(f.subjects[0], /spacing 20\.00 m/);
});

test('planting inside the keep-out is reported, and hard landscape is not', () => {
  const pad = { x: 20, z: 20, width: 16, depth: 12 };
  const site = scheme({ keys: ['shrub'], pad, keepOut: 0 });
  // Painted with no keep-out, then reviewed with one.
  site.keepOut = 4;
  const r = review(site);
  const f = find(r, 'keepout');
  assert.ok(f, 'the planting against the building is reported');
  assert.match(f.detail, /Hard landscape is exempt/);
});

test('the keep-out check is skipped, with a reason, when there is no building', () => {
  const r = review(scheme({ keys: ['shrub'] }));
  assert.equal(find(r, 'keepout'), undefined);
  assert.ok(r.skipped.some((s) => /no building footprint is set/.test(s)));
});

test('the keep-out check is skipped, with a different reason, when it is zero', () => {
  const r = review(scheme({ keys: ['shrub'], pad: { x: 20, z: 20, width: 10, depth: 10 }, keepOut: 0 }));
  assert.ok(r.skipped.some((s) => /it is set to zero/.test(s)));
});

test('a tree whose mature canopy reaches the building is a note, not a warning', () => {
  const pad = { x: 20, z: 20, width: 16, depth: 12 };
  const terrain = createTerrain({ size: 60, resolution: 64, relief: 0, gradient: 0, seed: 1, pad });
  const site = {
    terrain,
    // 3 m from the wall with a 10 m spread, so 5 m of canopy overhangs it.
    instances: [{ id: 1, key: 'canopy', x: 39, y: 0, z: 26, height: 12, spread: 10, rot: 0 }],
    speciesOf,
    keepOut: 2,
  };
  const r = review(site);
  const f = find(r, 'canopy-overhang');
  assert.ok(f, 'the overhang is reported');
  assert.equal(f.severity, SEVERITY.NOTE);
  assert.match(f.detail, /shading a south elevation is often the point/);
});

test('a tree well clear of the building produces no overhang note', () => {
  const pad = { x: 20, z: 20, width: 10, depth: 10 };
  const terrain = createTerrain({ size: 60, resolution: 64, relief: 0, gradient: 0, seed: 1, pad });
  const r = review({
    terrain,
    instances: [{ id: 1, key: 'canopy', x: 55, y: 0, z: 55, height: 10, spread: 8, rot: 0 }],
    speciesOf,
    keepOut: 2,
  });
  assert.equal(find(r, 'canopy-overhang'), undefined);
});

test('findings come back worst first', () => {
  const site = scheme({ keys: ['canopy', 'shrub'] });
  site.instances.push({ id: 9999, key: 'shrub', x: -5, y: 0, z: 30, height: 1.5, spread: 1.2, rot: 0 });
  const r = review(site);
  const rank = { error: 0, warning: 1, note: 2 };
  for (let i = 1; i < r.findings.length; i += 1) {
    assert.ok(rank[r.findings[i].severity] >= rank[r.findings[i - 1].severity], 'sorted by severity');
  }
  assert.equal(r.findings[0].severity, 'error');
});

test('the verdict counts what was found', () => {
  const clean = review(scheme({ keys: ['canopy'] }));
  assert.match(clean.summary.verdict, /Nothing flagged/);

  const site = scheme({ keys: ['canopy'] });
  site.instances.push({ id: 9999, key: 'canopy', x: -5, y: 0, z: 30, height: 10, spread: 8, rot: 0 });
  assert.match(review(site).summary.verdict, /1 thing to fix/);
});

test('the summary carries the totals as well as the counts', () => {
  const r = review(scheme({ keys: ['canopy', 'paving'] }));
  assert.ok(r.summary.plants > 0);
  assert.ok(r.summary.trees > 0);
  assert.equal(r.summary.siteArea, 3600);
  assert.ok(r.summary.canopyPercent > 0);
  assert.ok(r.summary.hardPercent > 0);
  assert.ok(r.schedule.rows.length === 2, 'the schedule comes back with the review');
});

test('every finding names the sheets it is about, capped so the list stays readable', () => {
  const site = scheme({ keys: ['shrub'] });
  for (let i = 0; i < 50; i += 1) {
    site.instances.push({ id: 10000 + i, key: 'shrub', x: -5 - i * 0.1, y: 0, z: 30, height: 1.5, spread: 1.2, rot: 0 });
  }
  const f = find(review(site), 'outside-site');
  assert.match(f.title, /5[0-9] plants outside/);
  assert.ok(f.subjects.length <= 12, `listed ${f.subjects.length} subjects`);
});

/**
 * The numbers that come off the scheme.
 *
 * A planting layout is only half the job; the other half is the schedule that
 * goes on the drawing — how many of each type, at what sizes, covering how
 * much of the site. This module produces that, and it produces findings the
 * same way a drawing check does: things worth looking at, each with a severity,
 * and an explicit list of what was *not* checked.
 *
 * What it deliberately does not do is judge the scheme against anybody's
 * standard. It reports that canopy cover is 14% of the site; whether 14% is
 * enough is a question about your local planning policy, which this tool does
 * not know and should not pretend to.
 */

import { inside, onPad, siteArea, slopeAt } from './terrain.js';
import { speciesLabel } from './species.js';

export const SEVERITY = Object.freeze({ ERROR: 'error', WARNING: 'warning', NOTE: 'note' });
const ORDER = { error: 0, warning: 1, note: 2 };
/** Schedule rows read top-down the way a planting schedule is written. */
const ORDER_CATEGORY = { tree: 0, shrub: 1, ground: 2, hard: 3 };

/** Cell size for the coverage raster, in metres. */
const COVER_CELL = 0.5;

function stats(values) {
  if (!values.length) return { min: 0, mean: 0, max: 0 };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, mean: sum / values.length, max };
}

/**
 * Closest centre-to-centre distance actually achieved within a group.
 *
 * Bucketed, because a dense groundcover stroke is tens of thousands of plants
 * and the honest O(n²) version stalls the page. The rings expand until the
 * best distance found is provably closer than anything still unscanned: after
 * scanning every cell within `ring` of the instance's own cell, nothing
 * outside can be nearer than `ring * cell`. Stopping at a fixed ring instead —
 * which the first version of this did — reports "no closest pair" for any type
 * spaced wider than the ring, which is most of the trees.
 */
function closestPair(group, cell = 2) {
  if (group.length < 2) return null;

  const buckets = new Map();
  let minI = Infinity;
  let maxI = -Infinity;
  let minJ = Infinity;
  let maxJ = -Infinity;
  for (const inst of group) {
    const ci = Math.floor(inst.x / cell);
    const cj = Math.floor(inst.z / cell);
    minI = Math.min(minI, ci);
    maxI = Math.max(maxI, ci);
    minJ = Math.min(minJ, cj);
    maxJ = Math.max(maxJ, cj);
    const k = `${ci},${cj}`;
    const b = buckets.get(k);
    if (b) b.push(inst);
    else buckets.set(k, [inst]);
  }
  // Beyond this the whole group has been covered, so there is nothing left.
  const maxRing = Math.max(maxI - minI, maxJ - minJ) + 1;

  let best = Infinity;
  for (const inst of group) {
    const ci = Math.floor(inst.x / cell);
    const cj = Math.floor(inst.z / cell);
    let mine = Infinity;
    for (let ring = 1; ring <= maxRing; ring += 1) {
      for (let j = cj - ring; j <= cj + ring; j += 1) {
        for (let i = ci - ring; i <= ci + ring; i += 1) {
          // Only the newly added shell, so earlier cells are not rescanned.
          if (ring > 1 && Math.abs(i - ci) < ring && Math.abs(j - cj) < ring) continue;
          const b = buckets.get(`${i},${j}`);
          if (!b) continue;
          for (const other of b) {
            if (other === inst) continue;
            const d = Math.hypot(other.x - inst.x, other.z - inst.z);
            if (d < mine) mine = d;
          }
        }
      }
      // Anything unscanned is at least `ring * cell` away.
      if (mine <= ring * cell) break;
    }
    if (mine < best) best = mine;
  }
  return Number.isFinite(best) ? best : null;
}

/**
 * Ground covered by a set of instances, as a true union rather than a sum of
 * circles. Overlapping canopies are the normal case, and summing them would
 * report 130% cover on a site that is plainly not fully shaded.
 */
export function coverageArea(terrain, instances, radiusOf) {
  if (!instances.length) return 0;
  const n = Math.ceil(terrain.size / COVER_CELL);
  const marked = new Uint8Array(n * n);
  for (const inst of instances) {
    const r = radiusOf(inst);
    if (r <= 0) continue;
    const i0 = Math.max(0, Math.floor((inst.x - r) / COVER_CELL));
    const i1 = Math.min(n - 1, Math.floor((inst.x + r) / COVER_CELL));
    const j0 = Math.max(0, Math.floor((inst.z - r) / COVER_CELL));
    const j1 = Math.min(n - 1, Math.floor((inst.z + r) / COVER_CELL));
    const r2 = r * r;
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        // Cell centre inside the canopy circle.
        const cx = (i + 0.5) * COVER_CELL;
        const cz = (j + 0.5) * COVER_CELL;
        const dx = cx - inst.x;
        const dz = cz - inst.z;
        if (dx * dx + dz * dz <= r2) marked[j * n + i] = 1;
      }
    }
  }
  let cells = 0;
  for (const m of marked) cells += m;
  return cells * COVER_CELL * COVER_CELL;
}

/**
 * The planting schedule.
 *
 * @param {object} site {terrain, instances, speciesOf, keepOut}
 */
export function summarise(site) {
  const { terrain, instances, speciesOf } = site;
  const area = siteArea(terrain);

  const byKey = new Map();
  for (const inst of instances) {
    const list = byKey.get(inst.key);
    if (list) list.push(inst);
    else byKey.set(inst.key, [inst]);
  }

  const rows = [];
  for (const [key, group] of byKey) {
    const species = speciesOf(key);
    if (!species) continue;
    const heights = group.map((i) => i.height);
    const spreads = group.map((i) => i.spread);
    rows.push({
      key,
      label: speciesLabel(species),
      category: species.category,
      count: group.length,
      height: stats(heights),
      spread: stats(spreads),
      spacingNominal: species.spacing,
      spacingAchieved: closestPair(group),
      counted: species.counted === true,
      // Per-type footprint, as a union so a dense mass is not over-reported.
      area: coverageArea(terrain, group, (i) => i.spread / 2),
    });
  }

  rows.sort((a, b) => (ORDER_CATEGORY[a.category] - ORDER_CATEGORY[b.category])
    || b.count - a.count
    || a.label.localeCompare(b.label));

  const trees = instances.filter((i) => speciesOf(i.key)?.counted);
  const hard = instances.filter((i) => speciesOf(i.key)?.category === 'hard');
  const canopyArea = coverageArea(terrain, trees, (i) => i.spread / 2);
  const hardArea = coverageArea(terrain, hard, (i) => i.spread / 2);

  return {
    rows,
    totals: {
      plants: instances.length,
      trees: trees.length,
      siteArea: area,
      canopyArea,
      canopyPercent: area > 0 ? (canopyArea / area) * 100 : 0,
      hardArea,
      hardPercent: area > 0 ? (hardArea / area) * 100 : 0,
      types: rows.length,
    },
  };
}

/**
 * Check the scheme against itself.
 *
 * Everything here is verifiable from the model: a plant that ended up on
 * ground steeper than its own limit, two plants closer than their own spacing,
 * something off the site. Those can all happen legitimately — regenerate the
 * terrain under an existing planting, or lower a spacing after painting, and
 * the layout no longer satisfies the rules it was made under.
 *
 * @returns {{findings: object[], checked: string[], skipped: string[], summary: object}}
 */
export function review(site) {
  const { terrain, instances, speciesOf, keepOut = 0 } = site;
  const findings = [];
  const checked = [];
  const skipped = [];

  const add = (severity, category, title, detail, subjects = []) => {
    findings.push({ severity, category, title, detail, subjects, count: subjects.length });
  };

  const schedule = summarise(site);

  if (!instances.length) {
    return {
      findings: [],
      checked: [],
      skipped: ['every check — nothing has been planted yet'],
      summary: { ...schedule.totals, verdict: 'Nothing planted yet.', worst: 'clear', error: 0, warning: 0, note: 0 },
      schedule,
    };
  }

  // ---- Off the site ------------------------------------------------------
  checked.push('everything is inside the site boundary');
  const off = instances.filter((i) => !inside(terrain, i.x, i.z));
  if (off.length) {
    add(SEVERITY.ERROR, 'outside-site',
      `${off.length} plant${off.length === 1 ? '' : 's'} outside the site boundary`,
      'These will not appear on a plan clipped to the site, and they should not be in a schedule quantity.',
      off.slice(0, 12).map((i) => `${speciesLabel(speciesOf(i.key))} at ${i.x.toFixed(1)}, ${i.z.toFixed(1)}`));
  }

  // ---- Slope -------------------------------------------------------------
  checked.push('each type sits within its own slope limit');
  const steep = [];
  for (const inst of instances) {
    const species = speciesOf(inst.key);
    if (!species) continue;
    const s = slopeAt(terrain, inst.x, inst.z);
    if (s > species.maxSlope + 0.5) steep.push({ inst, species, slope: s });
  }
  if (steep.length) {
    add(SEVERITY.WARNING, 'over-slope',
      `${steep.length} plant${steep.length === 1 ? '' : 's'} on ground steeper than their type allows`,
      'The usual cause is that the ground was regenerated, or the slope limit lowered, after these were placed. Repaint them or raise the limit — the scatter itself never places above the limit.',
      steep.slice(0, 12).map((s) => `${speciesLabel(s.species)} on ${s.slope.toFixed(0)}° (limit ${s.species.maxSlope}°)`));
  }

  // ---- Spacing -----------------------------------------------------------
  checked.push('each type meets its own minimum spacing');
  const tight = schedule.rows.filter((r) => r.spacingAchieved !== null
    && r.spacingAchieved < r.spacingNominal - 0.005);
  if (tight.length) {
    add(SEVERITY.WARNING, 'under-spaced',
      `${tight.length} type${tight.length === 1 ? '' : 's'} closer together than their spacing allows`,
      'Lowering a spacing after painting, or loading a preset saved with a different one, leaves the existing layout tighter than the rule now says.',
      tight.map((r) => `${r.label}: closest pair ${r.spacingAchieved.toFixed(2)} m, spacing ${r.spacingNominal.toFixed(2)} m`));
  }

  // ---- The building ------------------------------------------------------
  if (terrain.pad && keepOut > 0) {
    checked.push(`planting keeps ${keepOut} m clear of the building`);
    const tooClose = instances.filter((i) => {
      const species = speciesOf(i.key);
      return species && species.category !== 'hard' && onPad(terrain, i.x, i.z, keepOut);
    });
    if (tooClose.length) {
      add(SEVERITY.WARNING, 'keepout',
        `${tooClose.length} plant${tooClose.length === 1 ? '' : 's'} inside the keep-out around the building`,
        'Planting hard against a building is a maintenance and damp problem more often than a design choice. Hard landscape is exempt from this check.',
        tooClose.slice(0, 12).map((i) => `${speciesLabel(speciesOf(i.key))} at ${i.x.toFixed(1)}, ${i.z.toFixed(1)}`));
    }
  } else if (!terrain.pad) {
    skipped.push('the building keep-out — no building footprint is set');
  } else {
    skipped.push('the building keep-out — it is set to zero');
  }

  // ---- Trees against the building ---------------------------------------
  if (terrain.pad) {
    checked.push('mature canopy spread against the building');
    const overhang = [];
    for (const inst of instances) {
      const species = speciesOf(inst.key);
      if (!species || !species.counted) continue;
      const p = terrain.pad;
      const dx = Math.max(p.x - inst.x, 0, inst.x - (p.x + p.width));
      const dz = Math.max(p.z - inst.z, 0, inst.z - (p.z + p.depth));
      const gap = Math.hypot(dx, dz);
      if (gap < inst.spread / 2) overhang.push({ inst, species, gap });
    }
    if (overhang.length) {
      add(SEVERITY.NOTE, 'canopy-overhang',
        `${overhang.length} tree${overhang.length === 1 ? '' : 's'} will overhang the building at full spread`,
        'Not necessarily wrong — shading a south elevation is often the point. Worth knowing before the gutters are specified.',
        overhang.slice(0, 12).map((o) => `${speciesLabel(o.species)}, ${o.gap.toFixed(1)} m from the wall, ${(o.inst.spread / 2).toFixed(1)} m radius`));
    }
  }

  // ---- Coverage, reported and not judged --------------------------------
  const t = schedule.totals;
  add(SEVERITY.NOTE, 'coverage',
    `Canopy cover is ${t.canopyPercent.toFixed(1)}% of the site`,
    `${Math.round(t.canopyArea)} m² of ${Math.round(t.siteArea)} m², measured as a union of mature spreads rather than a sum, so overlapping canopies are counted once. Hard landscape covers ${t.hardPercent.toFixed(1)}%. Whether those figures satisfy a planning condition is a question about your local policy — this tool does not know it and does not check it.`,
    []);
  skipped.push('any planning or ordinance requirement — no standard is built in');
  skipped.push('species suitability, soil, drainage and microclimate — all outside what a layout tool can see');

  findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.category.localeCompare(b.category));

  const counts = { error: 0, warning: 0, note: 0 };
  for (const f of findings) counts[f.severity] += 1;

  let verdict;
  if (counts.error) {
    verdict = `${counts.error} thing${counts.error === 1 ? '' : 's'} to fix`
      + (counts.warning ? `, and ${counts.warning} to look at.` : '.');
  } else if (counts.warning) {
    verdict = `${counts.warning} thing${counts.warning === 1 ? '' : 's'} worth looking at.`;
  } else {
    verdict = `${t.plants} plant${t.plants === 1 ? '' : 's'} across ${t.types} type${t.types === 1 ? '' : 's'}. Nothing flagged.`;
  }

  return {
    findings,
    checked,
    skipped,
    schedule,
    summary: {
      ...t,
      ...counts,
      verdict,
      worst: counts.error ? 'error' : counts.warning ? 'warning' : counts.note ? 'note' : 'clear',
    },
  };
}

/**
 * What you can paint.
 *
 * These are **generic planting types, not a plant database.** Every entry is a
 * form with a size range and a spacing, and every number is editable in the
 * interface. That is deliberate: a tool that shipped named cultivars with
 * authoritative-looking mature heights would be wrong for somebody's climate on
 * day one, and wrong in a way that ends up on a drawing. Choose the form, set
 * the numbers your planting schedule actually specifies, and rename it to the
 * species you are using.
 *
 * `spacing` is minimum centre-to-centre in metres and the scatter enforces it.
 * `maxSlope` is the steepest ground the type is placed on, in degrees — a limit
 * about establishment and maintenance access, not about what can physically be
 * planted, so it is a default to change rather than a rule to trust.
 */

/** @typedef {'tree'|'shrub'|'ground'|'hard'} Category */

export const CATEGORIES = Object.freeze({
  tree: 'Trees',
  shrub: 'Shrubs and hedging',
  ground: 'Groundcover',
  hard: 'Hard landscape',
});

/**
 * Forms the geometry builder knows how to make. The form decides the shape,
 * not the size — a columnar form at 3 m and at 12 m is the same silhouette.
 */
export const FORMS = Object.freeze(['round', 'conical', 'columnar', 'spreading', 'mound', 'tuft', 'slab']);

function type(key, label, category, form, extra) {
  return Object.freeze({
    key, label, category, form, renamed: null, ...extra,
  });
}

export const SPECIES = Object.freeze([
  type('canopy', 'Large canopy tree', 'tree', 'spreading', {
    height: [8, 14], spread: [6, 10], spacing: 8, maxSlope: 25,
    canopy: '#4a6b3f', trunk: '#6b5a48', counted: true,
  }),
  type('ornamental', 'Medium ornamental tree', 'tree', 'round', {
    height: [4, 7], spread: [3, 5], spacing: 5, maxSlope: 30,
    canopy: '#63834f', trunk: '#71604d', counted: true,
  }),
  type('conifer', 'Conifer', 'tree', 'conical', {
    height: [6, 11], spread: [2.5, 4], spacing: 4.5, maxSlope: 32,
    canopy: '#33503d', trunk: '#5d4f40', counted: true,
  }),
  type('columnar', 'Columnar tree', 'tree', 'columnar', {
    height: [6, 10], spread: [1.2, 2], spacing: 2.5, maxSlope: 30,
    canopy: '#4f6d46', trunk: '#6a5949', counted: true,
  }),
  type('shrub', 'Shrub mass', 'shrub', 'mound', {
    height: [1, 2.2], spread: [1, 1.8], spacing: 1.2, maxSlope: 35,
    canopy: '#6f8a54', trunk: null, counted: false,
  }),
  type('hedge', 'Clipped hedge', 'shrub', 'slab', {
    height: [1.2, 2], spread: [0.7, 0.9], spacing: 0.5, maxSlope: 30,
    canopy: '#3f5c3a', trunk: null, counted: false,
  }),
  type('ground', 'Groundcover', 'ground', 'tuft', {
    height: [0.15, 0.45], spread: [0.3, 0.6], spacing: 0.35, maxSlope: 45,
    canopy: '#7ba054', trunk: null, counted: false,
  }),
  type('paving', 'Paving', 'hard', 'slab', {
    height: [0.04, 0.06], spread: [0.85, 0.95], spacing: 0.9, maxSlope: 8,
    canopy: '#9a958c', trunk: null, counted: false,
  }),
  type('gravel', 'Gravel', 'hard', 'mound', {
    height: [0.05, 0.09], spread: [0.35, 0.6], spacing: 0.32, maxSlope: 12,
    canopy: '#a8a196', trunk: null, counted: false,
  }),
]);

const BY_KEY = new Map(SPECIES.map((s) => [s.key, s]));

export function speciesByKey(key) {
  return BY_KEY.get(key) || null;
}

export function speciesKeys() {
  return SPECIES.map((s) => s.key);
}

/** The display name, honouring a rename the user has made. */
export function speciesLabel(species) {
  return (species.renamed || '').trim() || species.label;
}

/**
 * Apply the user's edits to a base type.
 *
 * Only the four things worth changing are accepted — the name, the size range,
 * the spacing and the slope limit. The form, the category and the colour stay
 * with the base type, because those are what the geometry and the rules key off.
 */
export function withOverrides(species, overrides = {}) {
  if (!species) return null;
  const num = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const minH = Math.max(0.05, num(overrides.minHeight, species.height[0]));
  const maxH = Math.max(minH, num(overrides.maxHeight, species.height[1]));
  const minS = Math.max(0.05, num(overrides.minSpread, species.spread[0]));
  const maxS = Math.max(minS, num(overrides.maxSpread, species.spread[1]));
  return {
    ...species,
    renamed: typeof overrides.renamed === 'string' ? overrides.renamed : species.renamed,
    height: [minH, maxH],
    spread: [minS, maxS],
    spacing: Math.max(0.1, num(overrides.spacing, species.spacing)),
    maxSlope: Math.max(0, Math.min(89, num(overrides.maxSlope, species.maxSlope))),
  };
}

/** Species grouped for a menu, in the order the categories are declared. */
export function grouped(overridesByKey = {}) {
  const order = Object.keys(CATEGORIES);
  return order.map((category) => ({
    category,
    label: CATEGORIES[category],
    species: SPECIES
      .filter((s) => s.category === category)
      .map((s) => withOverrides(s, overridesByKey[s.key] || {})),
  }));
}

/**
 * Do these two types compete for the same piece of ground?
 *
 * Only conflicting pairs are held apart by the minimum spacing, so this
 * decides what may layer and what may not:
 *
 * - **Hard landscape against anything** conflicts. Paving and a shrub cannot
 *   occupy the same square metre, and neither can paving and gravel.
 * - **Within a category** everything conflicts. Two canopy trees do not share
 *   a position, and — the part that is easy to get wrong — two groundcover
 *   plants do not either. An exemption written as "groundcover layers under
 *   other things" swallows groundcover-against-groundcover with it and quietly
 *   disables the spacing rule for the densest type in the palette.
 * - **Across planting categories** nothing conflicts. Shrubs and groundcover
 *   grow under trees; that is what a planted scheme looks like.
 */
export function conflicts(a, b) {
  if (!a || !b) return false;
  if (a.category === 'hard' || b.category === 'hard') return true;
  if (a.category === b.category) return true;
  return false;
}

/**
 * How far the scatter has to look for neighbours before placing this type.
 *
 * The required separation between two plants is the larger of their two
 * spacings, so searching only as far as the *brush* species' own spacing is not
 * enough: groundcover at 0.35 m spacing would never notice paving at 0.9 m and
 * would be laid 0.6 m into it. The search radius is therefore the largest
 * spacing among every type this one conflicts with.
 *
 * @param {object} species
 * @param {object[]} [all] the live palette, so a user's edited spacing counts
 */
export function conflictReach(species, all = SPECIES) {
  if (!species) return 0;
  let reach = species.spacing;
  for (const other of all) {
    if (conflicts(species, other) && other.spacing > reach) reach = other.spacing;
  }
  return reach;
}

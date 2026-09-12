# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-09-12

First release.

### Added

- **Painting onto a 3D site.** Drag on the ground and the selected planting
  type scatters along the stroke. The brush follows the terrain, and the stroke
  is stamped along the drag so a fast sweep is continuous rather than dotted.
- **Rules enforced while painting**, each with its own reason when it refuses:
  minimum centre-to-centre spacing per type, the steepest ground each type will
  accept, a keep-out distance around the building, and the site boundary. A
  stroke that places nothing says which of those stopped it.
- **Layering that matches how a scheme is actually planted.** Shrubs and
  groundcover grow under trees; two trees never share a position; planting and
  hard landscape are mutually exclusive.
- **Nine generic planting types** across trees, shrubs and hedging,
  groundcover and hard landscape — each an editable form with a height range, a
  spread range, a spacing and a slope limit, renameable to the species you are
  specifying. Deliberately not a plant database.
- **A generated site**: a heightfield from a relief and a mean fall, with a
  levelled building platform blended into the natural ground, so slope limits
  and the keep-out are checked against ground that could actually be formed.
- **A planting schedule**: count, height and spread ranges, specified spacing,
  the closest pair achieved, and the area covered per type. Canopy cover in m²
  and as a percentage of the site, measured as a union of mature spreads rather
  than a sum, so overlapping canopies are counted once.
- **Findings with a severity**, checking the scheme against itself: anything
  outside the boundary, anything left on ground steeper than its own limit, any
  type now closer than its own spacing, planting inside the keep-out, and trees
  whose mature canopy will overhang the building. Every report lists what was
  checked *and what was not*.
- **Exports**: OBJ plus MTL with one group per planting type, the planting
  schedule as CSV, every plant's position as CSV, the view as PNG, and a JSON
  preset that reopens the scheme exactly.
- **A WebGL 2 renderer with no library**: instanced planting, a slope-tinted
  ground with a 5 m grid, planted beds drawn as areas, contact shadows, a sky
  gradient, distance fog, an adjustable sun, and an overlay marking ground too
  steep for the selected type.
- An A4 print sheet carrying the view and the schedule, with severity marked by
  a symbol as well as a colour.
- Light and dark themes, a polite live region for status, labels bound to every
  control, a skip link, and `prefers-reduced-motion` respected.
- **281 tests**, including a contract test that derives every `data-` hook,
  named control, button action, readout, custom property and shader binding
  from the source and checks them against the page, the stylesheet and the
  shaders.
- `npm run serve`, a dependency-free static server, because ES modules do not
  load over `file://`.

### Notes

- Nothing is uploaded, and the page makes no network calls at all. Settings and
  palette edits are remembered locally; the scheme is not, because a preset is
  a better place for it.
- No runtime dependencies and no build step. What is in the repository is what
  the browser runs.
- Original work: not a fork, a template or a rebrand, and nothing vendored.
- The ground is generated rather than surveyed, the planting geometry is an
  indicative silhouette rather than a plant model, and no planning standard is
  built in. Every report says so, and a clean schedule is not an approval.

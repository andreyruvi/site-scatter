# Site Scatter

Paint the planting. Take away the model and the schedule.

[![CI](https://github.com/andreyruvi/site-scatter/actions/workflows/ci.yml/badge.svg)](https://github.com/andreyruvi/site-scatter/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

**[Open the tool →](https://andreyruvi.github.io/site-scatter/)**

Drag across a 3D site and planting grows along the stroke — canopy trees,
conifers, shrub masses, clipped hedge, groundcover, paving, gravel. It refuses
to place anything that breaks the rules you set: minimum spacing between
plants, the steepest ground each type will go on, and a keep-out around the
building. When you are done you get a site model you can drop into Lumion or
3ds Max, and the planting schedule that goes on the drawing.

The point is the second half. Scattering trees is the fun part; the part that
actually takes an afternoon is counting them, working out what they cover, and
noticing that six of them are growing out of the wall.

## What it does

**Painting**

- Drag on the ground to scatter the selected type. The brush follows the
  terrain, and the stroke is stamped along the drag, so a fast sweep does not
  come out as a dotted line.
- Minimum spacing is enforced as you paint. Paint over the same ground twice
  and almost nothing is added, because there is nowhere left that satisfies it.
- Each type has a **steepest ground** it will accept. Nothing is placed above
  it, and if a whole stroke is refused the tool says why rather than appearing
  to do nothing: *"No paving placed — the ground there is steeper than this
  type allows."*
- Planting keeps a distance you choose clear of the building. Hard landscape
  is exempt, because paving does run up to a wall.
- Layering is allowed where it should be: shrubs and groundcover grow under
  trees. It is refused where it should not: two canopy trees never share a
  position, and planting never lands inside paving.
- Erase mode, and <kbd>Ctrl</kbd>+<kbd>Z</kbd> for the last stroke.

**The schedule**

- One row per type: count, height range, spread range, the spacing you
  specified, the closest pair actually achieved, and the ground it covers.
- Canopy cover in m² and as a percentage of the site, measured as a **union of
  mature spreads** rather than a sum, so overlapping canopies are counted once.
  Summing circles is how you end up reporting 130% cover on a site that is
  plainly not fully shaded.
- Findings with a severity, checking the scheme against itself: anything
  outside the boundary, anything left on ground steeper than its own limit,
  any type now closer than its own spacing, planting inside the keep-out, and
  trees whose mature canopy will overhang the building.

**What comes out**

| | |
| --- | --- |
| **OBJ + MTL** | The site model: ground, building, and one group per planting type, so each can be selected and swapped for a real asset in a single operation. Metres, +Y up, stated in the file header. |
| **Planting schedule, CSV** | The table for the drawing. |
| **Positions, CSV** | Every plant with its coordinates, height, spread and rotation — for placing real assets by script, or a Dynamo graph in Revit. |
| **PNG** | The view as you have it framed. |
| **Preset, JSON** | Reopen the scheme exactly, including your edited palette. |

## What it does not do

This matters more than the list above.

- **The ground is generated, not surveyed.** It is a plausible landform from a
  relief and a mean fall, which is enough to lay out planting and to check
  slope limits against. It is not a substitute for levels. Where you have a
  survey, set the relief to zero and enter the fall you measured.
- **The planting geometry is an indicative silhouette, not a plant model.** A
  canopy tree is a stem and three overlapping blobs. It is there so the scheme
  reads correctly — which masses are tall, which are wide, where the canopy
  closes over — and so the OBJ has the right volumes in the right places for
  you to replace.
- **It is not a plant database.** The types are generic forms with editable
  size ranges. A tool that shipped named cultivars with authoritative-looking
  mature heights would be wrong for somebody's climate on day one, and wrong
  in a way that ends up on a drawing. Set the numbers your own schedule
  specifies and rename the type to the species you are using.
- **It does not know your planning policy.** It reports that canopy cover is
  14% of the site. Whether 14% satisfies a condition is a question about your
  local requirements, which the tool has no knowledge of and does not check.
- **It cannot see soil, drainage, microclimate or species suitability.** Every
  report says so, in the list of what was not checked.
- **A clean schedule is not an approval.** The tool checks the numbers you gave
  it against each other. That is all it can do.

## Use it

Nothing to install — [open the hosted version](https://andreyruvi.github.io/site-scatter/).
Your settings and any palette edits are remembered between visits; the scheme
itself is not, because a preset is a better place for it than a browser's
storage quota. Nothing is uploaded: a site layout is a client's plot and a
client's programme, and the only place either belongs is your own machine.

To run it locally:

```sh
git clone https://github.com/andreyruvi/site-scatter.git
cd site-scatter
npm run serve      # then open http://localhost:8080
```

Use the server rather than opening `index.html` directly. The page is built
from ES modules, and browsers refuse to load a module over `file://` — you get
a CORS error and a blank page. `npm run serve` is fifty lines of `node:http`
with no dependencies.

It needs **WebGL 2**, which recent Chrome, Edge, Firefox and Safari all have.
If it is missing the page says so plainly instead of showing a blank canvas.

## Controls

| Input | Action |
| --- | --- |
| **Drag** | Paint the selected type |
| Right-drag, or <kbd>Shift</kbd>-drag, or hold <kbd>Space</kbd> | Orbit |
| Scroll | Zoom |
| Middle-drag, or <kbd>Alt</kbd>-drag | Pan |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> | Undo the last stroke |

## Development

```sh
npm test           # 281 tests, no dependencies
npm run serve      # local static server on :8080
```

The tests are the specification.

```
src/engine/rng.js           seeded randomness, so a scheme is reproducible
src/engine/terrain.js       the heightfield, and the levelled building platform
src/engine/raycast.js       ray against the ground — what the brush is aiming at
src/engine/species.js       the palette, and what may layer over what
src/engine/scatter.js       the rules: spacing, slope, keep-out, boundary
src/engine/geometry.js      the procedural forms, in unit space
src/engine/schedule.js      counts, coverage as a union, findings
src/engine/exporters.js     OBJ, MTL, both CSVs, the preset
src/ui/mat4.js              column-major matrices
src/ui/camera.js            the orbit rig and screen-to-world picking
src/ui/renderer.js          WebGL 2, instanced
src/ui/report.js            the schedule, as real document text
src/main.js                 wiring
```

Three parts are worth reading.

**`scatter.js`** is a dart-throwing approximation of a Poisson-disc
distribution — candidates in the brush disc, rejected against a uniform grid
index. It is not a maximal packing and does not try to be; planting laid out by
hand is not maximally packed either. The subtlety is that the neighbour search
has to reach as far as the *widest-spaced type this one conflicts with*, not
just its own spacing. Search only 0.35 m for groundcover and it never notices
paving at 0.9 m, and gets laid 0.6 m inside it.

**`renderer.js`** draws the whole site in about a dozen calls, whatever is on
it, because everything is instanced. The one real subtlety is the normal
transform: every plant is scaled by its spread in x and z and by its height in
y, and normals transformed by that matrix come out skewed, so tall plants look
lit from the wrong direction. For a rotation R and a diagonal scale S the
correct normal transform is R·S⁻¹, and since the instance matrix already
carries R·S, that is the instance matrix applied to the normal divided
componentwise by S². Hence the `invSq` attribute.

**`test/markup.test.js`** checks the contract between the page and the scripts:
every `data-` hook the JavaScript queries has to exist in `index.html`, every
named control has to be read and every control the scripts read has to exist,
every button action has to have a handler, every live readout has a place in
the page, every custom property the stylesheet uses has to be defined, and
every attribute and uniform the renderer binds has to be declared in a shader.
A rename that would blank a panel fails the suite instead of silently blanking
it in someone's browser.

## Accessibility

The schedule is document text, not a picture of one — selectable, printable and
readable by a screen reader. Status messages go through a polite live region,
every control has a bound label, there is a skip link to the schedule, the
canvas has a name that says what it is for, and the page respects
`prefers-reduced-motion` and `prefers-color-scheme`. In print, severity is
marked with a symbol as well as a colour, so a black-and-white copy still says
which findings matter.

The painting itself needs a pointer. There is no keyboard equivalent yet, and
pretending otherwise would be worse than saying so.

## Provenance

Site Scatter is original work. It is not a fork, a template or a rebrand: no
third-party code, no dependencies, nothing vendored, and no code, geometry or
shader taken from any other project. The WebGL renderer, the terrain, the
scatter rules and the procedural forms were all written from scratch for this
repository. If you find something in here that you believe is yours, please
[open an issue](https://github.com/andreyruvi/site-scatter/issues) and it will
be addressed properly.

## Licence

[MIT](LICENSE) © 2026 Duong L.

# Contributing

Thanks for looking. This is a small, deliberately plain project, and the
constraints below are what keep it small.

## The constraints

1. **No runtime dependencies.** Not one. Not a matrix library, not a 3D
   engine. The tool has to load from a static host, work offline, and still
   open in five years.
2. **No build step.** What is in the repository is what the browser runs.
3. **Nothing leaves the machine.** No uploads, no analytics, no fonts from a
   CDN. A site layout is a client's plot and a client's programme.
4. **The engine stays pure.** Anything under `src/engine/` takes values and
   returns values — no DOM, no WebGL, no globals. That is what makes it
   testable, and it is why the rules are tested and the renderer is not.
5. **No `Math.random()` anywhere in the engine.** A scheme has to rebuild
   identically from its seed, or the OBJ you exported and the schedule you
   printed describe a layout you can no longer reconstruct.
6. **A check reports, it does not judge.** Findings carry a severity, never a
   pass or a fail, and every warning's detail admits its own false-positive
   case.
7. **Say what was not checked.** `checked` and `skipped` are first-class
   output. A report that lists findings while staying silent about what it
   skipped reads as a clean bill of health and is not one.
8. **Do not invent authority.** No plant database, no built-in planning
   standard, no surveyed levels. If the tool cannot know something, it says so
   rather than producing a confident number.

## Getting set up

```sh
git clone https://github.com/andreyruvi/site-scatter.git
cd site-scatter
npm test           # the whole suite, no install needed
npm run serve      # http://localhost:8080
```

There is no `npm install` because there is nothing to install. Node 20 or newer
is required for the built-in test runner.

Open the page through the server, not by double-clicking `index.html`: ES
modules do not load over `file://`.

## Tests

The tests are the specification, so a change to behaviour is a change to a
test.

```sh
npm test                                 # everything
node --test test/scatter.test.js         # one file
```

What good coverage looks like here:

- **Rules**: assert the refusal *and its reason*. A rejected candidate that
  reports the wrong reason is worse than no reason at all, because the message
  goes on the screen.
- **Geometry**: assert the bounds. Every form has to sit on y = 0, be one unit
  tall and fill its unit box — a form that is 0.97 tall silently comes out
  short once it is scaled, and a dome built as a whole sphere puts half of
  every shrub underground. Both of those shipped in the first draft and both
  were caught by bounds assertions.
- **Matrices**: the instance matrix is a `Float32Array` because it goes
  straight into a WebGL uniform, so equality is to single precision, about
  1e-5. Tightening those tolerances does not find bugs; it just fails.
- **Picking**: the round-trip is the property worth pinning — project a point
  on the ground to a pixel, cast a ray back through that pixel, and land within
  a few centimetres of where you started. It is checked at several bearings and
  elevations, because that is where a sign error hides.
- **Negative cases**: what the tool refuses to guess matters as much as what it
  reports. An unreadable preset comes back with a reason, not half-loaded.
- **Markup**: `test/markup.test.js` derives the page-to-script contract from the
  source. If you add a `data-` hook, a control, a button action or a shader
  uniform, it is already being checked.

CI runs the suite on Node 20, 22 and 24, and separately asserts that the
repository declares no dependencies, loads nothing from another host,
references no missing file, and contains no leftover `console.log`.

## Adding a planting type

A new type needs a form the geometry builder can make, a category, a size
range, a spacing, a slope limit and a colour. If it needs a form that does not
exist yet, add it to `buildForm` in unit space — base on y = 0, one unit tall,
one unit across — and the tests will hold you to that.

The category decides the rules, through `conflicts()`. Be careful there: the
exemption that lets groundcover grow under a tree, written one line too broadly,
also switches off spacing between two groundcover plants, which is the densest
type in the palette. There is a test for exactly that.

## Adding a check

A new finding needs four things:

1. A **category** slug, so it can be found in an exported CSV.
2. A **severity**: `error` only for something that is plainly wrong, `warning`
   for something worth looking at, `note` for something worth knowing.
3. A **detail** sentence saying why it might matter *and* when it legitimately
   might not.
4. Either an entry in `checked` when it ran, or an entry in `skipped` with the
   reason when it did not.

It also has to be **verifiable from the model**. "This tree is the wrong
species for the soil" is not a check this tool can make. "This tree is on
ground steeper than its own stated limit" is.

## Reporting a problem

For a wrong finding or a bad layout, the useful report is the **preset** —
save it and attach it. That reconstructs the scheme exactly, which is enough to
write a failing test from, and that is the first thing that will happen.

For a rendering problem, say which browser and which graphics hardware, and
attach a PNG from the Save view button.

## What is out of scope

Some things are not oversights:

- **Real plant models.** Swapping the silhouettes for assets is what the OBJ
  export is for.
- **Surveyed levels.** Importing a point cloud or a contour set is a different
  and much larger tool.
- **Encoding anyone's planning standard.** Built-in standards would be wrong
  somewhere on day one, and wrong invisibly.
- **A dependency.** See constraint 1.

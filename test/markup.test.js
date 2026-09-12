import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The page and the scripts have a contract that nothing enforces at load time.
 * Rename a `data-` hook and a panel simply stops updating; rename a control and
 * a setting silently reads as empty. So the contract is derived from the source
 * here and checked against index.html and the stylesheet.
 */

const html = readFileSync('index.html', 'utf8');
const css = readFileSync('styles/site-scatter.css', 'utf8');

function sourceFiles(dir = 'src') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

const sources = sourceFiles().map((p) => ({ path: p, text: readFileSync(p, 'utf8') }));
const allSource = sources.map((s) => s.text).join('\n');
const main = sources.find((s) => s.path.endsWith('main.js')).text;

/**
 * Every `[data-thing]` the scripts query. A selector built with a template —
 * `[data-readout="${name}"]` — contributes only its attribute name, because
 * the value is not knowable here; those are checked separately below.
 */
const attributeHooks = () => [...new Set(
  [...allSource.matchAll(/\[(data-[a-z-]+)(?:="([^"]*)")?\]/g)]
    .map((m) => (m[2] && !m[2].includes('${') ? `${m[1]}="${m[2]}"` : m[1])),
)].sort();

/** The field names main.js declares it reads. */
function fieldNames() {
  const block = main.match(/const FIELDS = \[([\s\S]*?)\];/);
  assert.ok(block, 'the FIELDS list should be findable in main.js');
  return [...new Set([...block[1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]))].sort();
}

/** The button actions main.js handles. */
function actionNames() {
  const block = main.match(/const actions = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'the actions table should be findable in main.js');
  // The brace distinguishes a method key from a bare call such as `draw();`
  // sitting on its own line inside a handler.
  return [...new Set(
    [...block[1].matchAll(/^\s*(?:async\s+)?'?([a-z-]+)'?\s*\(\)\s*\{/gm)].map((m) => m[1]),
  )].sort();
}

/** The live readouts main.js writes into. */
function readoutNames() {
  return [...new Set([...main.matchAll(/\breadout\('([A-Za-z]+)'/g)].map((m) => m[1]))].sort();
}

test('the source really declares a contract to check', () => {
  assert.ok(sources.length >= 10, `expected the full module set, found ${sources.length}`);
  assert.ok(attributeHooks().length >= 14, `only ${attributeHooks().length} data hooks`);
  assert.ok(fieldNames().length >= 20, `only ${fieldNames().length} field names`);
  assert.ok(actionNames().length >= 10, `only ${actionNames().length} actions`);
  assert.ok(readoutNames().length >= 4, `only ${readoutNames().length} readouts`);
});

test('every data attribute the scripts query exists in the page', () => {
  const missing = attributeHooks().filter((hook) => !html.includes(hook));
  assert.deepEqual(missing, [], `index.html is missing: ${missing.join(', ')}`);
});

test('every field the scripts read exists as a named control', () => {
  const missing = fieldNames().filter((name) => !new RegExp(`name="${name}"`).test(html));
  assert.deepEqual(missing, [], `index.html is missing controls named: ${missing.join(', ')}`);
});

test('every named control is one the scripts read', () => {
  const declared = [...new Set(
    [...html.matchAll(/<(?:input|textarea|select)[^>]*\bname="([A-Za-z]+)"/g)].map((m) => m[1]),
  )];
  const read = new Set(fieldNames());
  const orphans = declared.filter((n) => !read.has(n));
  assert.deepEqual(orphans, [], `controls nothing reads: ${orphans.join(', ')}`);
});

test('every button action has a handler and every handler has a button', () => {
  const inPage = [...new Set([...html.matchAll(/data-action="([a-z-]+)"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(inPage, actionNames());
});

test('every live readout has a place in the page, and every place is written', () => {
  const inPage = [...new Set([...html.matchAll(/data-readout="([A-Za-z]+)"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(inPage, readoutNames());
});

test('every input and select has a label bound to its id', () => {
  const ids = [...html.matchAll(/<(?:input|select|textarea)[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 20, `expected the full control set, found ${ids.length}`);
  const unlabelled = ids.filter((id) => !html.includes(`for="${id}"`));
  assert.deepEqual(unlabelled, [], `controls with no label: ${unlabelled.join(', ')}`);
});

test('the canvas has an accessible name saying what it is for', () => {
  const canvas = html.match(/<canvas[^>]*>/);
  assert.ok(canvas, 'there is a canvas');
  assert.match(canvas[0], /aria-label="[^"]{30,}"/);
});

test('the stylesheet and the entry script are linked', () => {
  assert.match(html, /href="styles\/site-scatter\.css"/);
  assert.match(html, /<script type="module" src="src\/main\.js">/);
});

test('every file the page references exists in the repository', () => {
  const referenced = [...new Set(
    [...html.matchAll(/(?:src|href)="((?:src|styles|assets)\/[^"]+)"/g)].map((m) => m[1]),
  )];
  assert.ok(referenced.length >= 3);
  for (const path of referenced) {
    assert.doesNotThrow(() => readFileSync(path), `index.html references a missing file: ${path}`);
  }
});

test('the status region is announced politely', () => {
  assert.match(html, /data-status[^>]*role="status"/);
  assert.match(html, /data-status[^>]*aria-live="polite"/);
});

test('the page declares a language, a title and a description', () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>[^<]{20,}<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]{60,}">/);
});

test('the page says plainly what the tool does not know', () => {
  // Collapsed, because the wording wraps across lines in the markup.
  const prose = html.replace(/\s+/g, ' ');
  assert.match(prose, /indicative silhouette, not a plant model/i);
  assert.match(prose, /generated rather than surveyed/i);
  assert.match(prose, /does not know your planning policy/i);
  assert.match(prose, /not an approval/i);
});

test('the page tells the user how to orbit, zoom and undo', () => {
  const prose = html.replace(/\s+/g, ' ');
  assert.match(prose, /to orbit/i);
  assert.match(prose, /scroll to zoom/i);
  assert.match(prose, /undoes a stroke/i);
});

test('there is a message for a browser without WebGL 2, not a blank canvas', () => {
  assert.match(html, /data-unsupported/);
  const prose = html.replace(/\s+/g, ' ');
  assert.match(prose, /needs WebGL 2/i);
});

// ---- The stylesheet ------------------------------------------------------

test('the stylesheet defines every severity colour the renderer relies on', () => {
  for (const token of ['--c-error', '--c-warning', '--c-note', '--c-clear']) {
    assert.ok(css.includes(`${token}:`), `${token} is used but never defined`);
    assert.ok(css.includes(`${token}-bg:`), `${token}-bg is used but never defined`);
  }
});

test('every severity has a dark-theme value as well as a light one', () => {
  // The block nests :root inside the media query, so the close is "}\n}" with
  // the inner brace indented.
  const dark = css.match(/@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n\s*\}\n\}/);
  assert.ok(dark, 'there is a dark-theme block');
  for (const token of ['--c-error', '--c-warning', '--c-note', '--c-clear', '--c-ink', '--c-paper']) {
    assert.ok(dark[1].includes(`${token}:`), `${token} is not redefined for dark mode`);
  }
});

test('every custom property the stylesheet uses is also defined', () => {
  const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  const defined = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]));
  const missing = [...used].filter((t) => !defined.has(t) && t !== '--bearing');
  assert.deepEqual(missing, [], `used but never defined: ${missing.join(', ')}`);
});

test('the print sheet marks severity with a symbol, not only a colour', () => {
  assert.match(css, /data-severity="error"\].*::after/s);
  assert.match(css, /content: ' ■'/);
});

test('the print sheet hides the controls and the buttons', () => {
  const print = css.slice(css.indexOf('@media print'));
  for (const selector of ['.controls', '.export-row', '.status', '.masthead__actions']) {
    assert.ok(print.includes(selector), `${selector} should be handled by the print sheet`);
  }
});

test('the stylesheet has no syntax left over from editing', () => {
  // A stray at-rule nested inside a selector list is valid-looking and fatal.
  assert.ok(!/,\s*@media/.test(css), 'an @media cannot appear inside a selector list');
  const opens = (css.match(/\{/g) || []).length;
  const closes = (css.match(/\}/g) || []).length;
  assert.equal(opens, closes, 'braces balance');
});

test('the page loads nothing from another host', () => {
  const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)]
    .map((m) => m[1])
    .filter((url) => !/^https:\/\/github\.com\//.test(url));
  assert.deepEqual(external, [], `the page must not load: ${external.join(', ')}`);
  assert.equal(/@import/.test(css), false, 'the stylesheet must not @import anything');
  assert.equal(/url\(\s*['"]?https?:/.test(css), false, 'the stylesheet must not fetch a remote asset');
});

// ---- The shaders ---------------------------------------------------------

test('every shader attribute and uniform the renderer binds is declared in its shader', () => {
  const renderer = sources.find((s) => s.path.endsWith('renderer.js')).text;
  // Each shader is a template literal named <NAME>_VS / <NAME>_FS.
  const shaders = [...renderer.matchAll(/const (\w+_(?:VS|FS)) = `([\s\S]*?)`;/g)]
    .map((m) => ({ name: m[1], body: m[2] }));
  assert.ok(shaders.length >= 8, `found only ${shaders.length} shaders`);

  const declared = new Set();
  for (const s of shaders) {
    for (const m of s.body.matchAll(/^\s*(?:in|uniform)\s+\w+\s+(\w+)/gm)) declared.add(m[1]);
  }

  const bound = new Set([
    ...[...renderer.matchAll(/p\.attributes\.(\w+)/g)].map((m) => m[1]),
    ...[...renderer.matchAll(/p\.uniforms\.(\w+)/g)].map((m) => m[1]),
  ]);
  const missing = [...bound].filter((name) => !declared.has(name));
  assert.deepEqual(missing, [], `bound but not declared in any shader: ${missing.join(', ')}`);
});

test('every shader declares a version and a float precision where it needs one', () => {
  const renderer = sources.find((s) => s.path.endsWith('renderer.js')).text;
  for (const m of renderer.matchAll(/const (\w+_(?:VS|FS)) = `([\s\S]*?)`;/g)) {
    const [, name, body] = m;
    assert.match(body, /^#version 300 es/, `${name} has no #version line`);
    if (name.endsWith('_FS')) {
      assert.match(body, /precision \w+ float;/, `${name} has no float precision`);
    }
  }
});

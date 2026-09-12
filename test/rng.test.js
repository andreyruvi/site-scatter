import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, sizeIn } from '../src/engine/rng.js';

test('the same seed gives the same sequence', () => {
  const a = createRng(42);
  const b = createRng(42);
  const first = Array.from({ length: 50 }, () => a.next());
  const second = Array.from({ length: 50 }, () => b.next());
  assert.deepEqual(first, second);
});

test('different seeds give different sequences', () => {
  const a = createRng(1);
  const b = createRng(2);
  assert.notEqual(a.next(), b.next());
});

test('a zero seed still produces a usable stream', () => {
  // Users type 0, and mulberry32 degenerates on it, so it is coerced.
  const rng = createRng(0);
  const values = Array.from({ length: 20 }, () => rng.next());
  assert.ok(new Set(values).size > 15, 'the stream is not stuck on one value');
  assert.ok(values.every((v) => v >= 0 && v < 1));
});

test('every value lands in [0, 1)', () => {
  const rng = createRng(7);
  for (let i = 0; i < 5000; i += 1) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1, `${v} is out of range`);
  }
});

test('the mean of a long run is near a half', () => {
  const rng = createRng(99);
  let sum = 0;
  const n = 20000;
  for (let i = 0; i < n; i += 1) sum += rng.next();
  assert.ok(Math.abs(sum / n - 0.5) < 0.02, `mean was ${sum / n}`);
});

test('float and int stay inside their bounds', () => {
  const rng = createRng(3);
  for (let i = 0; i < 500; i += 1) {
    const f = rng.float(-2, 5);
    assert.ok(f >= -2 && f <= 5);
    const n = rng.int(3, 6);
    assert.ok(Number.isInteger(n) && n >= 3 && n <= 6, `${n}`);
  }
});

test('int can reach both ends of its range', () => {
  const rng = createRng(11);
  const seen = new Set();
  for (let i = 0; i < 400; i += 1) seen.add(rng.int(0, 2));
  assert.deepEqual([...seen].sort(), [0, 1, 2]);
});

test('pick returns a member of the list', () => {
  const rng = createRng(5);
  const items = ['a', 'b', 'c'];
  for (let i = 0; i < 100; i += 1) assert.ok(items.includes(rng.pick(items)));
});

test('gaussian is centred, spread about one, and clamped', () => {
  const rng = createRng(17);
  const n = 20000;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i += 1) {
    const g = rng.gaussian();
    assert.ok(g >= -3 && g <= 3, `${g} escaped the clamp`);
    sum += g;
    sumSq += g * g;
  }
  const mean = sum / n;
  const sd = Math.sqrt(sumSq / n - mean * mean);
  assert.ok(Math.abs(mean) < 0.05, `mean was ${mean}`);
  assert.ok(Math.abs(sd - 1) < 0.1, `sd was ${sd}`);
});

test('a forked stream is independent of its parent', () => {
  const parent = createRng(23);
  const a = parent.fork(1);
  const b = parent.fork(1);
  assert.equal(a.next(), b.next(), 'the same salt forks the same stream');

  const other = parent.fork(2);
  assert.notEqual(createRng(23).fork(1).next(), other.next(), 'a different salt differs');
});

test('forking does not depend on how much the parent has consumed', () => {
  const fresh = createRng(23);
  const used = createRng(23);
  for (let i = 0; i < 100; i += 1) used.next();
  assert.equal(fresh.fork(9).next(), used.fork(9).next());
});

test('sizeIn stays within the range', () => {
  const rng = createRng(31);
  for (let i = 0; i < 2000; i += 1) {
    const v = sizeIn(rng, 8, 14);
    assert.ok(v >= 8 && v <= 14, `${v} is outside 8..14`);
  }
});

test('sizeIn clusters around the middle rather than spreading evenly', () => {
  const rng = createRng(37);
  const n = 4000;
  let inner = 0;
  for (let i = 0; i < n; i += 1) {
    const v = sizeIn(rng, 0, 10);
    if (v > 3 && v < 7) inner += 1;
  }
  // Uniform would put 40% in the middle two-fifths; a centred draw puts more.
  assert.ok(inner / n > 0.55, `only ${((inner / n) * 100).toFixed(0)}% landed in the middle`);
});

test('sizeIn with no spread returns the midpoint', () => {
  const rng = createRng(41);
  assert.equal(sizeIn(rng, 2, 6, 0), 4);
});

test('sizeIn handles a zero-width range', () => {
  const rng = createRng(43);
  assert.equal(sizeIn(rng, 5, 5), 5);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmssd, filterEctopic } from '../src/metrics/rmssd.mjs';
import { sleepRegularityIndex } from '../src/metrics/sri.mjs';
import { heartRateReserveFraction, heartRateReserveSeries } from '../src/metrics/heart-rate-reserve.mjs';

// ---------- RMSSD ----------

test('rmssd: constant intervals give exactly zero', () => {
  assert.equal(rmssd([800, 800, 800, 800]), 0);
});

test('rmssd: alternating by d gives exactly d', () => {
  // successive diffs are +d,-d,+d ... so mean square = d^2 and RMSSD = d.
  for (const d of [5, 20, 37.5]) {
    assert.ok(Math.abs(rmssd([800, 800 + d, 800, 800 + d]) - d) < 1e-12, `failed for d=${d}`);
  }
});

test('rmssd: hand-computed example', () => {
  // diffs 20,-10,20 -> squares 400,100,400 -> 900/3 = 300 -> sqrt(300)
  assert.ok(Math.abs(rmssd([800, 820, 810, 830]) - Math.sqrt(300)) < 1e-12);
});

test('rmssd: invariant under a constant offset (depends only on differences)', () => {
  const a = [800, 820, 810, 830];
  const b = a.map((x) => x + 137);
  assert.ok(Math.abs(rmssd(a) - rmssd(b)) < 1e-12);
});

test('rmssd: scales linearly with the intervals', () => {
  const a = [800, 820, 810, 830];
  assert.ok(Math.abs(rmssd(a.map((x) => x * 3)) - 3 * rmssd(a)) < 1e-9);
});

test('rmssd: rejects degenerate input', () => {
  assert.throws(() => rmssd([800]), RangeError);
  assert.throws(() => rmssd('nope'), TypeError);
  assert.throws(() => rmssd([800, 'x']), TypeError);
});

test('filterEctopic: drops a spike, keeps a smooth run', () => {
  const { kept, rejected } = filterEctopic([800, 810, 1600, 805], 0.2);
  assert.equal(rejected, 1);
  assert.deepEqual(kept, [800, 810, 805]);
  assert.equal(filterEctopic([800, 810, 805], 0.2).rejected, 0);
});

// ---------- SRI ----------

test('sri: perfectly regular pattern is exactly 100', () => {
  assert.equal(sleepRegularityIndex([1, 1, 0, 0, 1, 1, 0, 0], 4), 100);
});

test('sri: perfectly inverted pattern is exactly -100', () => {
  assert.equal(sleepRegularityIndex([1, 1, 0, 0, 0, 0, 1, 1], 4), -100);
});

test('sri: half-matching pattern is exactly 0', () => {
  assert.equal(sleepRegularityIndex([1, 1, 0, 0, 1, 1, 1, 1], 4), 0);
});

test('sri: accepts booleans equivalently to 0/1', () => {
  const a = sleepRegularityIndex([1, 1, 0, 0, 1, 1, 0, 0], 4);
  const b = sleepRegularityIndex([true, true, false, false, true, true, false, false], 4);
  assert.equal(a, b);
});

test('sri: output always lies in [-100,100]', () => {
  for (let trial = 0; trial < 200; trial++) {
    const n = 24;
    const epochs = Array.from({ length: n }, () => (Math.random() < 0.5 ? 0 : 1));
    const v = sleepRegularityIndex(epochs, 8);
    assert.ok(v >= -100 && v <= 100, `out of range: ${v}`);
  }
});

test('sri: rejects too-short or malformed input', () => {
  assert.throws(() => sleepRegularityIndex([1, 0, 1, 0], 4), RangeError);
  assert.throws(() => sleepRegularityIndex([1, 0, 1, 0, 1], 0), RangeError);
  assert.throws(() => sleepRegularityIndex([1, 2, 1, 0, 1], 2), TypeError);
});

// ---------- HRR ----------

test('hrr: anchors at rest and max are exact', () => {
  assert.equal(heartRateReserveFraction(60, 60, 180), 0);
  assert.equal(heartRateReserveFraction(180, 60, 180), 1);
});

test('hrr: midpoint is exactly 0.5', () => {
  assert.equal(heartRateReserveFraction(120, 60, 180), 0.5);
});

test('hrr: out-of-range values are returned unclamped by design', () => {
  assert.ok(heartRateReserveFraction(50, 60, 180) < 0);
  assert.ok(heartRateReserveFraction(200, 60, 180) > 1);
});

test('hrr: rejects an impossible range', () => {
  assert.throws(() => heartRateReserveFraction(100, 180, 60), RangeError);
  assert.throws(() => heartRateReserveFraction(100, 60, 60), RangeError);
});

test('hrr: series maps elementwise', () => {
  assert.deepEqual(heartRateReserveSeries([60, 120, 180], 60, 180), [0, 0.5, 1]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { respiratoryRateFromRsa, resampleTachogram } from '../src/metrics/respiratory.mjs';
import {
  rollingMean, rollingStd, zScore, percentileRank, learnBaseline,
} from '../src/metrics/baseline.mjs';

// ---------- respiratory rate ----------

/** RR intervals modulated sinusoidally at a known breathing frequency. */
function synthRr(breathsPerMin, { baseRrMs = 1000, ampMs = 60, seconds = 180 } = {}) {
  const f = breathsPerMin / 60;
  const rr = [];
  let t = 0;
  while (t < seconds) {
    const v = baseRrMs + ampMs * Math.sin(2 * Math.PI * f * t);
    rr.push(v);
    t += v / 1000;
  }
  return rr;
}

test('respiratoryRateFromRsa: recovers a known breathing rate', () => {
  // The decisive test: the estimator must find a frequency that was put in
  // deliberately, which no amount of self-consistent arithmetic can fake.
  for (const bpm of [12, 15, 18, 21]) {
    const r = respiratoryRateFromRsa(synthRr(bpm));
    assert.ok(Math.abs(r.breathsPerMin - bpm) < 0.5,
      `target ${bpm}, got ${r.breathsPerMin.toFixed(2)}`);
  }
});

test('respiratoryRateFromRsa: still close at the lower band edge', () => {
  // 10 breaths/min is 0.1667 Hz, near the 0.15 Hz edge, so tolerance is looser.
  const r = respiratoryRateFromRsa(synthRr(10));
  assert.ok(Math.abs(r.breathsPerMin - 10) < 1.0, `got ${r.breathsPerMin}`);
});

test('respiratoryRateFromRsa: reported peak and rate are consistent', () => {
  const r = respiratoryRateFromRsa(synthRr(15));
  assert.ok(Math.abs(r.peakHz * 60 - r.breathsPerMin) < 1e-9);
});

test('respiratoryRateFromRsa: result stays inside the search band', () => {
  const r = respiratoryRateFromRsa(synthRr(15), { bandLowHz: 0.2, bandHighHz: 0.3 });
  assert.ok(r.peakHz >= 0.2 && r.peakHz <= 0.3 + 1e-9);
});

test('respiratoryRateFromRsa: rejects an impossible band', () => {
  assert.throws(() => respiratoryRateFromRsa(synthRr(15), { bandLowHz: 0.4, bandHighHz: 0.2 }), RangeError);
  // band above Nyquist for the chosen sampling rate
  assert.throws(() => respiratoryRateFromRsa(synthRr(15), { fsHz: 0.5 }), RangeError);
});

test('resampleTachogram: produces a uniform grid of plausible length', () => {
  const rr = synthRr(15, { seconds: 60 });
  const { values, fsHz } = resampleTachogram(rr, 4);
  assert.equal(fsHz, 4);
  const span = rr.reduce((a, b) => a + b, 0) / 1000 - rr[0] / 1000;
  assert.ok(Math.abs(values.length - (span * 4 + 1)) <= 2);
  for (const v of values) assert.ok(Number.isFinite(v));
});

test('resampleTachogram: rejects degenerate input', () => {
  assert.throws(() => resampleTachogram([1000, 1000], 4), RangeError);
  assert.throws(() => resampleTachogram([1000, 1000, 1000], 0), RangeError);
  assert.throws(() => resampleTachogram([1000, -5, 1000], 4), TypeError);
});

// ---------- baseline ----------

test('rollingMean: window of 1 is the identity', () => {
  const s = [3, 9, 4, 7];
  assert.deepEqual(rollingMean(s, 1), s);
});

test('rollingMean: hand-computed trailing window', () => {
  assert.deepEqual(rollingMean([10, 20, 30], 2), [10, 15, 25]);
});

test('rollingStd: a constant series has zero deviation throughout', () => {
  assert.deepEqual(rollingStd([5, 5, 5, 5], 3), [0, 0, 0, 0]);
});

test('rollingStd: Bessel-corrected two-point window', () => {
  // for [10,20]: mean 15, ss = 25+25 = 50, /(2-1) = 50, sqrt = sqrt(50)
  const out = rollingStd([10, 20], 2);
  assert.ok(Math.abs(out[1] - Math.sqrt(50)) < 1e-12);
});

test('zScore: anchors are exact', () => {
  assert.equal(zScore(50, 50, 10), 0);
  assert.equal(zScore(60, 50, 10), 1);
  assert.equal(zScore(30, 50, 10), -2);
});

test('zScore: zero deviation yields zero rather than infinity', () => {
  assert.equal(zScore(50, 50, 0), 0);
  assert.throws(() => zScore(50, 50, -1), RangeError);
});

test('percentileRank: midrank convention, hand-computed', () => {
  assert.equal(percentileRank(3, [1, 2, 3, 4]), 62.5); // (2 + 0.5)/4
  assert.equal(percentileRank(5, [1, 2, 3, 4]), 100);
  assert.equal(percentileRank(0, [1, 2, 3, 4]), 0);
});

test('percentileRank: always within 0..100', () => {
  const hist = [4, 8, 15, 16, 23, 42];
  for (const v of [-5, 4, 10, 42, 99]) {
    const p = percentileRank(v, hist);
    assert.ok(p >= 0 && p <= 100);
  }
});

test('learnBaseline: reports insufficiency instead of inventing a baseline', () => {
  const r = learnBaseline([1], { windowSize: 7 });
  assert.equal(r.sufficient, false);
  assert.equal(r.mean, null);
  assert.equal(r.std, null);
});

test('learnBaseline: uses only the trailing window', () => {
  const r = learnBaseline([100, 100, 100, 10, 20, 30], { windowSize: 3 });
  assert.equal(r.n, 3);
  assert.equal(r.mean, 20);
});

test('learnBaseline: eligibility filter restricts the sample', () => {
  const days = [
    { value: 50, strain: 2 }, { value: 70, strain: 18 },
    { value: 52, strain: 3 }, { value: 54, strain: 1 },
  ];
  const all = learnBaseline(days, { windowSize: 4 });
  const rest = learnBaseline(days, { windowSize: 4, isEligible: (d) => d.strain <= 10 });
  assert.equal(rest.n, 3);
  assert.ok(rest.mean < all.mean, 'excluding the high-strain day should lower the baseline');
});

test('learnBaseline: rejects a nonsense window', () => {
  assert.throws(() => learnBaseline([1, 2, 3], { windowSize: 1 }), RangeError);
});

// ---------- recovery scaffold ----------


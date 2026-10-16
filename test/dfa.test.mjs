import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dfaAlpha, dfaAlpha1, thresholdFromDfa, HRVT_ALPHA } from '../src/metrics/dfa.mjs';

/** Deterministic PRNG so these tests never flake. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (1103515245 * s + 12345) >>> 0; return s / 4294967296; };
}
function gaussian(rnd) {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function whiteNoise(n, seed) {
  const rnd = lcg(seed);
  return Array.from({ length: n }, () => gaussian(rnd));
}
function integrate(series) {
  let a = 0;
  return series.map((v) => (a += v));
}

const WIDE = { minBox: 4, maxBox: 64 };

// ---- DFA against signals with known theoretical exponents ----

test('dfa: white noise has alpha near 0.5', () => {
  // Uncorrelated noise is the canonical alpha = 0.5 case.
  const a = dfaAlpha(whiteNoise(4096, 42), WIDE);
  assert.ok(Math.abs(a - 0.5) < 0.1, 'got ' + a.toFixed(3));
});

test('dfa: a random walk has alpha near 1.5', () => {
  // Brownian motion is the canonical alpha = 1.5 case.
  const a = dfaAlpha(integrate(whiteNoise(4096, 7)), WIDE);
  assert.ok(Math.abs(a - 1.5) < 0.1, 'got ' + a.toFixed(3));
});

test('dfa: integrating a series raises alpha by exactly one', () => {
  // A theoretical property of DFA, independent of any particular signal:
  // alpha(cumsum(x)) = alpha(x) + 1. This checks the estimator's scaling
  // behaviour rather than one hardcoded number.
  for (const seed of [11, 23, 99]) {
    const x = whiteNoise(4096, seed);
    const diff = dfaAlpha(integrate(x), WIDE) - dfaAlpha(x, WIDE);
    assert.ok(Math.abs(diff - 1) < 0.1, 'difference was ' + diff.toFixed(3));
  }
});

test('dfa: a constant series has no fluctuation to fit', () => {
  assert.throws(() => dfaAlpha(new Array(512).fill(800), WIDE), RangeError);
});

test('dfa: rejects too-short series and bad box ranges', () => {
  assert.throws(() => dfaAlpha(whiteNoise(20, 1), WIDE), RangeError);
  assert.throws(() => dfaAlpha(whiteNoise(4096, 1), { minBox: 2, maxBox: 64 }), RangeError);
  assert.throws(() => dfaAlpha(whiteNoise(4096, 1), { minBox: 64, maxBox: 4 }), RangeError);
});

test('dfaAlpha1 uses the conventional 4-16 beat box range', () => {
  const x = whiteNoise(1024, 5);
  assert.equal(dfaAlpha1(x), dfaAlpha(x, { minBox: 4, maxBox: 16 }));
});

// ---- threshold crossing ----

test('thresholdFromDfa: interpolates the crossing linearly', () => {
  const pts = [
    { hr: 120, alpha1: 1.0 },
    { hr: 140, alpha1: 0.5 }, // 0.75 sits exactly halfway
  ];
  const r = thresholdFromDfa(pts, 0.75);
  assert.equal(r.bracketed, true);
  assert.equal(r.hr, 130);
});

test('thresholdFromDfa: finds the first crossing in a descending series', () => {
  const pts = [
    { hr: 100, alpha1: 1.1 }, { hr: 120, alpha1: 0.9 },
    { hr: 140, alpha1: 0.7 }, { hr: 160, alpha1: 0.4 },
  ];
  const first = thresholdFromDfa(pts, HRVT_ALPHA.FIRST_THRESHOLD);
  const second = thresholdFromDfa(pts, HRVT_ALPHA.SECOND_THRESHOLD);
  assert.ok(first.hr > 120 && first.hr < 140);
  assert.ok(second.hr > 140 && second.hr < 160);
  assert.ok(second.hr > first.hr, 'the second threshold must sit above the first');
});

test('thresholdFromDfa: reports non-crossing instead of extrapolating', () => {
  const tooEasy = thresholdFromDfa([{ hr: 90, alpha1: 1.2 }, { hr: 100, alpha1: 1.1 }], 0.75);
  assert.equal(tooEasy.hr, null);
  assert.equal(tooEasy.bracketed, false);
  assert.match(tooEasy.reason, /too low/);

  const tooHard = thresholdFromDfa([{ hr: 170, alpha1: 0.3 }, { hr: 180, alpha1: 0.2 }], 0.75);
  assert.equal(tooHard.hr, null);
  assert.match(tooHard.reason, /too high/);
});

test('thresholdFromDfa: validates its inputs', () => {
  assert.throws(() => thresholdFromDfa([{ hr: 1, alpha1: 1 }], 0.75), RangeError);
  assert.throws(() => thresholdFromDfa([{ hr: 1 }, { hr: 2 }], 0.75), TypeError);
});

// ---- AT / CPT estimation ----


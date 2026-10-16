import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sleepEfficiency, sleepPerformance, wakeAfterSleepOnset, totalSleepTime, stageFractions,
} from '../src/metrics/sleep.mjs';
import {
  banisterTrimp, banisterTrimpSeries, BANISTER_COEFFICIENTS,
  accumulateZoneTime, zonesFromMaxHr, edwardsTrimp,
} from '../src/metrics/training-load.mjs';

// ---------- sleep ratios ----------

test('sleepEfficiency: anchors are exact', () => {
  assert.equal(sleepEfficiency(480, 480), 100);
  assert.equal(sleepEfficiency(0, 480), 0);
  assert.equal(sleepEfficiency(240, 480), 50);
});

test('sleepEfficiency: hand-computed case', () => {
  assert.equal(sleepEfficiency(450, 480), 93.75);
});

test('sleepEfficiency: rejects inconsistent input', () => {
  assert.throws(() => sleepEfficiency(500, 480), RangeError);
  assert.throws(() => sleepEfficiency(100, 0), RangeError);
  assert.throws(() => sleepEfficiency(-1, 480), RangeError);
});

test('sleepPerformance: six hours of eight needed is exactly 75%', () => {
  assert.equal(sleepPerformance(6 * 60, 8 * 60), 75);
});

test('sleepPerformance: exceeds 100 when oversleeping, by design', () => {
  assert.equal(sleepPerformance(600, 480), 125);
});

test('wakeAfterSleepOnset: components reconcile to time in bed', () => {
  const waso = wakeAfterSleepOnset({
    timeInBedMin: 480, totalSleepMin: 430, sleepOnsetLatencyMin: 20, afterFinalAwakeningMin: 10,
  });
  assert.equal(waso, 20);
  assert.equal(430 + 20 + 10 + waso, 480);
});

test('wakeAfterSleepOnset: rejects impossible decomposition', () => {
  assert.throws(() => wakeAfterSleepOnset({
    timeInBedMin: 400, totalSleepMin: 430, sleepOnsetLatencyMin: 20,
  }), RangeError);
});

test('totalSleepTime: counts sleep stages only', () => {
  const iv = [
    { stage: 'awake', minutes: 30 }, { stage: 'light', minutes: 200 },
    { stage: 'deep', minutes: 90 }, { stage: 'rem', minutes: 100 },
  ];
  assert.equal(totalSleepTime(iv), 390);
});

test('stageFractions: sum to exactly 1 over sleep stages', () => {
  const iv = [
    { stage: 'awake', minutes: 30 }, { stage: 'light', minutes: 200 },
    { stage: 'deep', minutes: 90 }, { stage: 'rem', minutes: 100 },
  ];
  const f = stageFractions(iv);
  const sum = Object.values(f).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12, `fractions summed to ${sum}`);
  assert.ok(!('awake' in f));
});

// ---------- Banister TRIMP ----------

const B = BANISTER_COEFFICIENTS.MALE_COHORT;

test('banisterTrimp: zero intensity gives exactly zero load', () => {
  assert.equal(banisterTrimp(60, 0, B), 0);
});

test('banisterTrimp: zero duration gives exactly zero load', () => {
  assert.equal(banisterTrimp(0, 0.7, B), 0);
});

test('banisterTrimp: linear in duration', () => {
  const a = banisterTrimp(30, 0.7, B);
  const b = banisterTrimp(60, 0.7, B);
  assert.ok(Math.abs(b - 2 * a) < 1e-12);
});

test('banisterTrimp: strictly increasing in intensity', () => {
  let prev = -Infinity;
  for (let h = 0; h <= 1.0001; h += 0.05) {
    const v = banisterTrimp(60, h, B);
    assert.ok(v > prev || h === 0, `not increasing at h=${h}`);
    prev = v;
  }
});

test('banisterTrimp: coefficient choice changes the result', () => {
  const m = banisterTrimp(60, 0.7, BANISTER_COEFFICIENTS.MALE_COHORT);
  const f = banisterTrimp(60, 0.7, BANISTER_COEFFICIENTS.FEMALE_COHORT);
  assert.notEqual(m, f);
  assert.ok(m > f, 'larger exponent yields larger load at equal intensity');
});

test('banisterTrimpSeries: agrees with the closed form on a constant series', () => {
  const n = 10;
  const series = new Array(n).fill(0.6);
  const viaSeries = banisterTrimpSeries(series, { sampleSeconds: 60, coefficient: B });
  const viaClosed = banisterTrimp(n, 0.6, B); // n samples of 1 minute each
  assert.ok(Math.abs(viaSeries - viaClosed) < 1e-9);
});

test('banisterTrimp is convex, so intervals exceed steady state at equal mean', () => {
  // f(h) = 0.64*h*e^(b*h) has f'' = 0.64*e^(bh)*(2b + b^2 h) > 0, so by Jensen
  // the mean of f exceeds f of the mean. Interval work must score higher.
  const steady = banisterTrimpSeries(new Array(20).fill(0.5), { sampleSeconds: 60, coefficient: B });
  const interval = banisterTrimpSeries(
    [...new Array(10).fill(0.9), ...new Array(10).fill(0.1)],
    { sampleSeconds: 60, coefficient: B },
  );
  assert.ok(interval > steady, `intervals ${interval} should exceed steady ${steady}`);
});

// ---------- zone accumulation ----------

test('accumulateZoneTime: time is conserved', () => {
  const hr = [80, 120, 140, 160, 180, 95, 200];
  const z = zonesFromMaxHr(200);
  const r = accumulateZoneTime(hr, z, 5);
  const sum = r.zoneSeconds.reduce((a, b) => a + b, 0) + r.belowFirstZoneSeconds;
  assert.equal(sum, r.totalSeconds);
  assert.equal(r.totalSeconds, hr.length * 5);
});

test('accumulateZoneTime: assigns to the correct zone', () => {
  const z = [100, 120, 140, 160, 180]; // lower bounds
  const r = accumulateZoneTime([100, 125, 145, 165, 185], z, 1);
  assert.deepEqual(r.zoneSeconds, [1, 1, 1, 1, 1]);
  assert.equal(r.belowFirstZoneSeconds, 0);
});

test('accumulateZoneTime: counts sub-threshold samples separately', () => {
  const r = accumulateZoneTime([50, 60, 150], [100, 140], 10);
  assert.equal(r.belowFirstZoneSeconds, 20);
  assert.deepEqual(r.zoneSeconds, [0, 10]);
});

test('accumulateZoneTime: top zone is open-ended', () => {
  const r = accumulateZoneTime([500], [100, 140], 1);
  assert.deepEqual(r.zoneSeconds, [0, 1]);
});

test('accumulateZoneTime: rejects non-ascending boundaries', () => {
  assert.throws(() => accumulateZoneTime([100], [140, 100], 1), RangeError);
  assert.throws(() => accumulateZoneTime([100], [], 1), TypeError);
});

test('zonesFromMaxHr: default five zones at 50-90% of max', () => {
  assert.deepEqual(zonesFromMaxHr(200), [100, 120, 140, 160, 180]);
});

// ---------- Edwards TRIMP ----------

test('edwardsTrimp: single zone is minutes times weight', () => {
  // 10 minutes (600s) in zone index 2 -> weight 3 -> 30
  assert.equal(edwardsTrimp([0, 0, 600, 0, 0]), 30);
});

test('edwardsTrimp: additive across zones', () => {
  const a = edwardsTrimp([600, 0, 0, 0, 0]);
  const b = edwardsTrimp([0, 600, 0, 0, 0]);
  const both = edwardsTrimp([600, 600, 0, 0, 0]);
  assert.ok(Math.abs(both - (a + b)) < 1e-12);
});

test('edwardsTrimp: higher zones weigh more for equal time', () => {
  assert.ok(edwardsTrimp([0, 0, 0, 0, 600]) > edwardsTrimp([600, 0, 0, 0, 0]));
});

test('edwardsTrimp: rejects mismatched weights', () => {
  assert.throws(() => edwardsTrimp([60, 60], [1, 2, 3]), RangeError);
});

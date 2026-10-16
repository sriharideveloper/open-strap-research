import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  measurement, unavailable, provenance, instant, isMeasurement, isUnavailable,
  requireValue, valueOr, UNIT, SOURCE, CONFIDENCE,
} from '../src/model/measurement.mjs';
import {
  userProfile, heartRateSeries, rrSeries, sleepSession, stageInterval,
  deviceIdentity, workout, STAGE, SCHEMA_VERSION,
} from '../src/model/records.mjs';
import { buildDailySummary, atConfidence, ALGORITHM_VERSIONS } from '../src/pipeline/daily-summary.mjs';

// ---- fixtures ----

function synthRr(seconds = 180, breathsPerMin = 15) {
  const f = breathsPerMin / 60;
  const rr = [];
  let t = 0;
  while (t < seconds) { const v = 1000 + 60 * Math.sin(2 * Math.PI * f * t); rr.push(v); t += v / 1000; }
  return rr;
}

const PROFILE = userProfile({ restingHr: 50, maxHr: 190 });
const RR = rrSeries({ startedAt: '2026-10-15T03:00:00-04:00', rrMs: synthRr() });
const HR = heartRateSeries({
  startedAt: '2026-10-15T08:00:00-04:00', sampleSeconds: 60,
  bpm: [...new Array(60).fill(70), ...new Array(30).fill(150), ...new Array(60).fill(80)],
});
const SLEEP = sleepSession({
  id: 'sleep-1',
  startedAt: '2026-10-15T23:00:00-04:00',
  endedAt: '2026-10-16T07:00:00-04:00',
  stages: [
    { stage: STAGE.AWAKE, minutes: 30 },
    { stage: STAGE.LIGHT, minutes: 240 },
    { stage: STAGE.SWS, minutes: 90 },
    { stage: STAGE.REM, minutes: 120 },
  ],
});

// ---- value types ----

test('measurement: refuses a bare or invalid number', () => {
  const p = provenance({
    source: SOURCE.DERIVED, method: 'x', algorithmVersion: '1.0.0', confidence: CONFIDENCE.CONFIRMED,
  });
  assert.throws(() => measurement(NaN, UNIT.BPM, p), TypeError);
  assert.throws(() => measurement(60, 'beats', p), RangeError);
  assert.throws(() => measurement(60, UNIT.BPM, null), TypeError);
});

test('provenance: an unversioned metric is rejected', () => {
  assert.throws(() => provenance({
    source: SOURCE.DERIVED, method: 'x', confidence: CONFIDENCE.CONFIRMED,
  }), TypeError);
  assert.throws(() => provenance({
    source: 'guesswork', method: 'x', algorithmVersion: '1', confidence: CONFIDENCE.CONFIRMED,
  }), RangeError);
});

test('unavailable: demands a reason', () => {
  assert.throws(() => unavailable(''), TypeError);
  assert.throws(() => unavailable(), TypeError);
  assert.equal(unavailable('no data').reason, 'no data');
});

test('requireValue and valueOr make substitution explicit', () => {
  const u = unavailable('missing');
  assert.throws(() => requireValue(u, 'hrv'), RangeError);
  assert.equal(valueOr(u, -1), -1);
});

test('instant: rejects a timestamp without an offset', () => {
  assert.throws(() => instant('2026-10-15T08:00:00'), RangeError);
  assert.throws(() => instant('not a date'), RangeError);
  assert.equal(instant('2026-10-15T08:00:00Z').iso, '2026-10-15T08:00:00Z');
  assert.ok(instant('2026-10-15T08:00:00-04:00').epochMs > 0);
});

// ---- records ----

test('records: validate their inputs', () => {
  assert.throws(() => heartRateSeries({ startedAt: '2026-10-15T08:00:00Z', sampleSeconds: 60, bpm: [400] }), RangeError);
  assert.throws(() => rrSeries({ startedAt: '2026-10-15T08:00:00Z', rrMs: [1000] }), RangeError);
  assert.throws(() => userProfile({ restingHr: 190, maxHr: 50 }), RangeError);
  assert.throws(() => userProfile({ restingHr: 50, maxHr: 190, thresholds: { at: 0.9, cpt: 0.5 } }), RangeError);
  assert.throws(() => deviceIdentity({ model: '' }), TypeError);
  assert.throws(() => sleepSession({
    id: 's', startedAt: '2026-10-15T08:00:00Z', endedAt: '2026-10-15T07:00:00Z',
  }), RangeError);
});

test('records: device model is a free-form label', () => {
  assert.equal(deviceIdentity({ model: 'Example HR Strap' }).model, 'Example HR Strap');
  assert.equal(deviceIdentity().model, 'unknown');
});

test('sleepSession: exposes unscored time instead of hiding it', () => {
  // 480 min in bed, 480 min scored -> no gap
  assert.equal(SLEEP.timeInBedMin, 480);
  assert.equal(SLEEP.scoredMin, 480);
  assert.equal(SLEEP.unscoredMin, 0);

  const gappy = sleepSession({
    id: 'g', startedAt: '2026-10-15T23:00:00Z', endedAt: '2026-10-16T07:00:00Z',
    stages: [{ stage: STAGE.LIGHT, minutes: 300 }],
  });
  assert.equal(gappy.unscoredMin, 180);
});

test('records are frozen', () => {
  assert.throws(() => { SLEEP.stages.push(stageInterval({ stage: STAGE.REM, minutes: 1 })); }, TypeError);
  assert.equal(SLEEP.schemaVersion, SCHEMA_VERSION);
});

test('workout: computes duration from bounds', () => {
  const w = workout({ id: 'w1', startedAt: '2026-10-15T08:00:00Z', endedAt: '2026-10-15T09:30:00Z', sport: 'run' });
  assert.equal(w.durationMin, 90);
});

// ---- pipeline, full inputs ----

test('pipeline: computes the published metrics end to end', () => {
  const s = buildDailySummary({
    profile: PROFILE, rr: RR, hr: HR, sleep: SLEEP, sleepNeedMin: 480, date: '2026-10-15',
  });
  for (const k of ['hrvRmssd', 'respiratoryRate', 'totalSleepMin', 'sleepEfficiency',
    'sleepPerformance', 'cardiovascularLoad', 'edwardsTrimp']) {
    assert.ok(isMeasurement(s.metrics[k]), k + ' should be available');
  }
  assert.equal(s.metrics.totalSleepMin.value, 450); // 240+90+120
  assert.equal(s.metrics.sleepEfficiency.value, 93.75); // 450/480
  assert.ok(Math.abs(s.metrics.respiratoryRate.value - 15) < 0.6);
});

test('pipeline: every available metric carries full provenance', () => {
  const s = buildDailySummary({
    profile: PROFILE, rr: RR, hr: HR, sleep: SLEEP, sleepNeedMin: 480, date: '2026-10-15',
  });
  for (const [k, v] of Object.entries(s.metrics)) {
    if (!isMeasurement(v)) continue;
    assert.ok(v.unit, k + ' has no unit');
    assert.ok(v.provenance.method, k + ' has no method');
    assert.ok(v.provenance.algorithmVersion, k + ' has no algorithm version');
    assert.ok(v.provenance.confidence, k + ' has no confidence');
  }
});

// ---- pipeline refuses to substitute ----

test('pipeline: missing RR gives reasoned absence, not zero', () => {
  const s = buildDailySummary({ profile: PROFILE, hr: HR, sleep: SLEEP, sleepNeedMin: 480, date: 'd' });
  assert.ok(isUnavailable(s.metrics.hrvRmssd));
  assert.match(s.metrics.hrvRmssd.reason, /no RR interval series/);
  assert.ok(isUnavailable(s.metrics.respiratoryRate));
  // crucially, not a number
  assert.equal(s.metrics.hrvRmssd.value, undefined);
});

test('pipeline: sleep need is never invented', () => {
  const s = buildDailySummary({ profile: PROFILE, rr: RR, sleep: SLEEP, date: 'd' });
  assert.ok(isUnavailable(s.metrics.sleepPerformance));
  assert.match(s.metrics.sleepPerformance.reason, /not defaulted/);
  // efficiency needs no external input, so it is still computed
  assert.ok(isMeasurement(s.metrics.sleepEfficiency));
});

// ---- confidence propagation ----

// ---- coverage and notes ----

test('pipeline: coverage reports what is missing', () => {
  const full = buildDailySummary({
    profile: PROFILE, rr: RR, hr: HR, sleep: SLEEP, sleepNeedMin: 480,
    date: 'd',
  });
  const bare = buildDailySummary({ profile: PROFILE, date: 'd' });
  assert.ok(full.coverage.available > bare.coverage.available);
  assert.equal(bare.coverage.available, 0);
  assert.equal(full.coverage.total, full.coverage.available + full.coverage.unavailable);
  assert.ok(full.coverage.byConfidence[CONFIDENCE.CONFIRMED] > 0);
});

test('pipeline: unscored sleep time is surfaced as a note', () => {
  const gappy = sleepSession({
    id: 'g', startedAt: '2026-10-15T23:00:00Z', endedAt: '2026-10-16T07:00:00Z',
    stages: [{ stage: STAGE.LIGHT, minutes: 300 }],
  });
  const s = buildDailySummary({ profile: PROFILE, sleep: gappy, date: 'd' });
  assert.ok(s.notes.some((n) => /not stage-scored/.test(n)), 'expected a scoring-gap note');
});

test('pipeline: inconsistent sleep input is refused, not clamped', () => {
  const bad = sleepSession({
    id: 'b', startedAt: '2026-10-15T23:00:00Z', endedAt: '2026-10-16T01:00:00Z', // 120 min in bed
    stages: [{ stage: STAGE.LIGHT, minutes: 300 }],                               // 300 min scored
  });
  const s = buildDailySummary({ profile: PROFILE, sleep: bad, date: 'd' });
  assert.ok(isUnavailable(s.metrics.sleepEfficiency));
  assert.match(s.metrics.sleepEfficiency.reason, /inconsistent/);
});

test('pipeline: summary and metrics are frozen', () => {
  const s = buildDailySummary({ profile: PROFILE, date: 'd' });
  assert.throws(() => { s.metrics.hrvRmssd = 1; }, TypeError);
  assert.equal(s.schemaVersion, SCHEMA_VERSION);
  assert.equal(ALGORITHM_VERSIONS.intensityScore, undefined, 'no patent-derived metric in production');
});

test('pipeline: requires a profile and a date', () => {
  assert.throws(() => buildDailySummary({ date: 'd' }), TypeError);
  assert.throws(() => buildDailySummary({ profile: PROFILE }), TypeError);
});

test('production pipeline never emits a patent-derived metric', () => {
  const s = buildDailySummary({
    profile: PROFILE, rr: RR, hr: HR, sleep: SLEEP, sleepNeedMin: 480, date: 'd',
  });
  assert.equal(s.metrics.intensityScore, undefined);
  for (const v of Object.values(s.metrics)) {
    if (isMeasurement(v)) assert.equal(v.provenance.confidence, CONFIDENCE.CONFIRMED);
  }
});

test('atConfidence: filters production output by confidence', () => {
  const s = buildDailySummary({
    profile: PROFILE, rr: RR, hr: HR, sleep: SLEEP, sleepNeedMin: 480, date: 'd',
  });
  const strict = atConfidence(s, [CONFIDENCE.CONFIRMED]);
  assert.ok('cardiovascularLoad' in strict);
  assert.deepEqual(atConfidence(s, [CONFIDENCE.LOW]), {});
});
